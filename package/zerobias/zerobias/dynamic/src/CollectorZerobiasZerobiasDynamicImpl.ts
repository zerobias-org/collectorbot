import { setTimeout as sleep } from 'node:timers/promises';
import { ConnectionMetadata, UnexpectedError, UUID } from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { extractRows, resolveMappingSql, SavedQueryRegistry } from '@zerobias-org/data-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { FileService, FileServiceClient, FileServiceFile, FileServiceFileStatus, isFileNotFound } from './FileServiceClient.js';
import { applyMappings } from './Mappers.js';
import { DataMapping, DataMappingParams, DataMappingSource, PipelineFile, PipelineFileRecord } from './types/index.js';

/** How many File records go to the platform in one `addItems` call. */
const FILE_CHUNK_SIZE = 500;

/** How many unresolved pipeline files a deletes-off warning names before it only counts the rest. */
const NAMED_UNRESOLVED_LIMIT = 20;

/** Copy states in which file-service is still fetching a Hub file's new version. */
const COPY_PENDING_STATES: ReadonlySet<string | null | undefined> = new Set(['created', 'fetching']);

/** Copy states that end the wait for a copy. */
const COPY_SETTLED_STATES: ReadonlySet<string | null | undefined> = new Set(['ready', 'error']);

/** A pipeline file copied into file-service from a Hub target. */
type HubPipelineFile = Extract<PipelineFile, { source: 'hub' }>;

/**
 * What collecting one pipeline file came to: a `record` to send; `omitted`
 * when the file is gone or has no ready version, which leaves deletes as they
 * are; or `unresolved` when its state is unknown, which turns deletes off.
 */
type FileOutcome =
  | { kind: 'record'; record: PipelineFileRecord }
  | { kind: 'omitted' }
  | { kind: 'unresolved' };

@injectable()
export class CollectorZerobiasZerobiasDynamicImpl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;

  private _jobId?: UUID;

  private _parameters?: DataMappingParams;

  private _fileService?: FileService;

  /**
   * The bounds on waiting for Hub copies: at most `perFileMs` for one file
   * and `perRunMs` for all of a run's files together, polling every `pollMs`.
   * Tests shorten them.
   */
  copyWait = { perFileMs: 30_000, perRunMs: 120_000, pollMs: 500 };

  /** How long this run has waited for Hub copies so far. */
  private copyWaitSpentMs = 0;

  // Preview mode support
  private previewCount?: number = this.context.previewMode
    ? (this.context.previewCount || 10)
    : undefined;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  get parameters(): DataMappingParams {
    if (!this._parameters) {
      throw new UnexpectedError('No Parameters were provided');
    }
    return this._parameters;
  }

  set parameters(parameters: DataMappingParams) {
    this._parameters = parameters;
  }

  /**
   * The file-service client pipeline files are collected through. It is
   * built from the job's context on first use, so runs without `files` never
   * create one; tests assign a fake here instead.
   */
  get fileService(): FileService {
    if (!this._fileService) {
      this._fileService = FileServiceClient.fromContext(this.context);
    }
    return this._fileService;
  }

  set fileService(fileService: FileService) {
    this._fileService = fileService;
  }

  private async init() {
    this.logger.info('Initializing ZeroBias Data Producer collector');
    try {
      this.connectionMetadata = await this.dataproducer.metadata();
      this.logger.info('Connection metadata retrieved');
    } catch (error) {
      this.logger.error(`Failed to get metadata: ${(error as Error).message}`);
      throw new Error('Unable to initialize collector');
    }
  }

  /**
   * Create a batch for `className` in `groupId`. `deletesEnabled` is fixed
   * once the batch is created; leaving it undefined keeps the platform
   * default (on).
   */
  private async initBatchForClass(
    className: string,
    groupId: string,
    deletesEnabled?: boolean,
  ): Promise<Batch<any>> {
    const batch = new Batch<any>(
      className,
      this.platform,
      this.logger,
      this.jobId,
      this.connectionMetadata?.tags,
      groupId,
      deletesEnabled,
    );
    await batch.getId();
    return batch;
  }

  /**
   * Fail `batch` closed after `cause`: log `message` on it as an error, which
   * makes the platform fail the batch, and end it only once that log is in.
   * hub-client never retries the batch-log POST but does retry `endBatch`, so
   * ending a batch whose error log was lost would have the platform import
   * its partial item list as complete, deletes included. When the log fails,
   * the batch is left open, which fails the job, and `cause` is rethrown.
   */
  private async failBatch(batch: Batch<any>, message: string, cause: Error): Promise<void> {
    try {
      await batch.error(message);
    } catch (logError) {
      this.logger.error(
        `Could not log the failure on the ${batch.getClassName()} batch, so it is left open: ${(logError as Error).message}`
      );
      throw cause;
    }
    await batch.end();
  }

  /**
   * Yield source items for a mapping. Branches on the source variant:
   *  - SQL resolved (via `sourceQueryKey` → registry, or legacy `sql`) →
   *    invoke the producer's query function and stream rows from the
   *    (normalised) result set.
   *  - otherwise → page through `getCollectionElements`.
   *
   * Both paths produce the same item shape (a plain row object) so the
   * caller treats them identically.
   *
   * `queries` is the pipeline-level saved-query registry threaded down
   * from `this.parameters.queries`. `resolveMappingSql` handles the
   * precedence rule (`sourceQueryKey` beats inline `sql`) so the bot
   * never has to know which storage format a given mapping uses.
   */
  private async *fetchSourceItems(
    source: DataMappingSource,
    queries: SavedQueryRegistry,
  ): AsyncIterable<any> {
    const sql = resolveMappingSql(source, queries);
    if (sql) {
      this.logger.info(
        `Invoking query function ${source.objectId} with ` +
        (source.sourceQueryKey
          ? `saved query key=${source.sourceQueryKey}: ${sql}`
          : `persisted SQL: ${sql}`)
      );
      const functionsApi = this.dataproducer.getFunctionsApi();
      // The generated FunctionsApi types `requestBody` as
      // `{ [key: string]: object }`; the SQL string doesn't satisfy that
      // shape but the wire payload is just JSON, so cast to bypass the
      // codegen narrowing.
      const raw = await functionsApi.invokeFunction(
        source.objectId,
        { sql } as any,
      );

      // The generated FunctionsApi runs the response through
      // `ObjectSerializer.deserialize(data, '{ [key: string]: object; }')`,
      // whose record-typed branch rebuilds an array `[a,b,c]` as a numeric-
      // keyed object `{0:a, 1:b, 2:c}`. extractRows can't see those rows, so
      // unwrap the SDK's quirk back into an array before delegating.
      const unwrapped = unwrapNumericKeyedObject(raw);
      const rows = extractRows(unwrapped);
      this.logger.info(`Query returned ${rows.length} row(s)`);
      for (const row of rows) yield row;
      return;
    }

    this.logger.info(`Fetching collection elements from: ${source.objectId}`);
    const collectionsApi = this.dataproducer.getCollectionsApi();
    const results = await collectionsApi.getCollectionElements(
      source.objectId,
      1,         // pageNumber
      100        // pageSize (max is 100)
    );
    for await (const item of results) yield item;
  }

  /**
   * Process a single data mapping configuration
   * - Fetches data from the source (collection or query)
   * - Applies field mappings using DataMapper
   * - Adds transformed data to batch
   *
   * `queries` is the pipeline-level saved-query registry threaded down
   * from `run()` so query-backed mappings can resolve `sourceQueryKey`
   * → SQL string. `undefined` is a valid value (no saved queries on the
   * pipeline; only legacy inline-SQL or collection-backed mappings).
   *
   * A source fetch that fails part-way fails the batch closed (see
   * `failBatch`), so the platform never treats the partial item list as
   * complete and deletes every object it left out. The fetch error is
   * rethrown either way.
   */
  private async processDataMapping(
    dataMapping: DataMapping,
    groupId: string,
    queries: SavedQueryRegistry,
  ): Promise<void> {
    const { source, destination, mappings, metadata } = dataMapping;

    this.logger.info(
      `Processing data mapping: ${metadata.name || 'unnamed'} ` +
      `(${source.objectName} -> ${destination.className})`
    );

    // Initialize batch for the destination class
    const batch = await this.initBatchForClass(destination.className, groupId);

    try {
      // Process each item through the mappings
      let processedCount = 0;
      let errorCount = 0;

      for await (const item of this.fetchSourceItems(source, queries)) {
        // Check preview limit
        if (this.previewCount && processedCount >= this.previewCount) {
          break;
        }

        let mappedItem: any;
        try {
          // Apply mappings to transform the item
          const { result, errors } = await applyMappings(item, mappings);
          mappedItem = result;

          if (errors.length > 0) {
            this.logger.warn(
              `Mapping warnings for item: ${errors.join(', ')}`
            );
          }

          // Add the mapped item to the batch
          await batch.add(mappedItem, item);
          processedCount += 1;

        } catch (err) {
          errorCount += 1;
          await batch.error(
            `Failed to process item: ${(err as Error).message}`,
            mappedItem
          );
        }
      }

      this.logger.info(
        `Completed mapping ${metadata.name || 'unnamed'}: ` +
        `${processedCount} items processed, ${errorCount} errors`
      );

    } catch (error) {
      await this.failBatch(batch, `Failed to fetch source items: ${(error as Error).message}`, error as Error);
      throw error;
    }
    await batch.end();
  }

  /**
   * The file list this run collects, or undefined when the pipeline no
   * longer has a `files` key. This job collects files because its launch
   * params list them, but those can be minutes old, so the pipeline's current
   * params are read right before the files are resolved. When that read
   * fails, the launch-time list is used with `live` false, which keeps
   * deletes off.
   */
  private async currentPipelineFiles(launchFiles: unknown[]): Promise<{ files: unknown[]; live: boolean } | undefined> {
    let params: Record<string, any> | null | undefined;
    try {
      ({ params } = await this.platform.getPipelineApi().get(this.context.pipelineId));
    } catch (error) {
      this.logger.warn(
        `Could not read the pipeline's current files, so the ${launchFiles.length} file(s) it listed at launch ` +
        `are collected with deletes off: ${(error as Error).message}`
      );
      return { files: launchFiles, live: false };
    }
    const files = params?.files;
    return Array.isArray(files) ? { files, live: true } : undefined;
  }

  /**
   * Collect the files attached to the pipeline again as a single `File`
   * batch in group `pipeline-files:<pipelineId>`, a full snapshot, so the
   * objects the platform imported when each file was added stay current and
   * those of removed files are deleted. Only the job whose launch params
   * carry `files` gets here, and it collects the pipeline's current list (see
   * `currentPipelineFiles`). Preview runs skip files entirely.
   *
   * Every entry is resolved (see `collectFile`) before the batch is created,
   * because `deletesEnabled` is fixed at creation: deletes stay on only when
   * the current list was read and no entry is malformed or unresolved, so a
   * file-service hiccup never deletes the object of a file that is still
   * attached. An empty list still sends an empty batch, which deletes the
   * objects of removed files; a non-empty list where nothing produced a
   * record and something is unresolved sends no batch. Records go to the
   * platform `FILE_CHUNK_SIZE` at a time.
   *
   * Problems are logged at warn, never error: an error log on the batch makes
   * the platform fail it. The exception is a failed `addItems`, where failing
   * the batch is the point (see `failBatch`).
   */
  private async processFiles(launchFiles: unknown[], pipelineId: string): Promise<void> {
    if (this.context.previewMode) {
      this.logger.info(`Preview run: skipping ${launchFiles.length} pipeline file(s)`);
      return;
    }

    const current = await this.currentPipelineFiles(launchFiles);
    if (!current) {
      this.logger.info('The pipeline no longer lists files; sending no File batch');
      return;
    }

    const { files, live } = current;
    const records: PipelineFileRecord[] = [];
    const unresolved: string[] = [];
    this.copyWaitSpentMs = 0;
    for (const entry of files) {
      if (!isPipelineFile(entry)) {
        this.logger.warn(`Pipeline file entry ${describeEntry(entry)} is malformed; skipping it`);
        unresolved.push(describeEntry(entry));
        continue;
      }
      const outcome = await this.collectFile(entry);
      if (outcome.kind === 'record') {
        records.push(outcome.record);
      } else if (outcome.kind === 'unresolved') {
        unresolved.push(describeFile(entry));
      }
    }

    if (files.length > 0 && records.length === 0 && unresolved.length > 0) {
      this.logger.warn(
        `None of the ${files.length} pipeline file(s) produced a record and ${unresolved.length} could not be resolved; ` +
        'sending no File batch'
      );
      return;
    }

    const deletesEnabled = live && unresolved.length === 0;
    this.logger.info(
      `Sending ${records.length} pipeline file(s) as a File batch (deletes ${deletesEnabled ? 'on' : 'off'})`
    );
    const batch = await this.initBatchForClass('File', `pipeline-files:${pipelineId}`, deletesEnabled);
    try {
      if (!deletesEnabled) {
        await batch.warn(`Deletes are off for this run: ${deletesOffReasons(live, unresolved, files.length)}`);
      }
      for (let start = 0; start < records.length; start += FILE_CHUNK_SIZE) {
        await batch.addItems(records.slice(start, start + FILE_CHUNK_SIZE).map((payload) => ({ payload })));
      }
    } catch (error) {
      await this.failBatch(batch, `Failed to add pipeline files to the batch: ${(error as Error).message}`, error as Error);
      return;
    }
    await batch.end();
  }

  /**
   * Collect one pipeline file by the rule the platform's add/remove endpoint
   * follows, so both build the same record. The file's view is read first:
   * a 404 means the file is gone, and any other failure leaves it unresolved.
   * A gone Hub file is never copied, since copying it again would make
   * file-service create an orphan. A Hub file that exists is copied from its
   * target again (see `copyHubFile`) and its view read again; when the copy
   * call fails, the view already read is used. A failure of the second read
   * counts the same way as one of the first.
   */
  private async collectFile(entry: PipelineFile): Promise<FileOutcome> {
    try {
      let view = await this.fileService.getFile(entry.fileId);
      if (entry.source === 'hub' && await this.copyHubFile(entry)) {
        view = await this.fileService.getFile(entry.fileId);
      }
      return this.fileOutcome(entry, view);
    } catch (error) {
      if (isFileNotFound(error)) {
        this.logger.warn(`Pipeline file ${describeFile(entry)} no longer exists in file-service; leaving it out`);
        return { kind: 'omitted' };
      }
      this.logger.warn(`Pipeline file ${describeFile(entry)} is unresolved: could not read it: ${(error as Error).message}`);
      return { kind: 'unresolved' };
    }
  }

  /**
   * Copy a Hub pipeline file from its target again, so its latest remote
   * contents become a new version, and wait for file-service to fetch them
   * (see `awaitCopy`). Never throws: it returns false when the copy call
   * itself failed, after a warning, so the caller keeps the view it read.
   */
  private async copyHubFile(entry: HubPipelineFile): Promise<boolean> {
    let status: FileServiceFileStatus | undefined;
    try {
      ({ status } = await this.fileService.copyFile({
        sourceTarget: entry.targetId,
        sourcePath: entry.objectId,
        destinationPath: entry.destinationPath,
      }));
    } catch (error) {
      this.logger.warn(
        `Could not copy pipeline file ${describeFile(entry)} again from target ${entry.targetId}; ` +
        `using the version file-service already has: ${(error as Error).message}`
      );
      return false;
    }
    if (await this.awaitCopy(entry, status) === 'error') {
      this.logger.warn(`file-service could not copy pipeline file ${describeFile(entry)} again; using the version it already has`);
    }
    return true;
  }

  /**
   * Wait while a Hub file's copy reports `created` or `fetching`, polling
   * the new version's status until it reads `ready` or `error`, for at most
   * `copyWait.perFileMs` and only within what is left of `copyWait.perRunMs`.
   * Returns the last state seen, or undefined when polling failed. Running
   * out of time or failing to poll only warns: the view read next still
   * shows the file's last ready version.
   */
  private async awaitCopy(entry: HubPipelineFile, status?: FileServiceFileStatus): Promise<string | null | undefined> {
    let state = status?.status;
    const versionId = status?.fileVersionId;
    if (!COPY_PENDING_STATES.has(state) || !versionId) {
      return state;
    }
    const waitMs = Math.min(this.copyWait.perFileMs, this.copyWait.perRunMs - this.copyWaitSpentMs);
    if (waitMs <= 0) {
      this.logger.warn(
        `Not waiting for the copy of pipeline file ${describeFile(entry)}: this run has spent its ${this.copyWait.perRunMs} ms on copies`
      );
      return state;
    }
    const started = Date.now();
    try {
      while (!COPY_SETTLED_STATES.has(state) && Date.now() - started < waitMs) {
        await sleep(Math.min(this.copyWait.pollMs, waitMs - (Date.now() - started)));
        state = (await this.fileService.getFileStatus(versionId)).status;
      }
    } catch (error) {
      this.logger.warn(`Could not follow the copy of pipeline file ${describeFile(entry)}: ${(error as Error).message}`);
      return undefined;
    } finally {
      this.copyWaitSpentMs += Date.now() - started;
    }
    if (!COPY_SETTLED_STATES.has(state)) {
      this.logger.warn(`Stopped waiting for the copy of pipeline file ${describeFile(entry)} after ${waitMs} ms; it is still ${state}`);
    }
    return state;
  }

  /**
   * The outcome for a pipeline file whose view was read. A file with no
   * ready version is omitted, since no object can exist for it; one with a
   * ready version but no size is unresolved, since its object may exist.
   * Anything else becomes a record (see `pipelineFileRecord`).
   */
  private fileOutcome(entry: PipelineFile, view: FileServiceFile): FileOutcome {
    if (!view.fileVersionId) {
      this.logger.warn(`Pipeline file ${describeFile(entry)} has no ready version yet; leaving it out`);
      return { kind: 'omitted' };
    }
    if (view.size === null || view.size === undefined) {
      this.logger.warn(`Pipeline file ${describeFile(entry)} is unresolved: version ${view.fileVersionId} has no size`);
      return { kind: 'unresolved' };
    }
    return { kind: 'record', record: pipelineFileRecord(entry, view.fileVersionId, view.size, view.mimeType) };
  }

  /**
   * Collect the pipeline's files when this job's launch params carry `files`
   * (see `processFiles`), then run its data mappings. Files go first, ahead of
   * the no-mappings return, so a pipeline that only has files still collects
   * them; a failure there is logged and the data mappings still run. `init()`
   * runs only when there are data mappings, so a files-only pipeline makes no
   * DataProducer call.
   */
  public async run(parameters?: DataMappingParams): Promise<void> {
    if (parameters) {
      this.parameters = parameters;
    }
    const { dataMappings, queries, files } = this.parameters;

    // Use pipeline ID for groupId as per requirements
    const pipelineId = this.context.pipelineId || 'default';

    if (Array.isArray(files)) {
      try {
        await this.processFiles(files, `${pipelineId}`);
      } catch (error) {
        this.logger.error(`Failed to collect pipeline files: ${(error as Error).message}`);
      }
    }

    if (!dataMappings || dataMappings.length === 0) {
      this.logger.warn('No data mappings configured');
      return;
    }

    await this.init();

    this.logger.info(
      `Processing ${dataMappings.length} data mapping(s)` +
      (queries ? ` with ${Object.keys(queries).length} saved query(ies)` : '')
    );

    const groupId = `${pipelineId}`;

    // Process each data mapping
    for (const dataMapping of dataMappings) {
      try {
        await this.processDataMapping(dataMapping, groupId, queries);
      } catch (error) {
        this.logger.error(
          `Failed to process data mapping ${dataMapping.id}: ${(error as Error).message}`
        );
        // Continue with other mappings even if one fails
      }
    }

    this.logger.info('All data mappings completed');
  }
}

/**
 * Whether a `params.files` entry has the shape the collector needs: an
 * object with a string `fileId` and `name`, and a `source` of `upload`, or of
 * `hub` with a string `targetId`, `objectId` and `destinationPath` as well.
 */
function isPipelineFile(entry: unknown): entry is PipelineFile {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const { fileId, name, source, targetId, objectId, destinationPath } = entry as Record<string, unknown>;
  if (typeof fileId !== 'string' || typeof name !== 'string') {
    return false;
  }
  return source === 'upload'
    || (source === 'hub' && typeof targetId === 'string' && typeof objectId === 'string' && typeof destinationPath === 'string');
}

/**
 * The `File` record of a pipeline file, built exactly as the platform builds
 * it: batch items are hashed over their JSON, so the keys go in this order,
 * `name` comes from the entry and `mimeType` is added only when file-service
 * has one. Any difference would write a new object version on every run.
 */
function pipelineFileRecord(
  entry: PipelineFile,
  fileVersionId: string,
  size: number,
  mimeType?: string | null,
): PipelineFileRecord {
  const record: PipelineFileRecord = {
    id: entry.fileId,
    name: entry.name,
    fileVersionId,
    size,
  };
  if (mimeType) {
    record.mimeType = mimeType;
  }
  return record;
}

/**
 * Say why a File batch has deletes off: the pipeline's current file list
 * could not be read, some entries are malformed or unresolved, or both.
 * Only the first `NAMED_UNRESOLVED_LIMIT` unresolved entries are named.
 */
function deletesOffReasons(live: boolean, unresolved: string[], total: number): string {
  const reasons: string[] = [];
  if (!live) {
    reasons.push("the pipeline's current file list could not be read, so the list it had at launch was used");
  }
  if (unresolved.length > 0) {
    const named = unresolved.slice(0, NAMED_UNRESOLVED_LIMIT).join(', ');
    const rest = unresolved.length - NAMED_UNRESOLVED_LIMIT;
    reasons.push(
      `${unresolved.length} of ${total} pipeline file(s) could not be resolved: ${named}${rest > 0 ? `, and ${rest} more` : ''}`
    );
  }
  return reasons.join('; ');
}

/**
 * Name a pipeline file in log lines by its entry name and file ID.
 */
function describeFile(entry: PipelineFile): string {
  return `"${entry.name}" (${entry.fileId})`;
}

/**
 * Show a malformed `params.files` entry in log lines as JSON, cut to 200
 * characters.
 */
function describeEntry(entry: unknown): string {
  const text = JSON.stringify(entry) ?? String(entry);
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

/**
 * Reverse the SDK deserializer's array-as-record fallback. When the
 * generated FunctionsApi typing forces a record shape on the response, an
 * incoming array `[a,b,c]` comes back as `{0:a, 1:b, 2:c}`. Detect that
 * specific shape (every key is a stringified non-negative integer, keys are
 * dense and start at 0) and rebuild the array; pass everything else through
 * untouched so envelope responses (`{rows: [...]}` etc.) reach extractRows
 * unchanged.
 */
function unwrapNumericKeyedObject(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 0) return value;
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] !== String(i)) return value;
  }
  return keys.map((k) => value[k]);
}
