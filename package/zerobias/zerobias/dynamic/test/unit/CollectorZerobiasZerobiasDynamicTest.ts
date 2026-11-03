import 'reflect-metadata';

import { expect } from 'chai';
import { BatchLogLevelEnum } from '@zerobias-com/platform-sdk';
import { URL, UUID } from '@zerobias-org/types-core-js';
import { CollectorZerobiasZerobiasDynamicImpl } from '../../src/CollectorZerobiasZerobiasDynamicImpl.js';
import {
  FileService,
  FileServiceCopyJob,
  FileServiceCopyRequest,
  FileServiceError,
  FileServiceFile,
  FileServiceFileStatus,
} from '../../src/FileServiceClient.js';
import { DataMapping, DataMappingParams, PipelineFile } from '../../src/types/index.js';

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

const HUB_2: PipelineFile = {
  fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b06',
  name: 'inventory.csv',
  source: 'hub',
  targetId: '3a9f1c27-6e4b-4d8a-b5c3-1f2e3d4c5b6a',
  objectId: 'content_acme/controls/inventory.csv',
  destinationPath: '/pipelines/inventory.csv',
};

const MISSING: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b03', name: 'gone.txt', source: 'upload' };
const NO_VERSION: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b04', name: 'pending.txt', source: 'upload' };
const NO_SIZE: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b05', name: 'sizeless.txt', source: 'upload' };
const BROKEN: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b07', name: 'broken.txt', source: 'upload' };
const GONE_HUB: PipelineFile = { ...HUB, fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b08', name: 'deleted.csv' };
const EMPTY: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b09', name: 'empty.txt', source: 'upload' };

/** The view of a file whose upload or copy never finished: no ready version, so no size either. */
const NOT_READY_VIEW: FileServiceFile = { fileVersionId: null, size: null, mimeType: null };

interface BatchCall {
  op: 'create' | 'addItems' | 'addItem' | 'log' | 'end';
  batchId: string;
  arg?: any;
}

/** Platform BatchApi fake that records every call, in order, against the batch it targets. */
class FakeBatchApi {
  calls: BatchCall[] = [];

  failAddItems = false;

  failLogs = false;

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
    if (this.failLogs) {
      throw new Error('createBatchLog socket hang up');
    }
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

/** Platform PipelineApi fake: `get` answers with the pipeline's current `params`, or throws `getError`. */
class FakePipelineApi {
  gets: string[] = [];

  params?: Record<string, unknown> | null;

  getError?: Error;

  async get(pipelineId: UUID) {
    this.gets.push(String(pipelineId));
    if (this.getError) {
      throw this.getError;
    }
    return { id: pipelineId, params: this.params };
  }
}

/**
 * file-service fake. A file with no view answers 404 unless `viewErrors` holds another failure for it. A copy
 * answers with `copyStatus`, ready by default; `statuses` lists what each version's status reads, poll by poll,
 * repeating the last.
 */
class FakeFileService implements FileService {
  calls: string[] = [];

  copies: FileServiceCopyRequest[] = [];

  copyError?: Error;

  copyStatus: FileServiceFileStatus = { status: 'ready', fileVersionId: 'v-copied' };

  views = new Map<string, FileServiceFile>();

  viewErrors = new Map<string, Error>();

  statuses = new Map<string, FileServiceFileStatus[]>();

  async copyFile(request: FileServiceCopyRequest): Promise<FileServiceCopyJob> {
    this.calls.push(`copy ${request.destinationPath}`);
    this.copies.push(request);
    if (this.copyError) {
      throw this.copyError;
    }
    return { transactionId: 'a8d1f0c2-7b3e-4c5d-9e6f-1a2b3c4d5e6f', file: {}, status: this.copyStatus };
  }

  async getFile(fileId: string): Promise<FileServiceFile> {
    this.calls.push(`get ${fileId}`);
    const error = this.viewErrors.get(fileId);
    if (error) {
      throw error;
    }
    const view = this.views.get(fileId);
    if (!view) {
      throw new FileServiceError(`file-service GET /files/${fileId}/metadata returned 404`, 404);
    }
    return view;
  }

  async getFileStatus(versionOrFileId: string): Promise<FileServiceFileStatus> {
    this.calls.push(`status ${versionOrFileId}`);
    const queue = this.statuses.get(versionOrFileId);
    if (!queue || queue.length === 0) {
      throw new FileServiceError(`file-service GET /files/${versionOrFileId}/status returned 404`, 404);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
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

/** Build the Impl directly over a fake platform, dataproducer, file-service and logger, with short copy waits. */
function newHarness(context: Record<string, unknown> = {}) {
  const batchApi = new FakeBatchApi();
  const pipelineApi = new FakePipelineApi();
  const platform = { isConnected: () => true, getBatchApi: () => batchApi, getPipelineApi: () => pipelineApi };
  let metadataCalls = 0;
  const dataproducer: Record<string, any> = {
    metadata: async () => {
      metadataCalls += 1;
      return { tags: [] };
    },
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
  impl.copyWait = { perFileMs: 200, perRunMs: 400, pollMs: 2 };
  return { impl, batchApi, pipelineApi, dataproducer, files, logger, metadataCalls: () => metadataCalls };
}

type Harness = ReturnType<typeof newHarness>;

/** Run with `files` in the launch params and the same list as the pipeline's current params. */
async function runWithFiles(h: Harness, files: unknown[], params: DataMappingParams = {}): Promise<void> {
  h.pipelineApi.params = { files };
  await h.impl.run({ ...params, files: files as PipelineFile[] });
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

function ops(calls: BatchCall[]): string[] {
  return calls.map((c) => c.op);
}

describe('CollectorZerobiasZerobiasDynamicImpl', () => {
  describe('pipeline files', () => {
    it('does not touch files when the launch params have no files', async () => {
      const h = newHarness();
      h.pipelineApi.params = { files: [UPLOAD] };

      await h.impl.run({});

      expect(h.pipelineApi.gets).to.deep.equal([]);
      expect(h.files.calls).to.deep.equal([]);
      expect(h.batchApi.calls).to.deep.equal([]);
    });

    it('sends an empty File batch with deletes on for an empty file list', async () => {
      const h = newHarness();

      await runWithFiles(h, []);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'end']);
      expect(calls[0].arg).to.include({ className: 'File', deletesEnabled: true });
      expect(h.files.calls).to.deep.equal([]);
    });

    it('writes the File batch to the pipeline-files group, apart from the mapping batches', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 10, mimeType: 'application/pdf' });

      await runWithFiles(h, [UPLOAD], { dataMappings: [THING_MAPPING] });

      expect(h.batchApi.callsFor('File')[0].arg.groupId).to.equal('pipeline-files:6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13');
      expect(h.batchApi.callsFor('Thing')[0].arg.groupId).to.equal('6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13');
    });

    it('sends a record per file with deletes on when every file resolves', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' });
      h.files.views.set(HUB.fileId, { fileVersionId: 'v-hub', size: 512, mimeType: null });

      await runWithFiles(h, [UPLOAD, HUB]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'addItems', 'end']);
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
        `get ${HUB.fileId}`,
        'copy /pipelines/evidence.csv',
        `get ${HUB.fileId}`,
      ]);
      expect(h.logger.at('warn').filter((m) => /pipeline file/i.test(m))).to.deep.equal([]);
    });

    it('builds each record with exactly the platform keys, in its order', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, {
        mimeType: 'application/pdf', size: 2048, fileVersionId: 'v-upload', name: 'stored-name.pdf', id: 'other',
      } as FileServiceFile);
      h.files.views.set(EMPTY.fileId, { fileVersionId: 'v-empty', size: 0, mimeType: '' });

      await runWithFiles(h, [UPLOAD, EMPTY]);

      const items = payloads(h.batchApi.callsFor('File')[1]);
      expect(items.map((item) => JSON.stringify(item))).to.deep.equal([
        `{"id":"${UPLOAD.fileId}","name":"policy.pdf","fileVersionId":"v-upload","size":2048,"mimeType":"application/pdf"}`,
        `{"id":"${EMPTY.fileId}","name":"empty.txt","fileVersionId":"v-empty","size":0}`,
      ]);
    });

    it('sends records in chunks of 500', async () => {
      const h = newHarness();
      const entries: PipelineFile[] = [];
      for (let i = 0; i < 1201; i += 1) {
        const entry: PipelineFile = { fileId: `0e7c2a14-9b3d-4f6a-8c21-${String(i).padStart(12, '0')}`, name: `f${i}.txt`, source: 'upload' };
        entries.push(entry);
        h.files.views.set(entry.fileId, { fileVersionId: `v-${i}`, size: i, mimeType: 'text/plain' });
      }

      await runWithFiles(h, entries);

      const adds = h.batchApi.callsFor('File').filter((c) => c.op === 'addItems');
      expect(adds.map((c) => c.arg.length)).to.deep.equal([500, 500, 201]);
      expect(adds.flatMap(payloads).map((record) => record.id)).to.deep.equal(entries.map((e) => e.fileId));
    });

    describe('current params', () => {
      it('collects the list the pipeline has now, not the launch-time one', async () => {
        const h = newHarness();
        h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });
        h.files.views.set(HUB.fileId, { fileVersionId: 'v-hub', size: 512 });
        h.pipelineApi.params = { files: [HUB] };

        await h.impl.run({ files: [UPLOAD] });

        expect(h.pipelineApi.gets).to.deep.equal([PIPELINE_ID]);
        const calls = h.batchApi.callsFor('File');
        expect(calls[0].arg).to.include({ deletesEnabled: true });
        expect(payloads(calls[1]).map((record) => record.id)).to.deep.equal([HUB.fileId]);
        expect(h.files.calls).to.not.include(`get ${UPLOAD.fileId}`);
      });

      it('sends no File batch when the pipeline no longer has a files key', async () => {
        for (const params of [{}, null, { files: null }]) {
          const h = newHarness();
          h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });
          h.pipelineApi.params = params;

          await h.impl.run({ files: [UPLOAD] });

          expect(h.pipelineApi.gets, JSON.stringify(params)).to.have.length(1);
          expect(h.files.calls).to.deep.equal([]);
          expect(h.batchApi.calls).to.deep.equal([]);
        }
      });

      it('falls back to the launch-time list with deletes off when the current params cannot be read', async () => {
        const h = newHarness();
        h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });
        h.pipelineApi.getError = new Error('platform returned 503');

        await h.impl.run({ files: [UPLOAD] });

        const calls = h.batchApi.callsFor('File');
        expect(ops(calls)).to.deep.equal(['create', 'log', 'addItems', 'end']);
        expect(calls[0].arg).to.include({ deletesEnabled: false });
        expect(calls[1].arg.logLevel).to.equal(BatchLogLevelEnum.Warn);
        expect(calls[1].arg.message).to.contain('current file list could not be read');
        expect(payloads(calls[2]).map((record) => record.id)).to.deep.equal([UPLOAD.fileId]);
        expect(h.logger.at('warn').some((m) => m.includes('platform returned 503'))).to.equal(true);
        expect(h.logger.at('error')).to.deep.equal([]);
      });
    });

    it('skips malformed entries, counting them as unresolved', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });
      const malformed = [
        null,
        'policy.pdf',
        { fileId: 7, name: 'number-id.txt', source: 'upload' },
        { fileId: 'f-1', source: 'upload' },
        { fileId: 'f-2', name: 'mystery.txt', source: 'ftp' },
        { fileId: 'f-3', name: 'half-hub.csv', source: 'hub', targetId: 't-1', objectId: 'o-1' },
      ];

      await runWithFiles(h, [UPLOAD, ...malformed]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'log', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: false });
      expect(calls[1].arg.message).to.contain('6 of 7 pipeline file(s) could not be resolved');
      expect(payloads(calls[2]).map((record) => record.id)).to.deep.equal([UPLOAD.fileId]);
      expect(h.logger.at('warn').filter((m) => m.includes('is malformed'))).to.have.length(6);
      expect(h.files.calls).to.deep.equal([`get ${UPLOAD.fileId}`]);
    });

    it('leaves gone files out with deletes still on, and never copies a gone Hub file', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });

      await runWithFiles(h, [UPLOAD, MISSING, GONE_HUB]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1]).map((record) => record.id)).to.deep.equal([UPLOAD.fileId]);
      expect(h.files.copies).to.deep.equal([]);
      expect(h.logger.at('warn').filter((m) => m.includes('no longer exists'))).to.have.length(2);
    });

    it('sends an empty File batch with deletes on when every file is gone', async () => {
      const h = newHarness();

      await runWithFiles(h, [MISSING, GONE_HUB]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: true });
    });

    it('leaves a file with no ready version out with deletes still on', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });
      h.files.views.set(NO_VERSION.fileId, NOT_READY_VIEW);

      await runWithFiles(h, [UPLOAD, NO_VERSION]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1]).map((record) => record.id)).to.deep.equal([UPLOAD.fileId]);
      expect(h.files.calls.filter((c) => c.startsWith('status'))).to.deep.equal([]);
    });

    it('leaves unresolved files out and turns deletes off, logging at warn only', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' });
      h.files.viewErrors.set(BROKEN.fileId, new FileServiceError('file-service GET /files/x/metadata returned 500', 500));
      h.files.views.set(NO_SIZE.fileId, { fileVersionId: 'v-sizeless', size: null, mimeType: 'text/plain' });

      await runWithFiles(h, [UPLOAD, BROKEN, NO_SIZE]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'log', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: false });
      expect(calls[1].arg.logLevel).to.equal(BatchLogLevelEnum.Warn);
      expect(calls[1].arg.message).to.contain('2 of 3 pipeline file(s) could not be resolved');
      expect(payloads(calls[2])).to.deep.equal([
        { id: UPLOAD.fileId, name: 'policy.pdf', fileVersionId: 'v-upload', size: 2048, mimeType: 'application/pdf' },
      ]);
      expect(h.logger.at('warn').filter((m) => m.includes('is unresolved'))).to.have.length(2);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('sends no batch when nothing produced a record and something is unresolved', async () => {
      const h = newHarness();
      h.files.viewErrors.set(BROKEN.fileId, new FileServiceError('file-service GET /files/x/metadata failed: fetch failed'));

      await runWithFiles(h, [MISSING, BROKEN]);

      expect(h.batchApi.callsFor('File')).to.deep.equal([]);
      expect(h.logger.at('warn').some((m) => m.includes('sending no File batch'))).to.equal(true);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('takes the record name from the pipeline entry, not file-service', async () => {
      const h = newHarness();
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 1, name: 'stored-name.pdf' } as FileServiceFile);

      await runWithFiles(h, [UPLOAD]);

      expect(payloads(h.batchApi.callsFor('File')[1])[0].name).to.equal('policy.pdf');
    });

    it('still resolves a Hub file whose copy fails, using the view it already read', async () => {
      const h = newHarness();
      h.files.copyError = new FileServiceError('file-service PUT /copyFile returned 502', 502);
      h.files.views.set(HUB.fileId, { fileVersionId: 'v-hub', size: 512, mimeType: 'text/csv' });

      await runWithFiles(h, [HUB]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'addItems', 'end']);
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1])).to.deep.equal([
        { id: HUB.fileId, name: 'evidence.csv', fileVersionId: 'v-hub', size: 512, mimeType: 'text/csv' },
      ]);
      expect(h.files.calls).to.deep.equal([`get ${HUB.fileId}`, 'copy /pipelines/evidence.csv']);
      expect(h.logger.at('warn').some((m) => m.includes('Could not copy'))).to.equal(true);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('waits for a Hub copy to be ready, then records the version it fetched', async () => {
      const h = newHarness();
      h.files.views.set(HUB.fileId, { fileVersionId: 'v-old', size: 512, mimeType: 'text/csv' });
      h.files.copyStatus = { status: 'created', fileVersionId: 'v-new' };
      const states = ['fetching', 'fetching', 'ready'];
      h.files.getFileStatus = async (versionOrFileId: string) => {
        h.files.calls.push(`status ${versionOrFileId}`);
        const status = states.shift()!;
        if (status === 'ready') {
          h.files.views.set(HUB.fileId, { fileVersionId: 'v-new', size: 640, mimeType: 'text/csv' });
        }
        return { status, fileVersionId: versionOrFileId };
      };

      await runWithFiles(h, [HUB]);

      const calls = h.batchApi.callsFor('File');
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1])).to.deep.equal([
        { id: HUB.fileId, name: 'evidence.csv', fileVersionId: 'v-new', size: 640, mimeType: 'text/csv' },
      ]);
      expect(h.files.calls).to.deep.equal([
        `get ${HUB.fileId}`,
        'copy /pipelines/evidence.csv',
        'status v-new',
        'status v-new',
        'status v-new',
        `get ${HUB.fileId}`,
      ]);
      expect(h.logger.at('warn').filter((m) => /pipeline file/i.test(m))).to.deep.equal([]);
    });

    it('stops waiting for a copy after the per-file bound, and not at all once the run bound is spent', async () => {
      const h = newHarness();
      h.impl.copyWait = { perFileMs: 40, perRunMs: 40, pollMs: 5 };
      h.files.views.set(HUB.fileId, { fileVersionId: 'v-old', size: 512 });
      h.files.views.set(HUB_2.fileId, { fileVersionId: 'v-old-2', size: 256 });
      h.files.copyStatus = { status: 'fetching', fileVersionId: 'v-new' };
      h.files.statuses.set('v-new', [{ status: 'fetching', fileVersionId: 'v-new' }]);

      const started = Date.now();
      await runWithFiles(h, [HUB, HUB_2]);
      const elapsed = Date.now() - started;

      const calls = h.batchApi.callsFor('File');
      expect(calls[0].arg).to.include({ deletesEnabled: true });
      expect(payloads(calls[1]).map((record) => record.fileVersionId)).to.deep.equal(['v-old', 'v-old-2']);
      expect(h.files.copies.map((c) => c.destinationPath)).to.deep.equal(['/pipelines/evidence.csv', '/pipelines/inventory.csv']);
      const secondCopy = h.files.calls.indexOf('copy /pipelines/inventory.csv');
      expect(h.files.calls.slice(0, secondCopy).filter((c) => c === 'status v-new')).to.not.be.empty;
      expect(h.files.calls.slice(secondCopy + 1)).to.deep.equal([`get ${HUB_2.fileId}`]);
      expect(h.logger.at('warn').some((m) => m.includes('Stopped waiting') && m.includes('evidence.csv'))).to.equal(true);
      expect(h.logger.at('warn').some((m) => m.includes('Not waiting') && m.includes('inventory.csv'))).to.equal(true);
      expect(elapsed).to.be.lessThan(1000);
    });

    it('skips files entirely on a preview run', async () => {
      for (const files of [[UPLOAD, HUB], []]) {
        const h = newHarness({ previewMode: true, previewCount: 5 });
        h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });

        await runWithFiles(h, files);

        expect(h.pipelineApi.gets).to.deep.equal([]);
        expect(h.files.calls).to.deep.equal([]);
        expect(h.batchApi.callsFor('File')).to.deep.equal([]);
      }
    });

    it('logs an error on the batch and then ends it when addItems throws', async () => {
      const h = newHarness();
      h.batchApi.failAddItems = true;
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });

      await runWithFiles(h, [UPLOAD]);

      const calls = h.batchApi.callsFor('File');
      expect(ops(calls)).to.deep.equal(['create', 'addItems', 'log', 'end']);
      expect(calls[2].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
      expect(calls[2].arg.message).to.contain('addBatchItems exploded');
    });

    it('leaves the batch open and rethrows when addItems throws and the error log fails too', async () => {
      const h = newHarness();
      h.batchApi.failAddItems = true;
      h.batchApi.failLogs = true;
      h.files.views.set(UPLOAD.fileId, { fileVersionId: 'v-upload', size: 2048 });

      await runWithFiles(h, [UPLOAD]);

      expect(ops(h.batchApi.callsFor('File'))).to.deep.equal(['create', 'addItems', 'log']);
      expect(h.logger.at('error')).to.include('Failed to collect pipeline files: addBatchItems exploded');
    });

    it('collects files without calling init when there are no data mappings', async () => {
      const h = newHarness();
      h.dataproducer.metadata = async () => {
        throw new Error('producer unreachable');
      };

      await runWithFiles(h, []);

      expect(ops(h.batchApi.callsFor('File'))).to.deep.equal(['create', 'end']);
      expect(h.logger.at('error')).to.deep.equal([]);
    });

    it('collects files before init, so they are sent even when init fails', async () => {
      const h = newHarness();
      h.dataproducer.metadata = async () => {
        throw new Error('producer unreachable');
      };

      let failure: Error | undefined;
      try {
        await runWithFiles(h, [], { dataMappings: [THING_MAPPING] });
      } catch (error) {
        failure = error as Error;
      }

      expect(failure?.message).to.equal('Unable to initialize collector');
      expect(ops(h.batchApi.callsFor('File'))).to.deep.equal(['create', 'end']);
      expect(h.batchApi.callsFor('Thing')).to.deep.equal([]);
    });
  });

  describe('data mappings', () => {
    it('calls init when there are data mappings', async () => {
      const h = newHarness();

      await h.impl.run({ dataMappings: [THING_MAPPING] });

      expect(h.metadataCalls()).to.equal(1);
    });

    it('does not call init without data mappings', async () => {
      const h = newHarness();

      await h.impl.run({ dataMappings: [] });

      expect(h.metadataCalls()).to.equal(0);
      expect(h.batchApi.calls).to.deep.equal([]);
    });

    it('logs an error on the batch before ending it when the source fetch fails', async () => {
      const h = newHarness();

      await h.impl.run({ dataMappings: [THING_MAPPING] });

      const calls = h.batchApi.callsFor('Thing');
      expect(ops(calls)).to.deep.equal(['create', 'log', 'end']);
      expect(calls[1].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
      expect(calls[1].arg.message).to.contain('collection fetch timed out');
      expect(h.logger.at('error')).to.include('Failed to process data mapping mapping-1: collection fetch timed out');
    });

    it('leaves the batch open and rethrows when the source fetch fails and the error log fails too', async () => {
      const h = newHarness();
      h.batchApi.failLogs = true;

      await h.impl.run({ dataMappings: [THING_MAPPING] });

      expect(ops(h.batchApi.callsFor('Thing'))).to.deep.equal(['create', 'log']);
      expect(h.logger.at('error')).to.include('Failed to process data mapping mapping-1: collection fetch timed out');
    });
  });
});
