import 'reflect-metadata';

import { expect } from 'chai';
import { BatchLogLevelEnum } from '@zerobias-com/platform-sdk';
import { URL, UUID } from '@zerobias-org/types-core-js';
import { CollectorZerobiasZerobiasDynamicImpl } from '../../src/CollectorZerobiasZerobiasDynamicImpl.js';
import { FileSourceReader, SourceFileView, SourceRecordsPage } from '../../src/FileSourceReader.js';
import { DataMapping } from '../../src/types/index.js';

const JOB_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const PIPELINE_ID = '6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13';
const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';
const SHEET_FILE = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b10';
const OTHER_FILE = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b11';

interface BatchCall {
  op: 'create' | 'addItems' | 'addItem' | 'log' | 'end';
  batchId: string;
  arg?: any;
}

/** Platform BatchApi fake that records every call, in order, against the batch it targets. */
class FakeBatchApi {
  calls: BatchCall[] = [];

  private created = 0;

  async createBatch(newBatch: any) {
    this.created += 1;
    const id = new UUID(`00000000-0000-4000-8000-${String(this.created).padStart(12, '0')}`);
    this.calls.push({ op: 'create', batchId: id.toString(), arg: newBatch });
    return { id };
  }

  async addBatchItems(id: UUID, items: any[]) {
    this.calls.push({ op: 'addItems', batchId: id.toString(), arg: items });
  }

  async addBatchItem(id: UUID, item: any) {
    this.calls.push({ op: 'addItem', batchId: id.toString(), arg: item });
  }

  async createBatchLog(id: UUID, log: any) {
    this.calls.push({ op: 'log', batchId: id.toString(), arg: log });
  }

  async endBatch(id: UUID) {
    this.calls.push({ op: 'end', batchId: id.toString() });
    return {};
  }

  /** The calls made against the one batch created for `className`. */
  callsFor(className: string): BatchCall[] {
    const creates = this.calls.filter((c) => c.op === 'create' && c.arg.className === className);
    expect(creates, `${className} batches`).to.have.length(1);
    return this.calls.filter((c) => c.batchId === creates[0].batchId);
  }
}

/** file-service fake; a file with no configured view answers like a 404. */
class FakeFileSourceReader implements FileSourceReader {
  calls: string[] = [];

  views = new Map<string, SourceFileView>();

  /** Container rows by `<fileVersionId>:<containerPath>`, served a page at a time. */
  records = new Map<string, Record<string, unknown>[]>();

  async getFile(fileId: string): Promise<SourceFileView> {
    this.calls.push(`get ${fileId}`);
    const view = this.views.get(fileId);
    if (!view) {
      throw new Error(`file-service GET /files/${fileId}/metadata returned 404`);
    }
    return view;
  }

  async listContainerRecords(
    fileVersionId: string,
    containerPath: string,
    pageNumber: number,
    pageSize: number,
  ): Promise<SourceRecordsPage> {
    this.calls.push(`records ${fileVersionId} ${containerPath} page ${pageNumber}`);
    const rows = this.records.get(`${fileVersionId}:${containerPath}`);
    if (!rows) {
      throw new Error(`file-service GET /files/${fileVersionId}/content/containers/records returned 404`);
    }
    return { items: rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), count: rows.length };
  }
}

/** Logger that swallows everything. */
const quietLogger = { debug() {}, info() {}, warn() {}, warning() {}, error() {}, crit() {} };

/** Build the Impl directly over a fake platform, dataproducer and file-service. */
function newHarness() {
  const batchApi = new FakeBatchApi();
  const platform = { isConnected: () => true, getBatchApi: () => batchApi };
  const dataproducer: Record<string, any> = {
    metadata: async () => ({ tags: [] }),
    getCollectionsApi: () => {
      throw new Error('a file source must not reach the data producer');
    },
  };
  const impl = new CollectorZerobiasZerobiasDynamicImpl(
    {
      jobId: new UUID(JOB_ID),
      pipelineId: new UUID(PIPELINE_ID),
      apiKey: 'test-api-key',
      server: new URL('https://app.example.com/api/hub'),
      orgId: new UUID(ORG_ID),
      previewMode: false,
      moduleTargets: {},
    } as any,
    dataproducer as any,
    platform as any,
  );
  const files = new FakeFileSourceReader();
  impl.fileSourceReader = files;
  impl.logger = quietLogger as any;
  return { impl, batchApi, files };
}

/** A mapping from a file source into `className`, copying `id` and `name`. */
function fileMapping(file: Record<string, unknown>, className = 'PhysicalSpace'): DataMapping {
  const rule = (key: string) => ({
    id: `r-${key}`,
    source: { key, name: key, type: 'string', level: 0 },
    transform: { type: 'direct' },
    destination: { key, name: key },
  });
  return {
    id: `mapping-${className}`,
    source: { objectName: 'Sheet', objectPath: [], file },
    destination: { className, classId: 'class-2', schema: { dataTypes: [], properties: [] } },
    mappings: [rule('id'), rule('name')],
    metadata: { name: className, createdAt: '', description: '' },
    context: {},
  } as unknown as DataMapping;
}

/** Every payload sent to the one batch of `className`, whichever add call carried it. */
function sent(h: ReturnType<typeof newHarness>, className: string): any[] {
  return h.batchApi.callsFor(className)
    .flatMap((c) => (c.op === 'addItems' ? c.arg.map((item: any) => item.payload) : c.op === 'addItem' ? [c.arg.payload] : []));
}

describe('CollectorZerobiasZerobiasDynamicImpl — mappings from an uploaded file', () => {
  it('maps every row of the sheet in the file\'s latest version, paging through the reader', async () => {
    const h = newHarness();
    h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-latest', name: 'floorplan.xlsx' });
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: `space-${i}`, name: `Room ${i}`, ignored: true }));
    h.files.records.set('v-latest:/PhysicalSpace', rows);

    await h.impl.run({ dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

    expect(h.files.calls).to.deep.equal([
      `get ${SHEET_FILE}`,
      'records v-latest /PhysicalSpace page 1',
      'records v-latest /PhysicalSpace page 2',
    ]);
    const items = sent(h, 'PhysicalSpace');
    expect(items).to.have.length(150);
    expect(items[0]).to.deep.equal({ id: 'space-0', name: 'Room 0' });
    expect(items[149]).to.deep.equal({ id: 'space-149', name: 'Room 149' });
    expect(h.batchApi.callsFor('PhysicalSpace').map((c) => c.op)).to.not.include('log');
  });

  it('reads a CSV\'s rows at container path /, without the data producer', async () => {
    const h = newHarness();
    h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
    h.files.records.set('v-1:/', [{ id: 'a', name: 'A' }]);

    await h.impl.run({ dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/' })] });

    expect(sent(h, 'PhysicalSpace')).to.deep.equal([{ id: 'a', name: 'A' }]);
  });

  it('maps the file itself as one record when there is no container path', async () => {
    const h = newHarness();
    h.files.views.set(SHEET_FILE, {
      id: SHEET_FILE, fileVersionId: 'v-2', name: 'floorplan.webp', mimeType: 'image/webp', size: 106928,
      created: '2026-10-14T14:35:44.703Z', updated: '2026-10-14T14:35:44.703Z',
    });

    await h.impl.run({ dataMappings: [fileMapping({ fileId: SHEET_FILE }, 'File')] });

    expect(h.files.calls).to.deep.equal([`get ${SHEET_FILE}`]);
    expect(sent(h, 'File')).to.deep.equal([{ id: SHEET_FILE, name: 'floorplan.webp' }]);
  });

  it('fails the mapping\'s batch when the file is gone, and still runs the other mappings', async () => {
    const h = newHarness();
    h.files.views.set(OTHER_FILE, { id: OTHER_FILE, fileVersionId: 'v-3' });
    h.files.records.set('v-3:/File', [{ id: 'drawing', name: 'Drawing' }]);

    await h.impl.run({
      dataMappings: [
        fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' }),
        fileMapping({ fileId: OTHER_FILE, containerPath: '/File' }, 'Drawing'),
      ],
    });

    const failed = h.batchApi.callsFor('PhysicalSpace');
    expect(failed.map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
    expect(failed[1].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
    expect(failed[1].arg.message).to.contain('returned 404');
    expect(sent(h, 'Drawing')).to.deep.equal([{ id: 'drawing', name: 'Drawing' }]);
  });

  it('fails the mapping\'s batch when the file has no current version', async () => {
    const h = newHarness();
    h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: null });

    await h.impl.run({ dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

    const calls = h.batchApi.callsFor('PhysicalSpace');
    expect(calls[1].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
    expect(calls[1].arg.message).to.contain('has no current version');
  });

  it('fails a source with neither an objectId nor a file', async () => {
    const h = newHarness();
    const mapping = fileMapping({ fileId: SHEET_FILE });
    delete (mapping.source as any).file;

    await h.impl.run({ dataMappings: [mapping] });

    expect(h.batchApi.callsFor('PhysicalSpace')[1].arg.message).to.contain('neither an objectId nor a file');
  });
});
