import 'reflect-metadata';

import { expect } from 'chai';
import { BatchLogLevelEnum } from '@zerobias-com/platform-sdk';
import { PagedResults, URL, UUID } from '@zerobias-org/types-core-js';
import { CollectorZerobiasZerobiasDynamicImpl, FILE_RECORDS_MAX_PAGES } from '../../src/CollectorZerobiasZerobiasDynamicImpl.js';
import {
  FileService,
  FileServiceContainer,
  FileServiceCopyJob,
  FileServiceError,
  FileServiceFile,
  FileServiceFileStatus,
  FileServiceRecordsPage,
} from '../../src/FileServiceClient.js';
import { container, TYPES } from '../../src/index.js';
import { DataMapping, DataMappingParams } from '../../src/types/index.js';

const JOB_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const PIPELINE_ID = '6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13';
const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';
const TARGET_ID = '3a9f1c27-6e4b-4d8a-b5c3-1f2e3d4c5b6a';
const HUB_TAG_ID = '7c4d2e19-8a3b-4f5c-9d6e-1a2b3c4d5e6f';
const SHEET_FILE = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b10';
const OTHER_FILE = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b11';

/** How many rows file-service 2.0.18 returns for any records page: its reader's default page size. */
const UNPAGED_ROWS = 50;

/** What the Hub target answers while it is down. */
const HUB_DOWN = 'connect ECONNREFUSED 10.0.0.7:443';

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

/**
 * How the fake file-service serves records pages:
 *  - `paged`: the page asked for, with the container's total as its count, and a 400 for a page past the end, as
 *    file-service does once it honours paging.
 *  - `unpaged`: as file-service 2.0.18 does, its first 50 rows for every page, counting only those.
 *  - `first-page`: the first page's rows for every page number, with the true total.
 *  - `everything`: every row at once, whatever page size is asked for.
 */
type Serving = 'paged' | 'unpaged' | 'first-page' | 'everything';

/**
 * file-service fake for file-backed mappings. A file with no view answers 404. `records` holds each container's rows
 * by `<versionId>:<containerPath>`, and a container with none answers 404; its record count is its number of rows
 * unless `containerCounts` says otherwise. `afterPage` runs after each records page is served. `calls` lists every
 * call in order.
 */
class FakeSourceFiles implements FileService {
  calls: string[] = [];

  views = new Map<string, FileServiceFile>();

  records = new Map<string, Record<string, unknown>[]>();

  containerCounts = new Map<string, number>();

  serving: Serving = 'paged';

  afterPage?: (pageNumber: number) => void;

  async copyFile(): Promise<FileServiceCopyJob> {
    throw new Error('a file-backed mapping must not copy files');
  }

  async getFileStatus(): Promise<FileServiceFileStatus> {
    throw new Error('a file-backed mapping must not read a version status');
  }

  async getFile(fileId: string): Promise<FileServiceFile> {
    this.calls.push(`get ${fileId}`);
    const view = this.views.get(fileId);
    if (!view) {
      throw new FileServiceError(`file-service GET /files/${fileId}/metadata returned 404`, 404);
    }
    return view;
  }

  async getContainer(versionId: string, containerPath: string): Promise<FileServiceContainer> {
    this.calls.push(`container ${versionId} ${containerPath}`);
    const key = `${versionId}:${containerPath}`;
    const rows = this.rowsOf(versionId, containerPath);
    return { path: containerPath, records: this.containerCounts.get(key) ?? rows.length, subcontainers: 0 };
  }

  async listContainerRecords(versionId: string, containerPath: string, pageNumber: number, pageSize: number): Promise<FileServiceRecordsPage> {
    this.calls.push(`records ${versionId} ${containerPath} page ${pageNumber}`);
    const rows = this.rowsOf(versionId, containerPath);
    const page = this.page(rows, pageNumber, pageSize);
    this.afterPage?.(pageNumber);
    return page;
  }

  /** Page `pageNumber` of `rows` as `serving` serves it; a count of 0 is left out, as file-service leaves out its header. */
  private page(rows: Record<string, unknown>[], pageNumber: number, pageSize: number): FileServiceRecordsPage {
    const count = (items: unknown[]) => (items.length > 0 ? items.length : -1);
    switch (this.serving) {
      case 'unpaged': {
        const items = rows.slice(0, UNPAGED_ROWS);
        return { items, count: count(items) };
      }
      case 'everything':
        return { items: rows, count: count(rows) };
      case 'first-page':
        return { items: rows.slice(0, pageSize), count: count(rows) };
      default: {
        if (rows.length > 0 && (pageNumber - 1) * pageSize >= rows.length) {
          const pages = Math.ceil(rows.length / pageSize);
          throw new FileServiceError(`file-service returned 400: Requested page ${pageNumber}, but only ${pages} exist`, 400);
        }
        return { items: rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), count: count(rows) };
      }
    }
  }

  /** The rows of a container, answering 404 for one that has none. */
  private rowsOf(versionId: string, containerPath: string): Record<string, unknown>[] {
    const rows = this.records.get(`${versionId}:${containerPath}`);
    if (!rows) {
      throw new FileServiceError(`file-service GET /files/${versionId}/content/container returned 404: Not found: ${containerPath}`, 404);
    }
    return rows;
  }
}

/** Logger fake that keeps each line with its level. */
class RecordingLogger {
  entries: { level: string; message: string }[] = [];

  debug(message: string) { this.entries.push({ level: 'debug', message }); }

  info(message: string) { this.entries.push({ level: 'info', message }); }

  warn(message: string) { this.entries.push({ level: 'warn', message }); }

  warning(message: string) { this.entries.push({ level: 'warn', message }); }

  error(message: string) { this.entries.push({ level: 'error', message }); }

  crit(message: string) { this.entries.push({ level: 'crit', message }); }

  at(level: string): string[] {
    return this.entries.filter((e) => e.level === level).map((e) => e.message);
  }
}

/** The hub-client context of a job whose DataProducer target is `TARGET_ID`, with `overrides` on top. */
function jobContext(overrides: Record<string, unknown> = {}): any {
  return {
    jobId: new UUID(JOB_ID),
    pipelineId: new UUID(PIPELINE_ID),
    apiKey: 'test-api-key',
    server: new URL('https://app.example.com/api/hub'),
    orgId: new UUID(ORG_ID),
    previewMode: false,
    moduleTargets: { 'module-interface-dataproducer': { targetId: new UUID(TARGET_ID) } },
    ...overrides,
  };
}

/** One page of Things from the Hub target's collection: a real `PagedResults` with nothing more to fetch. */
function thingsCollection(): PagedResults<any> {
  const results = new PagedResults<any>();
  results.pageSize = 100;
  results.items = [{ id: 'thing-1', name: 'Thing 1' }];
  results.baseUrl = new URL('https://app.example.com/api/hub/targets/t-1/getCollectionElements');
  return results;
}

/**
 * Build the Impl directly over a fake platform, file-service and DataProducer. `hub` drives the DataProducer: while
 * `up` is false its connect and metadata fail, and `connected` is what `isConnected` answers; it counts every call.
 */
function newHarness(context: Record<string, unknown> = {}) {
  const batchApi = new FakeBatchApi();
  const platform = { isConnected: () => true, getBatchApi: () => batchApi };
  const hub = { up: true, connected: true, isConnectedCalls: 0, connects: [] as any[], metadataCalls: 0, collectionCalls: 0 };
  const dataproducer: Record<string, any> = {
    isConnected: async () => {
      hub.isConnectedCalls += 1;
      return hub.connected;
    },
    connect: async (profile: any) => {
      hub.connects.push(profile);
      if (!hub.up) {
        throw new Error(HUB_DOWN);
      }
      hub.connected = true;
    },
    metadata: async () => {
      hub.metadataCalls += 1;
      if (!hub.up) {
        throw new Error(HUB_DOWN);
      }
      return { tags: [{ id: new UUID(HUB_TAG_ID) }] };
    },
    getCollectionsApi: () => ({
      getCollectionElements: async () => {
        hub.collectionCalls += 1;
        return thingsCollection();
      },
    }),
  };
  const impl = new CollectorZerobiasZerobiasDynamicImpl(jobContext(context), dataproducer as any, platform as any);
  const files = new FakeSourceFiles();
  const logger = new RecordingLogger();
  impl.fileService = files;
  impl.logger = logger as any;
  return { impl, batchApi, files, hub, logger };
}

type Harness = ReturnType<typeof newHarness>;

/** A mapping from `source` into `className`, copying `id` and `name`. */
function mappingFrom(source: Record<string, unknown>, className: string): DataMapping {
  const rule = (key: string) => ({
    id: `r-${key}`,
    source: { key, name: key, type: 'string', level: 0 },
    transform: { type: 'direct' },
    destination: { key, name: key },
  });
  return {
    id: `mapping-${className}`,
    source: { objectName: 'Sheet', objectPath: [], ...source },
    destination: { className, classId: `class-${className}`, schema: { dataTypes: [], properties: [] } },
    mappings: [rule('id'), rule('name')],
    metadata: { name: className, createdAt: '', description: '' },
    context: {},
  } as unknown as DataMapping;
}

/** A mapping from the uploaded file `file` into `className`. */
function fileMapping(file: Record<string, unknown>, className = 'PhysicalSpace'): DataMapping {
  return mappingFrom({ file }, className);
}

/** A mapping from the Hub target's Things collection into `className`. */
function hubMapping(className = 'Thing'): DataMapping {
  return mappingFrom({ objectId: 'collection-1', objectName: 'Things' }, className);
}

/** `count` sheet rows, numbered from 0. */
function sheetRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ id: `space-${i}`, name: `Room ${i}` }));
}

/** Every payload sent to the one batch of `className`, whichever add call carried it. */
function sent(h: Harness, className: string): any[] {
  return h.batchApi.callsFor(className)
    .flatMap((c) => (c.op === 'addItems' ? c.arg.map((item: any) => item.payload) : c.op === 'addItem' ? [c.arg.payload] : []));
}

/** The batch calls of `className` other than item adds. */
function controlOps(h: Harness, className: string): string[] {
  return h.batchApi.callsFor(className).filter((c) => c.op !== 'addItem' && c.op !== 'addItems').map((c) => c.op);
}

/** The one error log on the batch of `className`. */
function errorLog(h: Harness, className: string): string {
  const logs = h.batchApi.callsFor(className).filter((c) => c.op === 'log');
  expect(logs, `${className} logs`).to.have.length(1);
  expect(logs[0].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
  return logs[0].arg.message;
}

/** Run `params` and expect the run itself to complete, as it must whichever mappings fail. */
async function runToCompletion(h: Harness, params: DataMappingParams): Promise<void> {
  await h.impl.run(params);
  expect(h.logger.at('info')).to.include('All data mappings completed');
}

describe('CollectorZerobiasZerobiasDynamicImpl — mappings from an uploaded file', () => {
  describe('reading', () => {
    it('maps every row of a sheet from the file\'s ready version, paging by the container\'s record count', async () => {
      for (const total of [250, 200]) {
        const h = newHarness();
        h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-ready', name: 'floorplan.xlsx' });
        h.files.records.set('v-ready:/PhysicalSpace', sheetRows(total).map((row) => ({ ...row, ignored: true })));

        await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

        const pages = Math.ceil(total / 100);
        expect(h.files.calls, `${total} rows`).to.deep.equal([
          `get ${SHEET_FILE}`,
          'container v-ready /PhysicalSpace',
          ...Array.from({ length: pages }, (_, i) => `records v-ready /PhysicalSpace page ${i + 1}`),
        ]);
        expect(sent(h, 'PhysicalSpace'), `${total} rows`).to.deep.equal(sheetRows(total));
        expect(controlOps(h, 'PhysicalSpace')).to.deep.equal(['create', 'end']);
      }
    });

    it('reads a CSV\'s rows at container path /, without the data producer', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      h.files.records.set('v-1:/', [{ id: 'a', name: 'A' }]);

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/' })] });

      expect(sent(h, 'PhysicalSpace')).to.deep.equal([{ id: 'a', name: 'A' }]);
      expect(h.hub.collectionCalls).to.equal(0);
    });

    it('maps the file itself as one record when there is no container path', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, {
        id: SHEET_FILE, fileVersionId: 'v-2', name: 'floorplan.webp', mimeType: 'image/webp', size: 106928,
        created: '2026-10-14T14:35:44.703Z', updated: '2026-10-14T14:35:44.703Z',
      });

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE }, 'File')] });

      expect(h.files.calls).to.deep.equal([`get ${SHEET_FILE}`]);
      expect(sent(h, 'File')).to.deep.equal([{ id: SHEET_FILE, name: 'floorplan.webp' }]);
    });

    it('reads an empty sheet as an empty batch, asking for its first page only', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      h.files.records.set('v-1:/PhysicalSpace', []);

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(h.files.calls.filter((c) => c.startsWith('records'))).to.deep.equal(['records v-1 /PhysicalSpace page 1']);
      expect(h.batchApi.callsFor('PhysicalSpace').map((c) => c.op)).to.deep.equal(['create', 'end']);
    });

    it('reads every page from the version the metadata named, even when a new version is uploaded mid-read', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-ready' });
      h.files.records.set('v-ready:/PhysicalSpace', sheetRows(150));
      h.files.afterPage = () => {
        h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-newer' });
        h.files.records.set('v-newer:/PhysicalSpace', sheetRows(10));
      };

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(h.files.calls.slice(1)).to.deep.equal([
        'container v-ready /PhysicalSpace',
        'records v-ready /PhysicalSpace page 1',
        'records v-ready /PhysicalSpace page 2',
      ]);
      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(150));
    });
  });

  describe('a file-service that does not page', () => {
    it('fails a sheet past 50 rows cleanly, sending no row twice, when every page is the first 50 rows (2.0.18)', async () => {
      const h = newHarness();
      h.files.serving = 'unpaged';
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-big' });
      h.files.records.set('v-big:/PhysicalSpace', sheetRows(150));
      h.files.views.set(OTHER_FILE, { id: OTHER_FILE, fileVersionId: 'v-small' });
      h.files.records.set('v-small:/Drawing', sheetRows(30));

      await runToCompletion(h, {
        dataMappings: [
          fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' }),
          fileMapping({ fileId: OTHER_FILE, containerPath: '/Drawing' }, 'Drawing'),
        ],
      });

      expect(h.files.calls.filter((c) => c.includes('v-big'))).to.deep.equal([
        'container v-big /PhysicalSpace',
        'records v-big /PhysicalSpace page 1',
      ]);
      const items = sent(h, 'PhysicalSpace');
      expect(items).to.deep.equal(sheetRows(UNPAGED_ROWS));
      expect(new Set(items.map((item) => item.id)).size).to.equal(items.length);
      expect(controlOps(h, 'PhysicalSpace')).to.deep.equal(['create', 'log', 'end']);
      const message = errorLog(h, 'PhysicalSpace');
      expect(message).to.contain('file-service did not page the records of /PhysicalSpace');
      expect(message).to.contain('page 1 returned 50 row(s) and a count of 50, but the container holds 150 record(s), so 100 were due');

      expect(sent(h, 'Drawing'), 'a sheet that fits in the first 50 rows').to.deep.equal(sheetRows(30));
      expect(controlOps(h, 'Drawing')).to.deep.equal(['create', 'end']);
    });

    it('refuses a page that repeats the one before, before sending any of its rows', async () => {
      const h = newHarness();
      h.files.serving = 'first-page';
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      h.files.records.set('v-1:/PhysicalSpace', sheetRows(300));

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(h.files.calls.filter((c) => c.startsWith('records'))).to.have.length(2);
      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(100));
      expect(controlOps(h, 'PhysicalSpace')).to.deep.equal(['create', 'log', 'end']);
      expect(errorLog(h, 'PhysicalSpace')).to.contain('did not advance through the records of /PhysicalSpace')
        .and.to.contain('page 2 holds the same rows as page 1');
    });

    it('refuses a page that holds more rows than were due, before sending any of them', async () => {
      const h = newHarness();
      h.files.serving = 'everything';
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      h.files.records.set('v-1:/PhysicalSpace', sheetRows(150));

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(h.batchApi.callsFor('PhysicalSpace').map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(errorLog(h, 'PhysicalSpace')).to.contain('page 1 returned 150 row(s)');
    });

    it('still previews a sheet past 50 rows, as its first rows are right', async () => {
      const h = newHarness({ previewMode: true, previewCount: 5 });
      h.files.serving = 'unpaged';
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-big' });
      h.files.records.set('v-big:/PhysicalSpace', sheetRows(150));

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(5));
      expect(controlOps(h, 'PhysicalSpace')).to.deep.equal(['create', 'end']);
    });

    it('fails before reading a page when the container holds more records than the page cap allows', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      h.files.records.set('v-1:/PhysicalSpace', sheetRows(1));
      h.files.containerCounts.set('v-1:/PhysicalSpace', FILE_RECORDS_MAX_PAGES * 100 + 1);

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(FILE_RECORDS_MAX_PAGES).to.equal(10_000);
      expect(h.files.calls.filter((c) => c.startsWith('records'))).to.deep.equal([]);
      expect(errorLog(h, 'PhysicalSpace')).to.contain('holds 1000001 records, more than the 10000 pages of 100 a mapping reads');
    });
  });

  describe('missing or unready files', () => {
    it('fails the mapping\'s batch when the file is gone (404), and still runs the other mappings', async () => {
      const h = newHarness();
      h.files.views.set(OTHER_FILE, { id: OTHER_FILE, fileVersionId: 'v-3' });
      h.files.records.set('v-3:/File', [{ id: 'drawing', name: 'Drawing' }]);

      await runToCompletion(h, {
        dataMappings: [
          fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' }),
          fileMapping({ fileId: OTHER_FILE, containerPath: '/File' }, 'Drawing'),
        ],
      });

      expect(h.batchApi.callsFor('PhysicalSpace').map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(errorLog(h, 'PhysicalSpace')).to.equal(
        `Failed to fetch source items: Source file ${SHEET_FILE} was not found: ` +
        'file-service answered 404, so it was deleted or this job cannot see it',
      );
      expect(h.logger.at('error').some((m) => m.startsWith('Failed to process data mapping mapping-PhysicalSpace'))).to.equal(true);
      expect(sent(h, 'Drawing')).to.deep.equal([{ id: 'drawing', name: 'Drawing' }]);
    });

    it('fails the mapping\'s batch, not the run, when the file has no ready version yet', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: null, size: null });

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(h.files.calls).to.deep.equal([`get ${SHEET_FILE}`]);
      expect(h.batchApi.callsFor('PhysicalSpace').map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(errorLog(h, 'PhysicalSpace')).to.contain(`Source file ${SHEET_FILE} is not ready yet: it has no ready version`);
    });

    it('fails the mapping\'s batch when its version has no such container (404)', async () => {
      const h = newHarness();
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-renamed' });
      h.files.records.set('v-renamed:/Physical Spaces', sheetRows(3));

      await runToCompletion(h, { dataMappings: [fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' })] });

      expect(errorLog(h, 'PhysicalSpace')).to.contain(
        `/PhysicalSpace of source file ${SHEET_FILE} (version v-renamed) was not found: file-service answered 404`,
      );
    });

    it('fails a source with neither an objectId nor a file', async () => {
      const h = newHarness();
      const mapping = fileMapping({ fileId: SHEET_FILE });
      delete (mapping.source as any).file;

      await runToCompletion(h, { dataMappings: [mapping] });

      expect(errorLog(h, 'PhysicalSpace')).to.contain('neither an objectId nor a file');
      expect(h.hub.metadataCalls).to.equal(0);
    });
  });

  describe('the Hub target', () => {
    /** A harness holding a 2-row sheet for the PhysicalSpace mapping. */
    function withSheet(context: Record<string, unknown> = {}): Harness {
      const h = newHarness(context);
      h.files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      h.files.records.set('v-1:/PhysicalSpace', sheetRows(2));
      return h;
    }

    const SHEET_MAPPING = fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' });

    it('runs mappings that only read uploaded files without reaching the Hub target, even while it is down', async () => {
      const h = withSheet();
      h.hub.up = false;
      h.hub.connected = false;

      await runToCompletion(h, { dataMappings: [SHEET_MAPPING, fileMapping({ fileId: SHEET_FILE, containerPath: '/PhysicalSpace' }, 'Room')] });

      expect(h.hub).to.include({ isConnectedCalls: 0, metadataCalls: 0, collectionCalls: 0 });
      expect(h.hub.connects).to.deep.equal([]);
      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(2));
      expect(sent(h, 'Room')).to.deep.equal(sheetRows(2));
      expect(h.batchApi.calls.filter((c) => c.op === 'log')).to.deep.equal([]);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('fails only the mappings that read from the Hub target while it is down, with its error', async () => {
      const h = withSheet();
      h.hub.up = false;
      h.hub.connected = false;

      await runToCompletion(h, { dataMappings: [hubMapping(), SHEET_MAPPING] });

      expect(h.batchApi.callsFor('Thing').map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(errorLog(h, 'Thing')).to.equal(`Failed to fetch source items: Unable to initialize collector: ${HUB_DOWN}`);
      expect(h.hub.collectionCalls).to.equal(0);
      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(2));
      expect(controlOps(h, 'PhysicalSpace')).to.deep.equal(['create', 'end']);
      expect(h.logger.at('error')).to.include(`Failed to process data mapping mapping-Thing: Unable to initialize collector: ${HUB_DOWN}`);
      expect(h.logger.at('warn').some((m) => m.includes('the 1 data mapping(s) that read from it fail; the other 1 still run'))).to.equal(true);
    });

    it('reads mixed mappings as before while the Hub target is up, tagging only the Hub-backed batch', async () => {
      const h = withSheet();

      await runToCompletion(h, { dataMappings: [hubMapping(), SHEET_MAPPING] });

      expect(h.hub).to.include({ isConnectedCalls: 1, metadataCalls: 1, collectionCalls: 1 });
      expect(h.hub.connects).to.deep.equal([]);
      expect(sent(h, 'Thing')).to.deep.equal([{ id: 'thing-1', name: 'Thing 1' }]);
      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(2));
      expect(h.batchApi.calls.filter((c) => c.op === 'log')).to.deep.equal([]);
      const thing = h.batchApi.callsFor('Thing')[0].arg;
      expect(thing.tagIds.map(String)).to.deep.equal([HUB_TAG_ID]);
      expect(thing.groupId).to.equal(PIPELINE_ID);
      expect(h.batchApi.callsFor('PhysicalSpace')[0].arg).to.deep.include({ tagIds: [], groupId: PIPELINE_ID });
    });

    it('connects an unconnected DataProducer to the job\'s target before reading from it', async () => {
      const h = withSheet();
      h.hub.connected = false;

      await runToCompletion(h, { dataMappings: [hubMapping()] });

      expect(h.hub.connects).to.have.length(1);
      const profile = h.hub.connects[0];
      expect(String(profile.targetId)).to.equal(TARGET_ID);
      expect(String(profile.orgId)).to.equal(ORG_ID);
      expect(profile.apiKey).to.equal('test-api-key');
      expect(profile.server.toString()).to.equal('https://app.example.com/api/hub');
      expect(h.hub.metadataCalls).to.equal(1);
      expect(sent(h, 'Thing')).to.deep.equal([{ id: 'thing-1', name: 'Thing 1' }]);
    });

    it('fails only the Hub-backed mappings when the job names no DataProducer target', async () => {
      const h = withSheet({ moduleTargets: {} });
      h.hub.connected = false;

      await runToCompletion(h, { dataMappings: [hubMapping(), SHEET_MAPPING] });

      expect(errorLog(h, 'Thing')).to.contain('Missing module-interface-dataproducer module connection configuration');
      expect(h.hub.connects).to.deep.equal([]);
      expect(sent(h, 'PhysicalSpace')).to.deep.equal(sheetRows(2));
    });

    it('gets the client from the published container with its DataProducer unconnected, so file mappings need no Hub', async () => {
      const batchApi = new FakeBatchApi();
      const child = container.createChild();
      child.bind(TYPES.HubClientContext).toConstantValue(jobContext());
      child.bind(TYPES.platform).toConstantValue({ isConnected: () => true, getBatchApi: () => batchApi });

      const client = await child.getAsync<CollectorZerobiasZerobiasDynamicImpl>(TYPES.HubClient);

      expect(client).to.be.instanceOf(CollectorZerobiasZerobiasDynamicImpl);
      expect(await client.dataproducer.isConnected()).to.equal(false);

      const files = new FakeSourceFiles();
      files.views.set(SHEET_FILE, { id: SHEET_FILE, fileVersionId: 'v-1' });
      files.records.set('v-1:/PhysicalSpace', sheetRows(2));
      client.fileService = files;
      client.logger = new RecordingLogger() as any;
      await client.run({ dataMappings: [SHEET_MAPPING] });

      expect(batchApi.callsFor('PhysicalSpace').map((c) => c.op)).to.deep.equal(['create', 'addItem', 'addItem', 'end']);
      expect(await client.dataproducer.isConnected()).to.equal(false);
    });
  });
});
