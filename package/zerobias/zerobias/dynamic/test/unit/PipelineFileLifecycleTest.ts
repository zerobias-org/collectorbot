import 'reflect-metadata';

import { expect } from 'chai';
import { BatchLogLevelEnum } from '@zerobias-com/platform-sdk';
import { URL, UUID } from '@zerobias-org/types-core-js';
import { CollectorZerobiasZerobiasDynamicImpl } from '../../src/CollectorZerobiasZerobiasDynamicImpl.js';
import {
  FileService,
  FileServiceContainer,
  FileServiceCopyJob,
  FileServiceCopyRequest,
  FileServiceError,
  FileServiceFile,
  FileServiceFileStatus,
  FileServiceRecordsPage,
} from '../../src/FileServiceClient.js';
import { DataMapping, PipelineFile } from '../../src/types/index.js';

const JOB_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const PIPELINE_ID = '6f1c9a52-3d2b-4c8e-9a71-2b5d0e4f8c13';
const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';
const TARGET_ID = '3a9f1c27-6e4b-4d8a-b5c3-1f2e3d4c5b6a';

/** A workbook copied from a Hub target, whose sheets the floor plan mappings read. */
const PLAN: PipelineFile = {
  fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b21',
  name: 'floorplan.xlsx',
  source: 'hub',
  targetId: TARGET_ID,
  objectId: 'drive_items/floorplan.xlsx',
  destinationPath: '/pipeline/plan',
};

/** A second workbook, uploaded, whose sheets map into the same classes. */
const OTHER_PLAN: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b22', name: 'second-floor.xlsx', source: 'upload' };

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

  /** Every batch created for `className`, each as its calls in order. */
  batchesFor(className: string): BatchCall[][] {
    return this.calls
      .filter((c) => c.op === 'create' && c.arg.className === className)
      .map((create) => this.calls.filter((c) => c.batchId === create.batchId));
  }
}

/** Platform PipelineApi fake: each `get` answers with the next of `answers`, then with `params`; an Error is thrown. */
class FakePipelineApi {
  answers: (Record<string, unknown> | Error)[] = [];

  params?: Record<string, unknown>;

  async get(pipelineId: UUID) {
    const answer = this.answers.length > 0 ? this.answers.shift() : this.params;
    if (answer instanceof Error) {
      throw answer;
    }
    return { id: pipelineId, params: answer };
  }
}

/**
 * file-service fake for pipeline files and the mappings that read them. A file with no view answers 404. A copy
 * throws the error `copyErrors` holds for its destination, and is otherwise ready at once. `records` holds each
 * container's rows by `<versionId>:<containerPath>`, and a container with none answers 404. `calls` lists every call.
 */
class FakeFiles implements FileService {
  calls: string[] = [];

  views = new Map<string, FileServiceFile>();

  copyErrors = new Map<string, Error>();

  records = new Map<string, Record<string, unknown>[]>();

  async copyFile(request: FileServiceCopyRequest): Promise<FileServiceCopyJob> {
    this.calls.push(`copy ${request.destinationPath}`);
    const error = this.copyErrors.get(request.destinationPath);
    if (error) {
      throw error;
    }
    return { transactionId: 'a8d1f0c2-7b3e-4c5d-9e6f-1a2b3c4d5e6f', file: {}, status: { status: 'ready', fileVersionId: 'v-copied' } };
  }

  async getFile(fileId: string): Promise<FileServiceFile> {
    this.calls.push(`get ${fileId}`);
    const view = this.views.get(fileId);
    if (!view) {
      throw new FileServiceError(`file-service GET /files/${fileId}/metadata returned 404`, 404);
    }
    return view;
  }

  async getFileStatus(versionOrFileId: string): Promise<FileServiceFileStatus> {
    this.calls.push(`status ${versionOrFileId}`);
    return { status: 'ready', fileVersionId: versionOrFileId };
  }

  async getContainer(versionId: string, containerPath: string): Promise<FileServiceContainer> {
    this.calls.push(`container ${versionId} ${containerPath}`);
    return { path: containerPath, records: this.rowsOf(versionId, containerPath).length, subcontainers: 0 };
  }

  async listContainerRecords(versionId: string, containerPath: string, pageNumber: number, pageSize: number): Promise<FileServiceRecordsPage> {
    this.calls.push(`records ${versionId} ${containerPath} page ${pageNumber}`);
    const rows = this.rowsOf(versionId, containerPath);
    return { items: rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), count: rows.length > 0 ? rows.length : -1 };
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

/** Build the Impl over fake platform APIs and file-service; every mapping here reads a file, never the DataProducer. */
function newHarness(context: Record<string, unknown> = {}) {
  const batchApi = new FakeBatchApi();
  const pipelineApi = new FakePipelineApi();
  const platform = { isConnected: () => true, getBatchApi: () => batchApi, getPipelineApi: () => pipelineApi };
  const unreachable = async () => {
    throw new Error('a run of file-backed mappings must not reach the DataProducer');
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
    { isConnected: unreachable, metadata: unreachable } as any,
    platform as any,
  );
  const files = new FakeFiles();
  const logger = new RecordingLogger();
  impl.fileService = files;
  impl.logger = logger as any;
  impl.copyWait = { perFileMs: 200, perRunMs: 400, pollMs: 2 };
  return { impl, batchApi, pipelineApi, files, logger };
}

type Harness = ReturnType<typeof newHarness>;

/** A mapping from sheet `sheet` of `file` into the class of the same name, copying `id` and `name`. */
function sheetMapping(file: PipelineFile, sheet: string): DataMapping {
  const rule = (key: string) => ({
    id: `r-${key}`,
    source: { key, name: key, type: 'string', level: 0 },
    transform: { type: 'direct' },
    destination: { key, name: key },
  });
  return {
    id: `mapping-${file.name}-${sheet}`,
    source: { objectName: sheet, objectPath: [], file: { fileId: file.fileId, containerPath: `/${sheet}` } },
    destination: { className: sheet, classId: `class-${sheet}`, schema: { dataTypes: [], properties: [] } },
    mappings: [rule('id'), rule('name')],
    metadata: { name: `${file.name} ${sheet}`, createdAt: '', description: '' },
    context: {},
  } as unknown as DataMapping;
}

/** `count` sheet rows with ids `<prefix>-0` onwards. */
function rows(prefix: string, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}` }));
}

/** Run with `files` at launch and as the pipeline's current list, and expect the run itself to complete. */
async function runWithFiles(h: Harness, files: PipelineFile[], dataMappings: DataMapping[]): Promise<void> {
  h.pipelineApi.params = { files };
  await h.impl.run({ files, dataMappings });
  expect(h.logger.at('info')).to.include('All data mappings completed');
}

/** Every payload sent to `batch`, whichever add call carried it. */
function payloadsOf(batch: BatchCall[]): any[] {
  return batch.flatMap((c) => {
    if (c.op === 'addItems') {
      return c.arg.map((item: any) => item.payload);
    }
    return c.op === 'addItem' ? [c.arg.payload] : [];
  });
}

/** The batch calls of `batch` other than item adds. */
function controlOpsOf(batch: BatchCall[]): string[] {
  return batch.filter((c) => c.op !== 'addItem' && c.op !== 'addItems').map((c) => c.op);
}

describe('CollectorZerobiasZerobiasDynamicImpl — a pipeline file that is missing or removed', () => {
  describe('a file that can\'t be refreshed', () => {
    it('fails each mapping that reads it, without reading the copy left in file-service, and still runs the others', async () => {
      const h = newHarness();
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.records.set('v-plan:/PhysicalSpace', rows('space', 2));
      h.files.copyErrors.set('/pipeline/plan', new FileServiceError('file-service PUT /copyFile returned 404: no such object', 404));
      h.files.views.set(OTHER_PLAN.fileId, { fileVersionId: 'v-other', size: 2048 });
      h.files.records.set('v-other:/PhysicalAsset', rows('asset', 3));

      await runWithFiles(h, [PLAN, OTHER_PLAN], [sheetMapping(PLAN, 'PhysicalSpace'), sheetMapping(OTHER_PLAN, 'PhysicalAsset')]);

      const [spaces] = h.batchApi.batchesFor('PhysicalSpace');
      expect(spaces.map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(spaces[0].arg).to.include({ deletesEnabled: false });
      expect(spaces[1].arg.logLevel).to.equal(BatchLogLevelEnum.Error);
      expect(spaces[1].arg.data).to.deep.equal({ transient: false });
      expect(spaces[1].arg.message).to.equal(
        `Source file "floorplan.xlsx" (${PLAN.fileId}) can't be refreshed: it is no longer at its location on target ${TARGET_ID} ` +
        "(file-service answered 404). This mapping's objects keep their last version.",
      );
      expect(h.files.calls.filter((c) => c.includes('v-plan /'))).to.deep.equal([]);
      const [assets] = h.batchApi.batchesFor('PhysicalAsset');
      expect(payloadsOf(assets).map((p) => p.id)).to.deep.equal(['asset-0', 'asset-1', 'asset-2']);
      expect(controlOpsOf(assets)).to.deep.equal(['create', 'end']);
      const [fileBatch] = h.batchApi.batchesFor('File');
      expect(controlOpsOf(fileBatch)).to.deep.equal(['create', 'log', 'end']);
      expect(h.logger.at('error').some((m) => m.startsWith('Failed to process data mapping mapping-floorplan.xlsx-PhysicalSpace')))
        .to.equal(true);
    });

    it('fails the mappings of a file that file-service answers 404 for, naming why', async () => {
      const h = newHarness();

      await runWithFiles(h, [OTHER_PLAN], [sheetMapping(OTHER_PLAN, 'PhysicalAsset')]);

      const [assets] = h.batchApi.batchesFor('PhysicalAsset');
      expect(assets.map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(assets[1].arg.message).to.contain(
        `Source file "second-floor.xlsx" (${OTHER_PLAN.fileId}) can't be refreshed: file-service answered 404 for it`,
      );
      expect(h.files.calls).to.deep.equal([`get ${OTHER_PLAN.fileId}`]);
    });

    it('fails them for a 409 too, when Hub refuses the copy', async () => {
      const h = newHarness();
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.copyErrors.set('/pipeline/plan', new FileServiceError('file-service PUT /copyFile returned 409: access denied', 409));

      await runWithFiles(h, [PLAN], [sheetMapping(PLAN, 'FloorPlan')]);

      const [plans] = h.batchApi.batchesFor('FloorPlan');
      expect(plans.map((c) => c.op)).to.deep.equal(['create', 'log', 'end']);
      expect(plans[1].arg.message).to.contain(`Hub refused to copy it from target ${TARGET_ID} (file-service answered 409)`);
    });
  });

  describe('a file removed from the pipeline', () => {
    it('sends one empty batch for each class that only its mappings wrote, without reading the file', async () => {
      const h = newHarness();
      h.files.views.set(OTHER_PLAN.fileId, { fileVersionId: 'v-other', size: 2048 });
      h.files.records.set('v-other:/PhysicalAsset', rows('asset', 3));

      // The pipeline no longer lists PLAN, while this job's launch params still carry its mappings
      await runWithFiles(h, [OTHER_PLAN], [
        sheetMapping(PLAN, 'PhysicalSpace'),
        sheetMapping(PLAN, 'FloorPlan'),
        sheetMapping(OTHER_PLAN, 'PhysicalAsset'),
      ]);

      for (const className of ['PhysicalSpace', 'FloorPlan']) {
        const batches = h.batchApi.batchesFor(className);
        expect(batches, className).to.have.length(1);
        expect(batches[0].map((c) => c.op), className).to.deep.equal(['create', 'end']);
        expect(batches[0][0].arg.deletesEnabled, className).to.not.equal(false);
        expect(h.logger.at('info').some((m) => m.includes(`Sending an empty ${className} batch, so their objects are deleted`)))
          .to.equal(true);
      }
      expect(h.files.calls.filter((c) => c.includes(PLAN.fileId))).to.deep.equal([]);
      const [assets] = h.batchApi.batchesFor('PhysicalAsset');
      expect(payloadsOf(assets).map((p) => p.id)).to.deep.equal(['asset-0', 'asset-1', 'asset-2']);
    });

    it('sends no batch of its own for a class another mapping still writes, whose batch deletes its objects', async () => {
      const h = newHarness();
      h.files.views.set(OTHER_PLAN.fileId, { fileVersionId: 'v-other', size: 2048 });
      h.files.records.set('v-other:/PhysicalSpace', rows('space', 2));

      await runWithFiles(h, [OTHER_PLAN], [sheetMapping(PLAN, 'PhysicalSpace'), sheetMapping(OTHER_PLAN, 'PhysicalSpace')]);

      const batches = h.batchApi.batchesFor('PhysicalSpace');
      expect(batches).to.have.length(1);
      expect(payloadsOf(batches[0]).map((p) => p.id)).to.deep.equal(['space-0', 'space-1']);
      expect(h.logger.at('info').some((m) => m.includes("The class's other batch deletes their objects"))).to.equal(true);
    });

    it('takes no mapping for removed when the pipeline has no files key', async () => {
      const h = newHarness();
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.records.set('v-plan:/PhysicalSpace', rows('space', 2));

      await h.impl.run({ dataMappings: [sheetMapping(PLAN, 'PhysicalSpace')] });

      const [spaces] = h.batchApi.batchesFor('PhysicalSpace');
      expect(payloadsOf(spaces).map((p) => p.id)).to.deep.equal(['space-0', 'space-1']);
      expect(h.batchApi.batchesFor('File')).to.deep.equal([]);
      expect(h.batchApi.batchesFor('EvidenceFile')).to.deep.equal([]);
    });

    it('takes no mapping for removed when the list could not be read right before the File batch', async () => {
      const h = newHarness();
      h.files.views.set(OTHER_PLAN.fileId, { fileVersionId: 'v-other', size: 2048 });
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.records.set('v-plan:/PhysicalSpace', rows('space', 2));
      h.pipelineApi.answers = [{ files: [OTHER_PLAN] }, new Error('platform unavailable')];

      await h.impl.run({ files: [OTHER_PLAN], dataMappings: [sheetMapping(PLAN, 'PhysicalSpace')] });

      const [spaces] = h.batchApi.batchesFor('PhysicalSpace');
      expect(payloadsOf(spaces).map((p) => p.id)).to.deep.equal(['space-0', 'space-1']);
      const [fileBatch] = h.batchApi.batchesFor('File');
      expect(fileBatch[0].arg).to.include({ deletesEnabled: false });
    });

    it('takes no mapping for removed whose file a malformed entry still names', async () => {
      const h = newHarness();
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.records.set('v-plan:/PhysicalSpace', rows('space', 2));
      const malformed = { ...PLAN, evidenceDefinitionIds: 'not-a-list' } as unknown as PipelineFile;

      await runWithFiles(h, [malformed], [sheetMapping(PLAN, 'PhysicalSpace')]);

      const [spaces] = h.batchApi.batchesFor('PhysicalSpace');
      expect(payloadsOf(spaces).map((p) => p.id)).to.deep.equal(['space-0', 'space-1']);
      expect(h.logger.at('info').some((m) => m.includes('read a file the pipeline no longer lists'))).to.equal(false);
    });

    it('takes no mapping for removed when a malformed entry names no file, as it could be any file', async () => {
      const h = newHarness();
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.records.set('v-plan:/PhysicalSpace', rows('space', 2));
      h.files.views.set(OTHER_PLAN.fileId, { fileVersionId: 'v-other', size: 2048 });
      const nameless = { name: 'no-id.xlsx', source: 'upload' } as unknown as PipelineFile;

      await runWithFiles(h, [OTHER_PLAN, nameless], [sheetMapping(PLAN, 'PhysicalSpace')]);

      const [spaces] = h.batchApi.batchesFor('PhysicalSpace');
      expect(payloadsOf(spaces).map((p) => p.id)).to.deep.equal(['space-0', 'space-1']);
    });

    it('clears nothing in a preview run, which skips pipeline files', async () => {
      const h = newHarness({ previewMode: true });
      h.files.views.set(PLAN.fileId, { fileVersionId: 'v-plan', size: 4096 });
      h.files.records.set('v-plan:/PhysicalSpace', rows('space', 2));

      await runWithFiles(h, [], [sheetMapping(PLAN, 'PhysicalSpace')]);

      const [spaces] = h.batchApi.batchesFor('PhysicalSpace');
      expect(payloadsOf(spaces).map((p) => p.id)).to.deep.equal(['space-0', 'space-1']);
      expect(h.batchApi.batchesFor('File')).to.deep.equal([]);
      expect(h.batchApi.batchesFor('EvidenceFile')).to.deep.equal([]);
    });
  });
});
