import 'reflect-metadata';

import { expect } from 'chai';
import { BatchLogLevelEnum } from '@zerobias-com/platform-sdk';
import { URL, UUID } from '@zerobias-org/types-core-js';
import { CollectorZerobiasZerobiasDynamicImpl } from '../../src/CollectorZerobiasZerobiasDynamicImpl.js';
import { FileService, FileServiceCopyRequest, FileServiceFile, FileServiceFileStatus } from '../../src/FileServiceClient.js';
import { DataMapping, PipelineFile } from '../../src/types/index.js';

const JOB_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const PIPELINE_ID = '6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13';
const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';

const UPLOAD: PipelineFile = {
  fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b01',
  name: 'policy.pdf',
  source: 'upload',
};

const HUB: PipelineFile = {
  fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b02',
  name: 'evidence.csv',
  source: 'hub',
  targetId: '3a9f1c27-6e4b-4d8a-b5c3-1f2e3d4c5b6a',
  objectId: 'content_acme/controls/evidence.csv',
  destinationPath: '/pipelines/evidence.csv',
};

const MISSING: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b03', name: 'gone.txt', source: 'upload' };
const NO_VERSION: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b04', name: 'broken.txt', source: 'upload' };
const NO_SIZE: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b05', name: 'sizeless.txt', source: 'upload' };

interface BatchCall {
  op: 'create' | 'addItems' | 'addItem' | 'log' | 'end';
  batchId: string;
  arg?: any;
}

/** Platform BatchApi fake that records every call, in order, against the batch it targets. */
class FakeBatchApi {
  calls: BatchCall[] = [];

  failAddItems = false;

  private created = 0;

  async createBatch(newBatch: any) {
    this.created += 1;
    const id = new UUID(`00000000-0000-4000-8000-${String(this.created).padStart(12, '0')}`);
    this.calls.push({ op: 'create', batchId: id.toString(), arg: newBatch });
    return { id };
  }

  async addBatchItems(id: UUID, items: any[]) {
    this.calls.push({ op: 'addItems', batchId: id.toString(), arg: items });
    if (this.failAddItems) {
      throw new Error('addBatchItems exploded');
    }
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

  /** The calls made against the one batch created for `className`, or none when no such batch exists. */
  callsFor(className: string): BatchCall[] {
    const creates = this.calls.filter((c) => c.op === 'create' && c.arg.className === className);
    if (creates.length === 0) {
      return [];
    }
    expect(creates, `${className} batches`).to.have.length(1);
    return this.calls.filter((c) => c.batchId === creates[0].batchId);
  }
}

/** file-service fake; a file with no configured view or status answers like a 404. */
class FakeFileService implements FileService {
  calls: string[] = [];

  copies: FileServiceCopyRequest[] = [];

  failCopy = false;

  views = new Map<string, FileServiceFile>();

  statuses = new Map<string, FileServiceFileStatus>();

  async copyFile(request: FileServiceCopyRequest): Promise<void> {
    this.calls.push(`copy ${request.destinationPath}`);
    this.copies.push(request);
    if (this.failCopy) {
      throw new Error('file-service PUT /copyFile returned 502');
    }
  }

  async getFile(fileId: string): Promise<FileServiceFile> {
    this.calls.push(`get ${fileId}`);
    const view = this.views.get(fileId);
    if (!view) {
      throw new Error(`file-service GET /files/${fileId}/metadata returned 404`);
    }
    return view;
  }

  async getFileStatus(fileId: string): Promise<FileServiceFileStatus> {
    this.calls.push(`status ${fileId}`);
    const status = this.statuses.get(fileId);
    if (!status) {
      throw new Error(`file-service GET /files/${fileId}/status returned 404`);
    }
    return status;
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

/** Build the Impl directly over a fake platform, dataproducer, file-service and logger. */
function newHarness(context: Record<string, unknown> = {}) {
  const batchApi = new FakeBatchApi();
  const platform = { isConnected: () => true, getBatchApi: () => batchApi };
  const dataproducer: Record<string, any> = {
    metadata: async () => ({ tags: [] }),
    getCollectionsApi: () => ({
      getCollectionElements: async () => {
        throw new Error('collection fetch timed out');
      },
    }),
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
      ...context,
    } as any,
    dataproducer as any,
    platform as any,
  );
  const files = new FakeFileService();
  const logger = new RecordingLogger();
  impl.fileService = files;
  impl.logger = logger as any;
  return { impl, batchApi, dataproducer, files, logger };
}

/** A collection-backed mapping into `Thing`; the harness makes its fetch fail. */
const THING_MAPPING = {
  id: 'mapping-1',
  source: { objectId: 'collection-1', objectName: 'Things', objectPath: [], schema: {} },
  destination: { className: 'Thing', classId: 'class-1', schema: { dataTypes: [], properties: [] } },
  mappings: [],
  metadata: { name: 'things', createdAt: '', description: '' },
  context: {},
} as unknown as DataMapping;

function payloads(call: BatchCall): any[] {
  return call.arg.map((item: any) => item.payload);
}

describe('CollectorZerobiasZerobiasDynamicImpl', () => {
  describe('pipeline files', () => {
    it('does not touch files when the params have no files', async () => {
      const h = newHarness();

      await h.impl.run({});

      expect(h.files.calls).to.deep.equal([]);
      expect(h.batchApi.calls).to.deep.equal([]);
    });

    it('sends an empty File batch with deletes on for an empty file list', async () => {
      const h = newHarness();

      await h.impl.run({ files: [] });

      const calls = h.batchApi.callsFor('File');
      expect(calls.map((c) => c.op)).to.deep.equal(['create', 'end']);
      expect(calls[0].arg).to.include({ className: 'File', deletesEnabled: true });
      expect(h.files.calls).to.deep.equal([]);
    });

    it('writes the File batch to the pipeline-files group, apart from the mapping batches', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 10, mimeType: 'application/pdf' });

      await h.impl.run({ files: [UPLOAD], dataMappings: [THING_MAPPING] });

      expect(h.batchApi.callsFor('File')[0].arg.groupId).to.equal('pipeline-files:6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13');
      expect(h.batchApi.callsFor('Thing')[0].arg.groupId).to.equal('6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13');
    });

    it('sends a record per file with deletes on when every file resolves', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' });
      h.files.views.set(HUB.fileId, { fileVersionId: 'v-hub', size: 512, mimeType: null });

      await h.impl.run({ files: [UPLOAD, HUB] });

      const calls = h.batchApi.callsFor('File');
      expect(calls.map((c) => c.op)).to.deep.equal(['create', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1])).to.deep.equal([
        { id: UPLOAD.fileId, name: 'policy.pdf', fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' },
        { id: HUB.fileId, name: 'evidence.csv', fileVersionId: 'v-hub', size: 512 },
      ]);
      expect(h.files.copies).to.deep.equal([{
        sourceTarget: '3a9f1c27-6e4b-4d8a-b5c3-1f2e3d4c5b6a',
        sourcePath: 'content_acme/controls/evidence.csv',
        destinationPath: '/pipelines/evidence.csv',
      }]);
      expect(h.files.calls).to.deep.equal([
        `get ${UPLOAD.fileId}`,
        'copy /pipelines/evidence.csv',
        `get ${HUB.fileId}`,
      ]);
      expect(h.logger.at('warn').filter((m) => /pipeline file/i.test(m))).to.deep.equal([]);
    });

    it('takes the record name from the pipeline entry, not file-service', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 1, name: 'stored-name.pdf' } as FileServiceFile);

      await h.impl.run({ files: [UPLOAD] });

      expect(payloads(h.batchApi.callsFor('File')[1])[0].name).to.equal('policy.pdf');
    });

    it('still resolves a hub file whose copy fails, using the version file-service has', async () => {
      const h = newHarness();
      h.files.failCopy = true;
      h.files.views.set(HUB.fileId, { fileVersionId: 'v-hub', size: 512, mimeType: 'text/csv' });

      await h.impl.run({ files: [HUB] });

      const calls = h.batchApi.callsFor('File');
      expect(calls.map((c) => c.op)).to.deep.equal(['create', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1])).to.deep.equal([
        { id: HUB.fileId, name: 'evidence.csv', fileVersionId: 'v-hub', size: 512, mimeType: 'text/csv' },
      ]);
      expect(h.logger.at('warn').some((m) => m.includes('Could not copy'))).to.equal(true);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('falls back to the status version when the view has none', async () => {
      const h = newHarness();
      h.files.views.set(HUB.fileId, { fileVersionId: null, size: 512, mimeType: 'text/csv' });
      h.files.statuses.set(HUB.fileId, { status: 'fetching', fileVersionId: 'v-status' });

      await h.impl.run({ files: [HUB] });

      const calls = h.batchApi.callsFor('File');
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1])[0].fileVersionId).to.equal('v-status');
      expect(h.logger.at('warn').some((m) => m.includes('from its status (fetching)'))).to.equal(true);
    });

    it('leaves unresolved files out and turns deletes off, logging at warn only', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' });
      h.files.views.set(NO_VERSION.fileId, { fileVersionId: undefined, size: 3, mimeType: 'text/plain' });
      h.files.statuses.set(NO_VERSION.fileId, { status: 'error', fileVersionId: 'v-errored' });
      h.files.views.set(NO_SIZE.fileId, { fileVersionId: 'v-sizeless', size: null, mimeType: 'text/plain' });

      await h.impl.run({ files: [UPLOAD, MISSING, NO_VERSION, NO_SIZE] });

      const calls = h.batchApi.callsFor('File');
      expect(calls.map((c) => c.op)).to.deep.equal(['create', 'log', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: false });
      expect(calls[1].arg.logLevel).to.equal(BatchLogLevelEnum.Warn);
      expect(payloads(calls[2])).to.deep.equal([
        { id: UPLOAD.fileId, name: 'policy.pdf', fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' },
      ]);
      const unresolved = h.logger.at('warn').filter((m) => m.includes('is unresolved'));
      expect(unresolved).to.have.length(3);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('sends no batch when no file resolves', async () => {
      const h = newHarness();
      h.files.views.set(NO_SIZE.fileId, { fileVersionId: 'v-sizeless', size: undefined });

      await h.impl.run({ files: [MISSING, NO_SIZE] });

      expect(h.batchApi.callsFor('File')).to.deep.equal([]);
      expect(h.logger.at('warn').some((m) => m.includes('None of the 2'))).to.equal(true);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('skips files entirely on a preview run', async () => {
      for (const files of [[UPLOAD, HUB], []]) {
        const h = newHarness({ previewMode: true, previewCount: 5 });
        h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });

        await h.impl.run({ files });

        expect(h.files.calls).to.deep.equal([]);
        expect(h.batchApi.callsFor('File')).to.deep.equal([]);
      }
    });

    it('logs an error on the batch and still ends it when addItems throws', async () => {
      const h = newHarness();
      h.batchApi.failAddItems = true;
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });

      await h.impl.run({ files: [UPLOAD] });

      const calls = h.batchApi.callsFor('File');
      expect(calls.map((c) => c.op)).to.deep.equal(['create', 'addItems', 'log', 'end']);
      expect(calls[2].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
      expect(calls[2].arg.message).to.contain('addBatchItems exploded');
    });

    it('collects files before init, so they are sent even when init fails', async () => {
      const h = newHarness();
      h.dataproducer.metadata = async () => {
        throw new Error('producer unreachable');
      };

      let failure: Error | undefined;
      try {
        await h.impl.run({ files: [] });
      } catch (error) {
        failure = error as Error;
      }

      expect(failure?.message).to.equal('Unable to initialize collector');
      expect(h.batchApi.callsFor('File').map((c) => c.op)).to.deep.equal(['create', 'end']);
    });
  });

  describe('data mappings', () => {
    it('logs an error on the batch before ending it when the source fetch fails', async () => {
      const h = newHarness();

      await h.impl.run({ dataMappings: [THING_MAPPING] });

      const calls = h.batchApi.callsFor('Thing');
      expect(calls.map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(calls[1].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
      expect(calls[1].arg.message).to.contain('collection fetch timed out');
    });
  });
});
