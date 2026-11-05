import { setTimeout as sleep } from 'node:timers/promises';
import {
  ConnectionMetadata, HubConnectionProfile, IllegalArgumentError, Tag, UnexpectedError, UUID,
} from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { extractRows, resolveMappingSql, SavedQueryRegistry } from '@zerobias-org/data-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import {
  FileService, FileServiceClient, FileServiceFile, FileServiceFileStatus, FileServiceRecordsPage, isFileNotFound,
} from './FileServiceClient.js';
import { applyMappings } from './Mappers.js';
import {
  DataMapping, DataMappingParams, DataMappingSource, FileSourceRecord, MappingFileSource, PipelineFile, PipelineFileRecord,
} from './types/index.js';

/** The `moduleTargets` key of the job's DataProducer target, as the generated container reads it. */
const DATAPRODUCER_TARGET = 'module-interface-dataproducer';

/** Rows read per file-service records page for a file-backed mapping. */
const FILE_RECORDS_PAGE_SIZE = 100;

/**
 * The most records pages a file-backed mapping reads: 10,000, 1,000,000
 * records at 100 per page, as many as a collection gets (see
 * `COLLECTION_MAX_PAGES`). A container that holds more fails before its
 * first page is read.
 */
export const FILE_RECORDS_MAX_PAGES = 10_000;

/** How many File records go to the platform in one `addItems` call. */
const FILE_CHUNK_SIZE = 500;

/**
 * The deadline of a run's files step, counted from its start: 10 minutes.
 * file-service calls are cut off at it, and entries not resolved by then count
 * as unresolved, which turns deletes off, so a hanging file-service costs the
 * job minutes rather than its whole timeout.
 */
export const FILES_DEADLINE_MS = 10 * 60_000;

/** How many pipeline files a warning names before it only counts the rest. */
const NAMED_FILES_LIMIT = 20;

/**
 * The most remote pages a mapping's collection is read for: 10,000, about
 * 1,000,000 elements at 100 per page. Past it the fetch fails, so a source
 * that ignores the page number fails in bounded time even when duplicate-page
 * detection can't see the repeat.
 */
export const COLLECTION_MAX_PAGES = 10_000;

/** Copy states in which file-service is still fetching a Hub file's new version. */
const COPY_PENDING_STATES: ReadonlySet<string | null | undefined> = new Set(['created', 'fetching']);

/** Copy states that end the wait for a copy. */
const COPY_SETTLED_STATES: ReadonlySet<string | null | undefined> = new Set(['ready', 'error']);

/** A pipeline file copied into file-service from a Hub target. */
type HubPipelineFile = Extract<PipelineFile, { source: 'hub' }>;

/**
 * What collecting one pipeline file came to: a `record` to send; `gone` when
 * file-service answered 404 for it, or `pending` when it has no ready version,
 * both left out with deletes as they are; or `unresolved` when its state is
 * unknown, which turns deletes off.
 */
type FileOutcome =
  | { kind: 'record'; record: PipelineFileRecord }
  | { kind: 'gone' }
  | { kind: 'pending' }
  | { kind: 'unresolved' };

/**
 * What collecting a run's pipeline files came to: the records to send, the
 * entries that turn deletes off (named for log lines), and the keys (see
 * `entryKey`) of every entry collected and of those file-service answered 404
 * for.
 */
interface CollectedFiles {
  records: PipelineFileRecord[];
  unresolved: string[];
  keys: Set<string>;
  gone: Set<string>;
}

/**
 * The File batch a run sends once its list is read again (see `settleFiles`):
 * the records of files still listed, the keys of the entries listed, and why
 * deletes are off, if they are.
 */
interface SettledFiles {
  records: PipelineFileRecord[];
  listedKeys: Set<string>;
  deletesOffReasons: string[];
}

@injectable()
export class CollectorZerobiasZerobiasDynamicImpl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;

  private _jobId?: UUID;

  private _parameters?: DataMappingParams;

  private _fileService?: FileService;

  /**
   * Why initializing the Hub target failed in this run, when it did (see
   * `initHubTarget`). Every mapping that reads from the target fails its batch
   * with it.
   */
  private hubInitError?: Error;

  /**
   * The bounds on waiting for Hub copies: at most `perFileMs` for one file
   * and `perRunMs` for all of a run's files together, polling every `pollMs`.
   * Tests shorten them.
   */
  copyWait = { perFileMs: 30_000, perRunMs: 120_000, pollMs: 500 };

  /** How long after it starts the files step reaches its deadline (see `FILES_DEADLINE_MS`). Tests shorten it. */
  filesDeadlineMs = FILES_DEADLINE_MS;

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
   * The file-service client that pipeline files are collected through and
   * that file-backed mappings read from. It is built from the job's context
   * on first use, so runs that need neither never create one; tests assign a
   * fake here instead.
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

  /**
   * Connect the DataProducer to the job's Hub target, unless it is already
   * connected, and read the target's metadata, whose tags go on the batches of
   * the mappings that read from it. Under hub-client the DataProducer arrives
   * unconnected (see `src/index.ts`), so this is the first call to reach the
   * target. A failure is logged and thrown with its cause.
   */
  private async init() {
    this.logger.info('Initializing ZeroBias Data Producer collector');
    try {
      if (!(await this.dataproducer.isConnected())) {
        await this.dataproducer.connect(this.dataProducerProfile());
      }
      this.connectionMetadata = await this.dataproducer.metadata();
      this.logger.info('Connection metadata retrieved');
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      this.logger.error(`Failed to get metadata: ${message}`);
      throw new Error(`Unable to initialize collector: ${message}`);
    }
  }

  /**
   * The connection profile of the job's DataProducer target, built as the
   * generated container builds it. A context that names no such target
   * throws, which fails only the mappings that read from it.
   */
  private dataProducerProfile(): HubConnectionProfile {
    const target = this.context.moduleTargets?.[DATAPRODUCER_TARGET];
    if (!target?.targetId) {
      throw new IllegalArgumentError(`Missing ${DATAPRODUCER_TARGET} module connection configuration with a targetId`);
    }
    return HubConnectionProfile.newInstance({
      apiKey: this.context.apiKey,
      server: this.context.server,
      targetId: target.targetId,
      orgId: this.context.orgId,
    });
  }

  /**
   * Initialize the Hub target (see `init`) when some mapping reads from it
   * (see `readsFromHubTarget`). A failure is kept in `hubInitError` rather than
   * thrown: each of those mappings then fails its own batch with it, while
   * the mappings that read uploaded files still run. Without such a mapping
   * the target is never reached, so a pipeline that only reads uploaded files
   * runs while its Hub connection is down.
   */
  private async initHubTarget(dataMappings: DataMapping[]): Promise<void> {
    this.hubInitError = undefined;
    const hubMappings = dataMappings.filter((dataMapping) => readsFromHubTarget(dataMapping.source)).length;
    if (hubMappings === 0) {
      this.logger.info('No data mapping reads from the Hub target, so it is not initialized');
      return;
    }
    try {
      await this.init();
    } catch (error) {
      this.hubInitError = error as Error;
      this.logger.warn(
        `The Hub target could not be initialized, so the ${hubMappings} data mapping(s) that read from it fail; ` +
        `the other ${dataMappings.length - hubMappings} still run`
      );
    }
  }

  /**
   * Create a batch for `className` in `groupId`, tagged with `tags`.
   * `deletesEnabled` is fixed once the batch is created; leaving it undefined
   * keeps the platform default (on).
   */
  private async initBatchForClass(
    className: string,
    groupId: string,
    { deletesEnabled, tags }: { deletesEnabled?: boolean; tags?: Tag[] } = {},
  ): Promise<Batch<any>> {
    const batch = new Batch<any>(
      className,
      this.platform,
      this.logger,
      this.jobId,
      tags,
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
   *  - `file` set → read an uploaded file through file-service
   *    (see `fetchFileSourceItems`); the Hub target is never touched.
   *  - SQL resolved (via `sourceQueryKey` → registry, or legacy `sql`) →
   *    invoke the producer's query function and stream rows from the
   *    (normalised) result set.
   *  - otherwise → page through `getCollectionElements`.
   *
   * The last two read from the Hub target, so when it could not be
   * initialized (see `initHubTarget`) they throw its error instead.
   *
   * Every path produces the same item shape (a plain row object) so the
   * caller treats them identically.
   *
   * `queries` is the pipeline-level saved-query registry threaded down
   * from `this.parameters.queries`. `resolveMappingSql` handles the
   * precedence rule (`sourceQueryKey` beats inline `sql`) so the bot
   * never has to know which storage format a given mapping uses.
   *
   * Collection paging stops at `COLLECTION_MAX_PAGES` rather than the
   * library's default of 1000 pages, about 100,100 elements here: a failed
   * fetch fails the mapping's batch closed, so that cap would fail every run
   * of a larger collection. Duplicate-page detection stays on, so a source
   * that ignores the page number fails at its second repeated page when its
   * items carry an id-like key (`id`, `name`, `uuid` and the like), and at
   * the page cap when they don't.
   */
  private async *fetchSourceItems(
    source: DataMappingSource,
    queries: SavedQueryRegistry,
  ): AsyncIterable<any> {
    if (source.file) {
      yield* this.fetchFileSourceItems(source.file);
      return;
    }

    const { objectId } = source;
    if (!objectId) {
      throw new Error(`Mapping source "${source.objectName}" has neither an objectId nor a file`);
    }
    if (this.hubInitError) {
      throw this.hubInitError;
    }

    const sql = resolveMappingSql(source, queries);
    if (sql) {
      this.logger.info(
        `Invoking query function ${objectId} with ` +
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
        objectId,
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

    this.logger.info(`Fetching collection elements from: ${objectId}`);
    const collectionsApi = this.dataproducer.getCollectionsApi();
    const results = await collectionsApi.getCollectionElements(
      objectId,
      1,         // pageNumber
      100        // pageSize (max is 100)
    );
    results.maxPages = COLLECTION_MAX_PAGES;
    results.detectDuplicatePages = true;
    for await (const item of results) yield item;
  }

  /**
   * Yield the items of a file-backed mapping, all from one version: the
   * file's current ready version, `fileVersionId` in its metadata. That is
   * the records of `containerPath` (see `fetchContainerRecords`) or, with no
   * `containerPath`, the file itself as one `FileSourceRecord`. A file
   * file-service answers 404 for, or one with no ready version yet, throws
   * with a message saying so, which fails the mapping's batch.
   */
  private async *fetchFileSourceItems(file: MappingFileSource): AsyncIterable<any> {
    let view: FileServiceFile;
    try {
      view = await this.fileService.getFile(file.fileId);
    } catch (error) {
      if (isFileNotFound(error)) {
        throw new Error(`Source file ${file.fileId} was not found: file-service answered 404, so it was deleted or this job cannot see it`);
      }
      throw error;
    }
    const versionId = view.fileVersionId;
    if (!versionId) {
      throw new Error(`Source file ${file.fileId} is not ready yet: it has no ready version, as while its upload or copy is still running`);
    }

    if (!file.containerPath) {
      this.logger.info(`Reading source file ${file.fileId} (version ${versionId}) as one record`);
      const record: FileSourceRecord = {
        id: file.fileId,
        fileVersionId: versionId,
        name: view.name ?? null,
        mimeType: view.mimeType ?? null,
        size: view.size ?? null,
        created: view.created ?? null,
        updated: view.updated ?? null,
      };
      yield record;
      return;
    }

    yield* this.fetchContainerRecords(file.fileId, versionId, file.containerPath);
  }

  /**
   * Yield every record of the container at `containerPath` in version
   * `versionId` of source file `fileId`, `FILE_RECORDS_PAGE_SIZE` at a time.
   *
   * The container's own record count, read first, is the total. The records
   * endpoint's `count` header is not trusted to be one: a file-service that
   * ignores `pageNumber` and `pageSize` there (2.0.18 does) returns its first
   * 50 rows for every page and counts only those, so a sheet past 50 rows
   * would otherwise read as complete. Paging stops at the total, so no page
   * past the end is asked for, and fails before the first page when the total
   * would take more than `FILE_RECORDS_MAX_PAGES` pages.
   *
   * Each page must hold the next `FILE_RECORDS_PAGE_SIZE` records, or the
   * rest. One that repeats the page before, or holds more rows than due, is
   * refused before any of its rows is yielded, so no row is sent twice. One
   * that holds fewer, or whose `count` header disagrees with the total, is
   * refused once its rows are taken, so a preview that needs no more rows
   * never asks. Every refusal throws, which fails the mapping's batch closed.
   */
  private async *fetchContainerRecords(
    fileId: string,
    versionId: string,
    containerPath: string,
  ): AsyncIterable<Record<string, unknown>> {
    const where = `${containerPath} of source file ${fileId} (version ${versionId})`;
    let total: number | null | undefined;
    try {
      ({ records: total } = await this.fileService.getContainer(versionId, containerPath));
    } catch (error) {
      if (isFileNotFound(error)) {
        throw new Error(`${where} was not found: file-service answered 404, so the file was deleted or has no such container`);
      }
      throw error;
    }
    if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
      throw new Error(`file-service gave no record count for ${where}`);
    }
    const pages = Math.max(1, Math.ceil(total / FILE_RECORDS_PAGE_SIZE));
    if (pages > FILE_RECORDS_MAX_PAGES) {
      throw new Error(
        `${where} holds ${total} records, more than the ${FILE_RECORDS_MAX_PAGES} pages of ${FILE_RECORDS_PAGE_SIZE} a mapping reads`
      );
    }

    this.logger.info(`Reading the ${total} record(s) of ${where}`);
    let previous: string | undefined;
    let read = 0;
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await this.fileService.listContainerRecords(versionId, containerPath, pageNumber, FILE_RECORDS_PAGE_SIZE);
      const due = Math.min(FILE_RECORDS_PAGE_SIZE, total - read);
      const rows = JSON.stringify(page.items);
      if (page.items.length > 0 && rows === previous) {
        throw new Error(
          `file-service did not advance through the records of ${where}: page ${pageNumber} holds the same rows as page ${pageNumber - 1}`
        );
      }
      if (page.items.length > due) {
        throw new Error(unpagedMessage(where, pageNumber, page, due, total));
      }
      previous = rows;
      for (const row of page.items) yield row;
      read += page.items.length;
      if (page.items.length < due || (page.count >= 0 && page.count !== total)) {
        throw new Error(unpagedMessage(where, pageNumber, page, due, total));
      }
    }
    this.logger.info(`Read the ${read} record(s) of ${where}`);
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
   *
   * Only a batch whose rows come from the Hub target carries the target's
   * tags. A file-backed batch carries none, like the File batch, so its tags
   * don't depend on whether the run also read from the target, or could.
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

    const tags = readsFromHubTarget(source) ? this.connectionMetadata?.tags : undefined;
    const batch = await this.initBatchForClass(destination.className, groupId, { tags });

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
   * The pipeline's current `params.files`, or undefined when its params hold
   * no such list. A failed read throws.
   */
  private async readPipelineFiles(): Promise<unknown[] | undefined> {
    const { params } = await this.platform.getPipelineApi().get(this.context.pipelineId);
    const files = (params as Record<string, unknown> | null | undefined)?.files;
    return Array.isArray(files) ? files : undefined;
  }

  /**
   * The file list this run collects, or undefined when the pipeline no
   * longer has a `files` key. This job collects files because its launch
   * params list them, but those can be minutes old, so the pipeline's current
   * params are read first. When that read fails, the launch-time list is
   * collected instead; deletes are then decided by the read made right before
   * the batch is created (see `settleFiles`), as they always are.
   */
  private async currentPipelineFiles(launchFiles: unknown[]): Promise<unknown[] | undefined> {
    try {
      return await this.readPipelineFiles();
    } catch (error) {
      this.logger.warn(
        `Could not read the pipeline's current files, so the ${launchFiles.length} file(s) it listed at launch ` +
        `are collected: ${(error as Error).message}`
      );
      return launchFiles;
    }
  }

  /**
   * Collect the files attached to the pipeline again as a single `File`
   * batch in group `pipeline-files:<pipelineId>`, a full snapshot, so the
   * objects the platform imported when each file was added stay current and
   * those of removed files are deleted. Only the job whose launch params
   * carry `files` gets here, and it collects the pipeline's current list (see
   * `currentPipelineFiles`). Preview runs skip files entirely.
   *
   * Every entry is resolved (see `collectFiles`) by the step's deadline,
   * `filesDeadlineMs` after it starts, before the batch is created, because
   * `deletesEnabled` is fixed at creation. Right before creating it, the list
   * is read again and the files added meanwhile are collected too (see
   * `settleFiles`), so an add or remove made during the run is not undone.
   * Deletes stay on only when that read succeeded and no entry collected is
   * malformed, unresolved or past the deadline, so a file-service hiccup
   * never deletes the object of a file that is still attached. The copy-wait
   * budget (`copyWait.perRunMs`) covers both collections.
   *
   * No batch is sent when every entry of the final, non-empty list answered
   * 404: a wrong file-service URL or a permission problem looks the same, and
   * the batch would delete every File object. The platform itself drops
   * entries whose files are really gone. No batch is sent either when there is
   * no record and deletes are off, since it would change nothing. An empty
   * list sends an empty batch, which deletes the objects of removed files.
   * Records go to the platform `FILE_CHUNK_SIZE` at a time.
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

    const deadline = Date.now() + this.filesDeadlineMs;
    const files = await this.currentPipelineFiles(launchFiles);
    if (!files) {
      this.logger.info('The pipeline no longer lists files; sending no File batch');
      return;
    }

    this.copyWaitSpentMs = 0;
    const collected = await this.collectFiles(files, deadline);
    const settled = await this.settleFiles(collected, deadline);
    if (!settled) {
      this.logger.info('The pipeline no longer lists files; sending no File batch');
      return;
    }

    const { records, listedKeys } = settled;
    if (listedKeys.size > 0 && [...listedKeys].every((key) => collected.gone.has(key))) {
      this.logger.warn(
        `file-service answered 404 for all ${listedKeys.size} pipeline file(s), as it would for a wrong file-service URL ` +
        'or missing access; sending no File batch, so their objects are kept'
      );
      return;
    }

    const reasons = collected.unresolved.length > 0
      ? [`${collected.unresolved.length} of ${collected.keys.size} pipeline file(s) could not be resolved: ${nameSome(collected.unresolved)}`]
      : [];
    reasons.push(...settled.deletesOffReasons);
    const deletesEnabled = reasons.length === 0;
    if (records.length === 0 && !deletesEnabled) {
      this.logger.warn(`No pipeline file produced a record and deletes are off, so sending no File batch: ${reasons.join('; ')}`);
      return;
    }

    this.logger.info(
      `Sending ${records.length} pipeline file(s) as a File batch (deletes ${deletesEnabled ? 'on' : 'off'})`
    );
    const batch = await this.initBatchForClass('File', `pipeline-files:${pipelineId}`, { deletesEnabled });
    try {
      if (!deletesEnabled) {
        await batch.warn(`Deletes are off for this run: ${reasons.join('; ')}`);
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
   * Resolve `files` one at a time (see `collectFile`) into `collected`,
   * passing `deadline` down to every file-service call. The deadline is
   * checked before each entry: a malformed entry, an unresolved one and every
   * entry not reached in time go in `unresolved`, and an entry file-service
   * answered 404 for goes in `gone`.
   */
  private async collectFiles(
    files: unknown[],
    deadline: number,
    collected: CollectedFiles = { records: [], unresolved: [], keys: new Set(), gone: new Set() },
  ): Promise<CollectedFiles> {
    for (const entry of files) {
      collected.keys.add(entryKey(entry));
    }
    for (const [index, entry] of files.entries()) {
      if (Date.now() >= deadline) {
        const rest = files.slice(index).map(describeListed);
        this.logger.warn(
          `Collecting pipeline files reached its ${this.filesDeadlineMs} ms deadline; ` +
          `the ${rest.length} file(s) not collected yet are unresolved: ${nameSome(rest)}`
        );
        collected.unresolved.push(...rest);
        break;
      }
      if (!isPipelineFile(entry)) {
        this.logger.warn(`Pipeline file entry ${describeEntry(entry)} is malformed; skipping it`);
        collected.unresolved.push(describeEntry(entry));
        continue;
      }
      const outcome = await this.collectFile(entry, deadline);
      if (outcome.kind === 'record') {
        collected.records.push(outcome.record);
      } else if (outcome.kind === 'gone') {
        collected.gone.add(entryKey(entry));
      } else if (outcome.kind === 'unresolved') {
        collected.unresolved.push(describeFile(entry));
      }
    }
    return collected;
  }

  /**
   * Read the pipeline's list again right before the File batch is created and
   * fit what this run collected to it, so a file added or removed meanwhile is
   * not undone. The records of files no longer listed are dropped. Entries
   * the list now holds that this run did not collect are collected into
   * `collected` too, by the same `deadline`: the run's batch is newer than the
   * platform's own snapshot of the add, which it supersedes, so it must carry
   * their records. One of them that is malformed, unresolved or past the
   * deadline turns deletes off, as in the first collection; one that answers
   * 404 is gone. A failed read keeps every record and turns deletes off.
   * Returns undefined when the pipeline no longer has a `files` key.
   */
  private async settleFiles(collected: CollectedFiles, deadline: number): Promise<SettledFiles | undefined> {
    let listed: unknown[] | undefined;
    try {
      listed = await this.readPipelineFiles();
    } catch (error) {
      this.logger.warn(`Could not read the pipeline's files again before sending them, so deletes are off: ${(error as Error).message}`);
      return {
        records: collected.records,
        listedKeys: collected.keys,
        deletesOffReasons: ["the pipeline's current file list could not be read before the batch was created"],
      };
    }
    if (!listed) {
      return undefined;
    }

    const added = listed.filter((entry) => !collected.keys.has(entryKey(entry)));
    if (added.length > 0) {
      this.logger.info(
        `${added.length} pipeline file(s) were added while this run collected files; collecting them too: ` +
        nameSome(added.map(describeListed))
      );
      await this.collectFiles(added, deadline, collected);
    }

    const listedIds = new Set(listed.filter(isPipelineFile).map((entry) => entry.fileId));
    const removed = collected.records.filter((record) => !listedIds.has(record.id));
    if (removed.length > 0) {
      this.logger.info(
        `${removed.length} pipeline file(s) were removed while this run collected files; leaving them out: ` +
        nameSome(removed.map((record) => `"${record.name}" (${record.id})`))
      );
    }
    return {
      records: collected.records.filter((record) => listedIds.has(record.id)),
      listedKeys: new Set(listed.map(entryKey)),
      deletesOffReasons: [],
    };
  }

  /**
   * Collect one pipeline file by the rule the platform's add/remove endpoint
   * follows, so both build the same record. The file's view is read first:
   * a 404 means the file is gone, and any other failure leaves it unresolved.
   * A gone Hub file is never copied, since copying it again would make
   * file-service create an orphan. A Hub file that exists is copied from its
   * target again (see `copyHubFile`) and its view read again; when the copy
   * call fails, the view already read is used. A failure of the second read
   * counts the same way as one of the first. Every call is bounded by
   * `deadline`.
   */
  private async collectFile(entry: PipelineFile, deadline: number): Promise<FileOutcome> {
    try {
      let view = await this.fileService.getFile(entry.fileId, { deadline });
      if (entry.source === 'hub' && await this.copyHubFile(entry, deadline)) {
        view = await this.fileService.getFile(entry.fileId, { deadline });
      }
      return this.fileOutcome(entry, view);
    } catch (error) {
      if (isFileNotFound(error)) {
        this.logger.warn(`file-service answered 404 for pipeline file ${describeFile(entry)}; leaving it out as gone`);
        return { kind: 'gone' };
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
   * That includes file-service answering 409 because Hub refused the copy, or
   * 404 because the object is no longer on the target, neither of which is
   * retried.
   */
  private async copyHubFile(entry: HubPipelineFile, deadline: number): Promise<boolean> {
    let status: FileServiceFileStatus | undefined;
    try {
      ({ status } = await this.fileService.copyFile({
        sourceTarget: entry.targetId,
        sourcePath: entry.objectId,
        destinationPath: entry.destinationPath,
      }, { deadline }));
    } catch (error) {
      this.logger.warn(
        `Could not copy pipeline file ${describeFile(entry)} again from target ${entry.targetId}; ` +
        `using the version file-service already has: ${(error as Error).message}`
      );
      return false;
    }
    if (await this.awaitCopy(entry, deadline, status) === 'error') {
      this.logger.warn(`file-service could not copy pipeline file ${describeFile(entry)} again; using the version it already has`);
    }
    return true;
  }

  /**
   * Wait while a Hub file's copy reports `created` or `fetching`, polling
   * the new version's status until it reads `ready` or `error`, for at most
   * `copyWait.perFileMs`, only within what is left of `copyWait.perRunMs`, and
   * never past `deadline`. Returns the last state seen, or undefined when
   * polling failed. Running out of time or failing to poll only warns: the
   * view read next still shows the file's last ready version.
   */
  private async awaitCopy(entry: HubPipelineFile, deadline: number, status?: FileServiceFileStatus): Promise<string | null | undefined> {
    let state = status?.status;
    const versionId = status?.fileVersionId;
    if (!COPY_PENDING_STATES.has(state) || !versionId) {
      return state;
    }
    const runLeftMs = this.copyWait.perRunMs - this.copyWaitSpentMs;
    const waitMs = Math.min(this.copyWait.perFileMs, runLeftMs, deadline - Date.now());
    if (waitMs <= 0) {
      this.logger.warn(
        `Not waiting for the copy of pipeline file ${describeFile(entry)}: ` +
        (runLeftMs <= 0 ? `this run has spent its ${this.copyWait.perRunMs} ms on copies` : 'the files deadline has passed')
      );
      return state;
    }
    const started = Date.now();
    try {
      while (!COPY_SETTLED_STATES.has(state) && Date.now() - started < waitMs) {
        await sleep(Math.min(this.copyWait.pollMs, waitMs - (Date.now() - started)));
        state = (await this.fileService.getFileStatus(versionId, { deadline })).status;
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
   * ready version is pending and left out, since no object can exist for it;
   * one with a ready version but no size is unresolved, since its object may
   * exist. Anything else becomes a record (see `pipelineFileRecord`).
   */
  private fileOutcome(entry: PipelineFile, view: FileServiceFile): FileOutcome {
    if (!view.fileVersionId) {
      this.logger.warn(`Pipeline file ${describeFile(entry)} has no ready version yet; leaving it out`);
      return { kind: 'pending' };
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
   * them; a failure there is logged and the data mappings still run.
   *
   * The Hub target is initialized only when a mapping reads from it (see
   * `initHubTarget`), so a pipeline whose mappings only read uploaded files
   * makes no DataProducer call. When it can't be initialized, only the
   * mappings that read from it fail. A mapping that fails is reported the
   * same way whatever the cause: its batch is failed closed (see `failBatch`),
   * the error is logged, and the run goes on and completes, leaving the
   * platform to judge the job from its batches' error logs.
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

    await this.initHubTarget(dataMappings);

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
 * Whether a mapping source reads from the Hub target: one with an `objectId`
 * (a collection, or a query function) and no `file`.
 */
function readsFromHubTarget(source: DataMappingSource): boolean {
  return !source.file && Boolean(source.objectId);
}

/**
 * Explain a records page of `where` that is not the page asked for: it holds
 * a different number of rows than the `due` that the container's `total`
 * leaves for it, or counts a different total.
 */
function unpagedMessage(where: string, pageNumber: number, page: FileServiceRecordsPage, due: number, total: number): string {
  const counted = page.count >= 0 ? ` and a count of ${page.count}` : '';
  return `file-service did not page the records of ${where}: page ${pageNumber} returned ${page.items.length} row(s)${counted}, ` +
    `but the container holds ${total} record(s), so ${due} were due on that page; ` +
    'a file-service that ignores pageNumber and pageSize returns its first rows for every page';
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
 * The `File` record of a pipeline file, built as the platform builds it, key
 * for key: `name` comes from the entry and `mimeType` is added only when
 * file-service has one. A different key or value would write a new object
 * version on every run. The keys also go in the platform's order, which only
 * keeps the two easy to compare: the platform sorts keys before it hashes a
 * version, so order never changes versioning.
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
 * The key a `params.files` entry is matched by between the run's two reads of
 * the list: the `fileId` of a well-formed entry, the JSON of a malformed one.
 */
function entryKey(entry: unknown): string {
  return isPipelineFile(entry) ? `file:${entry.fileId}` : `entry:${JSON.stringify(entry) ?? String(entry)}`;
}

/**
 * Name `names` in a warning: the first `NAMED_FILES_LIMIT` of them, then a
 * count of the rest.
 */
function nameSome(names: string[]): string {
  const rest = names.length - NAMED_FILES_LIMIT;
  return `${names.slice(0, NAMED_FILES_LIMIT).join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
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
 * Name any `params.files` entry in log lines: a well-formed one as
 * `describeFile` does, a malformed one as `describeEntry` does.
 */
function describeListed(entry: unknown): string {
  return isPipelineFile(entry) ? describeFile(entry) : describeEntry(entry);
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
