import 'reflect-metadata';

import { expect } from 'chai';
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

/** The Floor Plans workbook, whose `File` sheet describes the drawing. */
const WORKBOOK: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b41', name: 'floorplan.xlsx', source: 'upload' };

/** The drawing the template ships, as the pipeline's own copy. */
const DRAWING: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b42', name: 'floorplan.webp', source: 'upload' };

/** Where the drawing is copied to when it comes from a Hub target instead. */
const DRAWING_COPY_PATH = '/pipeline/floorplan.webp';

/** The drawing, copied from a Hub target. */
const HUB_DRAWING: PipelineFile = {
  fileId: DRAWING.fileId,
  name: DRAWING.name,
  source: 'hub',
  targetId: TARGET_ID,
  objectId: 'drive_items/floorplan.webp',
  destinationPath: DRAWING_COPY_PATH,
};

/** Another file the pipeline lists under the drawing's name. */
const OTHER_DRAWING: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b43', name: 'floorplan.webp', source: 'upload' };

/** A listed file that file-service answers 404 for. */
const MISSING: PipelineFile = { fileId: '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b44', name: 'gone.txt', source: 'upload' };

/** The Floor Plans template's rule: the drawing's version from `$files`, else the sheet's own `fileVersionId`. */
const TEMPLATE_RULE = '$lookup($files, "floorplan.webp") ? $lookup($files, "floorplan.webp").fileVersionId : (fileVersionId ? $trim(fileVersionId))';

/** The one row of the workbook's `File` sheet, whose `fileVersionId` the template can only guess. */
const SHEET_ROW = { id: 'drawing', name: 'Ground floor', fileVersionId: '  v-sheet  ' };

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
}

/** Platform PipelineApi fake: each `get` answers with the next of `answers`, then with `params`. */
class FakePipelineApi {
  gets: string[] = [];

  answers: Record<string, unknown>[] = [];

  params?: Record<string, unknown>;

  async get(pipelineId: UUID) {
    this.gets.push(String(pipelineId));
    return { id: pipelineId, params: this.answers.length > 0 ? this.answers.shift() : this.params };
  }
}

/**
 * file-service fake. A file with no view answers 404 unless `viewErrors` holds another failure for it. A copy throws
 * the error `copyErrors` holds for its destination; otherwise `afterCopy` runs, as when the copy makes a new version,
 * and the copy is ready at once. `records` holds each container's rows by `<versionId>:<containerPath>`, and a
 * container with none answers 404. `calls` lists every call.
 */
class FakeFiles implements FileService {
  calls: string[] = [];

  views = new Map<string, FileServiceFile>();

  viewErrors = new Map<string, Error>();

  copyErrors = new Map<string, Error>();

  afterCopy?: () => void;

  records = new Map<string, Record<string, unknown>[]>();

  async copyFile(request: FileServiceCopyRequest): Promise<FileServiceCopyJob> {
    this.calls.push(`copy ${request.destinationPath}`);
    const error = this.copyErrors.get(request.destinationPath);
    if (error) {
      throw error;
    }
    this.afterCopy?.();
    return { transactionId: 'a8d1f0c2-7b3e-4c5d-9e6f-1a2b3c4d5e6f', file: {}, status: { status: 'ready', fileVersionId: 'v-copied' } };
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

/**
 * Build the Impl over fake platform APIs and file-service, holding the workbook at version `v-book` with its one
 * `File` sheet row. Every mapping here reads the workbook, never the DataProducer.
 */
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
  files.views.set(WORKBOOK.fileId, { fileVersionId: 'v-book', size: 4096 });
  files.records.set('v-book:/File', [SHEET_ROW]);
  const logger = new RecordingLogger();
  impl.fileService = files;
  impl.logger = logger as any;
  impl.copyWait = { perFileMs: 200, perRunMs: 400, pollMs: 2 };
  return { impl, batchApi, pipelineApi, files, logger };
}

type Harness = ReturnType<typeof newHarness>;

/** A rule that copies the sheet's `key` column into the field of the same name. */
function column(key: string) {
  return { id: `r-${key}`, source: { key, name: key, type: 'string', level: 0 }, transform: { type: 'direct' }, destination: { key, name: key } };
}

/** A rule that sets the field `key` to the JSONata expression `expr`, which reads the sheet's `key` column. */
function expression(key: string, expr: string) {
  return {
    id: `r-${key}`,
    source: { key, name: key, type: 'string', level: 0 },
    transform: { type: 'expression', options: { expression: expr } },
    destination: { key, name: key },
  };
}

/** A mapping from the workbook's `File` sheet into `File`, as the Floor Plans template maps it, then the `extra` rules. */
function fileSheetMapping(...extra: ReturnType<typeof expression>[]): DataMapping {
  return {
    id: 'mapping-file-sheet',
    source: { objectName: 'File', objectPath: [], file: { fileId: WORKBOOK.fileId, containerPath: '/File' } },
    destination: { className: 'File', classId: 'class-file', schema: { dataTypes: [], properties: [] } },
    mappings: [column('id'), column('name'), expression('fileVersionId', TEMPLATE_RULE), ...extra],
    metadata: { name: 'File sheet', createdAt: '', description: '' },
    context: {},
  } as unknown as DataMapping;
}

/** Run with `files` at launch and as the pipeline's current list, and expect the run itself to complete. */
async function runWithFiles(h: Harness, files: PipelineFile[], dataMapping: DataMapping): Promise<void> {
  h.pipelineApi.params = { files };
  await h.impl.run({ files, dataMappings: [dataMapping] });
  expect(h.logger.at('info')).to.include('All data mappings completed');
}

/**
 * The items the File sheet mapping sent, as the platform receives them: its batch is the `File` batch of the
 * pipeline's group, not the one of the pipeline files' own group, and it must carry no log.
 */
function mapped(h: Harness): any[] {
  const creates = h.batchApi.calls.filter((c) => c.op === 'create' && c.arg.className === 'File' && c.arg.groupId === PIPELINE_ID);
  expect(creates, 'mapped File batches').to.have.length(1);
  const calls = h.batchApi.calls.filter((c) => c.batchId === creates[0].batchId);
  expect(calls.filter((c) => c.op === 'log'), 'mapped File batch logs').to.deep.equal([]);
  return JSON.parse(JSON.stringify(calls.filter((c) => c.op === 'addItem').map((c) => c.arg.payload)));
}

describe('CollectorZerobiasZerobiasDynamicImpl — $files in mapping expressions', () => {
  it('gives a rule the version this run resolved for the file it names, after a Hub copy brought a new one', async () => {
    const h = newHarness();
    h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing-1', size: 106928, mimeType: 'image/webp' });
    h.files.afterCopy = () => h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing-2', size: 112640, mimeType: 'image/webp' });

    await runWithFiles(h, [WORKBOOK, HUB_DRAWING], fileSheetMapping());

    expect(mapped(h)).to.deep.equal([{ id: 'drawing', name: 'Ground floor', fileVersionId: 'v-drawing-2' }]);
    expect(h.files.calls).to.include(`copy ${DRAWING_COPY_PATH}`);
  });

  it('binds each resolved file under its listed name, in list order, as { fileId, fileVersionId, name, size, mimeType }', async () => {
    const h = newHarness();
    h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing', size: 106928, mimeType: 'image/webp', name: 'stored-name.webp' });

    await runWithFiles(h, [WORKBOOK, DRAWING], fileSheetMapping(expression('files', '$files')));

    const [{ files }] = mapped(h);
    expect(JSON.stringify(files)).to.equal(JSON.stringify({
      'floorplan.xlsx': { fileId: WORKBOOK.fileId, fileVersionId: 'v-book', name: 'floorplan.xlsx', size: 4096 },
      'floorplan.webp': { fileId: DRAWING.fileId, fileVersionId: 'v-drawing', name: 'floorplan.webp', size: 106928, mimeType: 'image/webp' },
    }));
    const [item] = h.batchApi.calls.filter((c) => c.op === 'addItem').map((c) => c.arg.payload);
    expect(Object.isFrozen(item.files) && Object.values(item.files).every((file) => Object.isFrozen(file))).to.equal(true);
  });

  it('gives a name several listed files share to the first listed', async () => {
    for (const [files, expected] of [[[WORKBOOK, DRAWING, OTHER_DRAWING], 'v-drawing'], [[WORKBOOK, OTHER_DRAWING, DRAWING], 'v-other']] as const) {
      const h = newHarness();
      h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing', size: 106928 });
      h.files.views.set(OTHER_DRAWING.fileId, { fileVersionId: 'v-other', size: 2048 });

      await runWithFiles(h, [...files], fileSheetMapping());

      expect(mapped(h).map((item) => item.fileVersionId), `${expected} listed first`).to.deep.equal([expected]);
    }
  });

  it('goes by the list read right before the batches, so a file added mid-run ahead of another takes their name', async () => {
    const h = newHarness();
    h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing', size: 106928 });
    h.files.views.set(OTHER_DRAWING.fileId, { fileVersionId: 'v-other', size: 2048 });
    h.pipelineApi.answers = [{ files: [WORKBOOK, DRAWING] }, { files: [WORKBOOK, OTHER_DRAWING, DRAWING] }];

    await h.impl.run({ files: [WORKBOOK, DRAWING], dataMappings: [fileSheetMapping()] });

    expect(mapped(h).map((item) => item.fileVersionId)).to.deep.equal(['v-other']);
    expect(h.files.calls.indexOf(`get ${OTHER_DRAWING.fileId}`)).to.be.greaterThan(h.files.calls.indexOf(`get ${DRAWING.fileId}`));
  });

  it('gives a shared name to the first listed file the run resolved, when one listed before it is unresolved', async () => {
    const h = newHarness();
    h.files.viewErrors.set(DRAWING.fileId, new FileServiceError('file-service GET /files/x/metadata returned 500', 500));
    h.files.views.set(OTHER_DRAWING.fileId, { fileVersionId: 'v-other', size: 2048 });

    await runWithFiles(h, [WORKBOOK, DRAWING, OTHER_DRAWING], fileSheetMapping());

    expect(mapped(h).map((item) => item.fileVersionId)).to.deep.equal(['v-other']);
  });

  describe('a file the run could not resolve', () => {
    const scenarios: { state: string; files: PipelineFile[]; arrange: (h: Harness) => void }[] = [
      {
        state: 'unresolved',
        files: [WORKBOOK, DRAWING],
        arrange: (h) => h.files.viewErrors.set(DRAWING.fileId, new FileServiceError('file-service GET /files/x/metadata returned 500', 500)),
      },
      {
        state: 'gone (file-service answers 404)',
        files: [WORKBOOK, DRAWING],
        arrange: () => undefined,
      },
      {
        state: 'failed, as when Hub refuses its copy, though its batch keeps the version file-service has',
        files: [WORKBOOK, HUB_DRAWING],
        arrange: (h) => {
          h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-kept', size: 106928 });
          h.files.copyErrors.set(DRAWING_COPY_PATH, new FileServiceError('file-service PUT /copyFile returned 409: access denied', 409));
        },
      },
      {
        state: 'without a ready version yet',
        files: [WORKBOOK, DRAWING],
        arrange: (h) => h.files.views.set(DRAWING.fileId, { fileVersionId: null, size: null, mimeType: null }),
      },
    ];

    for (const { state, files, arrange } of scenarios) {
      it(`leaves out a file that is ${state}, so the rule falls back to the sheet`, async () => {
        const h = newHarness();
        arrange(h);

        await runWithFiles(h, files, fileSheetMapping(expression('files', '[$keys($files)]')));

        expect(mapped(h)).to.deep.equal([{ id: 'drawing', name: 'Ground floor', fileVersionId: 'v-sheet', files: ['floorplan.xlsx'] }]);
      });
    }
  });

  it('binds an empty $files in a job launched without files, as is every job of a run but the one that collects them', async () => {
    const h = newHarness();
    h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing', size: 106928 });
    h.pipelineApi.params = { files: [WORKBOOK, DRAWING] };

    await h.impl.run({ dataMappings: [fileSheetMapping(expression('files', '$files'))] });

    expect(mapped(h)).to.deep.equal([{ id: 'drawing', name: 'Ground floor', fileVersionId: 'v-sheet', files: {} }]);
    expect(h.pipelineApi.gets).to.deep.equal([]);
    expect(h.files.calls).to.not.include(`get ${DRAWING.fileId}`);
  });

  it('still binds $pipelineId beside $files', async () => {
    const h = newHarness();
    h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing', size: 106928 });

    await runWithFiles(h, [WORKBOOK, DRAWING], fileSheetMapping(expression('drawingRef', '$pipelineId & "/" & $lookup($files, "floorplan.webp").fileId')));

    expect(mapped(h)).to.deep.equal([
      { id: 'drawing', name: 'Ground floor', fileVersionId: 'v-drawing', drawingRef: `${PIPELINE_ID}/${DRAWING.fileId}` },
    ]);
  });

  it('reads each listed file\'s metadata in a preview, copying nothing and sending no files batch, so the preview maps real values', async () => {
    const h = newHarness({ previewMode: true, previewCount: 5 });
    h.files.views.set(DRAWING.fileId, { fileVersionId: 'v-drawing', size: 106928, mimeType: 'image/webp' });

    await runWithFiles(h, [WORKBOOK, HUB_DRAWING, MISSING], fileSheetMapping(expression('files', '[$keys($files)]')));

    expect(mapped(h)).to.deep.equal([{ id: 'drawing', name: 'Ground floor', fileVersionId: 'v-drawing', files: ['floorplan.xlsx', 'floorplan.webp'] }]);
    expect(h.files.calls).to.deep.equal([
      `get ${WORKBOOK.fileId}`,
      `get ${DRAWING.fileId}`,
      `get ${MISSING.fileId}`,
      `get ${WORKBOOK.fileId}`,
      'container v-book /File',
      'records v-book /File page 1',
    ]);
    expect(h.pipelineApi.gets).to.deep.equal([]);
    expect(h.batchApi.calls.filter((c) => c.op === 'create').map((c) => c.arg.groupId)).to.deep.equal([PIPELINE_ID]);
    expect(h.logger.at('warn').some((m) => m.includes('"gone.txt"') && m.includes('$files leaves it out'))).to.equal(true);
  });
});
