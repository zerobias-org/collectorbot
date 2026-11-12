import { setTimeout as sleep } from 'node:timers/promises';
import {
  ConnectionMetadata, HubConnectionProfile, IllegalArgumentError, Tag, UnexpectedError, UUID,
} from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { extractRows, resolveMappingSql, SavedQueryRegistry } from '@zerobias-org/data-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import {
  FileService, FileServiceClient, FileServiceError, FileServiceFile, FileServiceFileStatus, FileServiceRecordsPage, isFileNotFound,
} from './FileServiceClient.js';
import { applyMappings } from './Mappers.js';
import {
  DataMapping, DataMappingParams, DataMappingSource, EvidenceFileRecord, FileSourceRecord, MappingFile, MappingFileSource, MappingFiles,
  PipelineFile, PipelineFileRecord,
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

/** How many records of a pipeline files batch go to the platform in one `addItems` call. */
const FILE_CHUNK_SIZE = 500;

/** The class of the batch of pipeline files that list no evidence definitions. */
const FILE_CLASS = 'File';

/**
 * The class of the batch of pipeline files that list evidence definitions, a
 * concrete class that extends `File`.
 */
const EVIDENCE_FILE_CLASS = 'EvidenceFile';

/**
 * The deadline of a run's files step, counted from its start: 10 minutes.
 * file-service calls are cut off at it, and entries not resolved by then count
 * as unresolved, which turns deletes off, so a hanging file-service costs the
 * job minutes rather than its whole timeout.
 */
export const FILES_DEADLINE_MS = 10 * 60_000;

/** How many pipeline files a warning names before it only counts the rest. */
const NAMED_FILES_LIMIT = 20;

/** The `$files` of a run that resolved no pipeline file (see `MappingFiles`). */
const NO_MAPPING_FILES: MappingFiles = Object.freeze({});

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
 * What collecting one pipeline file came to:
 * - `record`: the record to send.
 * - `gone`: file-service answered 404 for it.
 * - `failed`: its Hub source answered 404 or refused the copy, with the record
 *   of the version file-service still has, when there is one.
 * - `pending`: it has no ready version, so it is left out with deletes as they are.
 * - `unresolved`: its state is unknown, which turns deletes off.
 *
 * A gone or failed file fails the batch its records belong to and the
 * mappings that read it (see `processFiles`).
 */
type FileOutcome =
  | { kind: 'record'; record: PipelineFileRecord }
  | { kind: 'gone' }
  | { kind: 'failed'; reason: string; record?: PipelineFileRecord }
  | { kind: 'pending' }
  | { kind: 'unresolved' };

/** A pipeline file this run can't refresh: its entry name and why, as its batch's error and its mappings' name them. */
interface FileFailure {
  name: string;
  reason: string;
}

/**
 * What collecting a run's pipeline files came to: the `File` records to send,
 * the entries that turn deletes off (named for log lines), the files that
 * can't be refreshed, by file ID, the evidence definitions each well-formed
 * entry lists (see `evidenceDefinitionIdsOf`), by file ID, and the keys (see
 * `entryKey`) of every entry collected and of those file-service answered 404
 * for.
 */
interface CollectedFiles {
  records: PipelineFileRecord[];
  unresolved: string[];
  failed: Map<string, FileFailure>;
  evidence: Map<string, string[]>;
  keys: Set<string>;
  gone: Set<string>;
}

/**
 * What a run's pipeline files batches are built from once its list is read
 * again (see `settleFiles`): the `File` records and failures of files still
 * listed, the evidence definitions each file lists, by file ID, the keys of
 * the entries listed, the file IDs listed when that read succeeded, and why
 * deletes are off, if they are.
 */
interface SettledFiles {
  records: PipelineFileRecord[];
  failed: Map<string, FileFailure>;
  evidence: Map<string, string[]>;
  listedKeys: Set<string>;
  listedFileIds?: Set<string>;
  deletesOffReasons: string[];
}

/**
 * One batch of a run's pipeline files (see `filesBatches`): its class, its
 * records, and the files whose records belong in it but can't be refreshed,
 * by file ID.
 */
interface FilesBatch {
  className: string;
  records: PipelineFileRecord[];
  failed: Map<string, FileFailure>;
}

/**
 * What a run's files step tells its data mappings (see `run`): the files that
 * can't be refreshed, by file ID, the file IDs the pipeline lists, known
 * only when its list was read right before the pipeline files batches were
 * created, and the files their expressions read as `$files` (see
 * `MappingFiles`).
 */
interface FilesOutcome {
  failed: Map<string, FileFailure>;
  listedFileIds?: Set<string>;
  files: MappingFiles;
}

/**
 * What copying a Hub pipeline file again came to (see `copyHubFile`): copied,
 * kept at the version file-service has after a failure that may pass, or
 * failed for good with the reason.
 */
type CopyOutcome = { kind: 'copied' } | { kind: 'kept' } | { kind: 'failed'; reason: string };

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
   * `data` goes on the log with the message: `{ transient: false }` tells the
   * platform's classifier that a retry would get the same answer.
   */
  private async failBatch(batch: Batch<any>, message: string, cause: Error, data?: object): Promise<void> {
    try {
      await batch.error(message, data);
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
   *
   * Mapping expressions read two bindings:
   * - **`$pipelineId`:** the pipeline's id, the group the batch goes to, so a
   *   template can make ids from a workbook that several pipelines load
   *   unique to each one: the platform's linker resolves a reference by id
   *   across the whole org.
   * - **`$files`:** `files`, the pipeline files this run resolved, by name
   *   (see `MappingFiles`), so a template that ships a file can point a row
   *   at the file's current version, whose ID it can't know:
   *   `$lookup($files, "floorplan.webp").fileVersionId`.
   */
  private async processDataMapping(
    dataMapping: DataMapping,
    groupId: string,
    queries: SavedQueryRegistry,
    files: MappingFiles,
  ): Promise<void> {
    const { source, destination, mappings, metadata } = dataMapping;

    this.logger.info(
      `Processing data mapping: ${metadata.name || 'unnamed'} ` +
      `(${source.objectName} -> ${destination.className})`
    );

    const tags = readsFromHubTarget(source) ? this.connectionMetadata?.tags : undefined;
    const batch = await this.initBatchForClass(destination.className, groupId, { tags });
    const bindings = { pipelineId: groupId, files };

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
          // Expressions read the pipeline as $pipelineId and its resolved files as $files
          const { result, errors } = await applyMappings(item, mappings, bindings);
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
   * Collect the files attached to the pipeline again as a full snapshot in
   * group `pipeline-files:<pipelineId>`, so the objects the platform imported
   * when each file was added stay current and those of removed files are
   * deleted. Only the job whose launch params carry `files` gets here, and it
   * collects the pipeline's current list (see `currentPipelineFiles`).
   * Preview runs collect no files: they only read each listed file's metadata
   * for `$files` (see `previewMappingFiles`).
   *
   * The snapshot is two batches (see `filesBatches`), as the platform's own
   * snapshots are:
   * - **`File`:** a record for each file that lists no evidence definitions.
   *   A file that comes to list some leaves it, so its deletes give that
   *   file's File object a deleted, empty version.
   * - **`EvidenceFile`:** a record for each evidence definition of each file
   *   that lists some. When no listed file does, it is empty, and its deletes
   *   take out every EvidenceFile object left in the group, such as one a
   *   stale run brought back after the platform deleted it.
   *
   * Every entry is resolved (see `collectFiles`) by the step's deadline,
   * `filesDeadlineMs` after it starts, before the batches are created, because
   * `deletesEnabled` is fixed at creation. Right before creating them, the
   * list is read again and the files added meanwhile are collected too (see
   * `settleFiles`), so an add or remove made during the run is not undone.
   * Deletes stay on only when that read succeeded and no entry collected is
   * malformed, unresolved or past the deadline, so a file-service hiccup
   * never deletes the object of a file that is still attached. Any of those
   * turns deletes off on both batches. The copy-wait budget
   * (`copyWait.perRunMs`) covers both collections.
   *
   * A file that can't be refreshed fails the batch its records belong to (see
   * `sendFilesBatch`). That is a file file-service answers 404 for, or a Hub
   * file whose source answers 404 or refuses the copy (see `collectFile`). The
   * mappings that read those files fail as well (see `run`).
   *
   * Other problems are logged at warn, since an error log on a batch makes the
   * platform fail it.
   *
   * The data mappings read the files it resolved as `$files` (see
   * `settledMappingFiles`).
   */
  private async processFiles(launchFiles: unknown[], pipelineId: string): Promise<FilesOutcome> {
    const nothing: FilesOutcome = { failed: new Map(), files: NO_MAPPING_FILES };
    if (this.context.previewMode) {
      this.logger.info(`Preview run: not collecting ${launchFiles.length} pipeline file(s), only reading their metadata for $files`);
      return { failed: new Map(), files: await this.previewMappingFiles(launchFiles) };
    }

    const deadline = Date.now() + this.filesDeadlineMs;
    const files = await this.currentPipelineFiles(launchFiles);
    if (!files) {
      this.logger.info('The pipeline no longer lists files; sending no File batch');
      return nothing;
    }

    this.copyWaitSpentMs = 0;
    const collected = await this.collectFiles(files, deadline);
    const settled = await this.settleFiles(collected, deadline);
    if (!settled) {
      this.logger.info('The pipeline no longer lists files; sending no File batch');
      return nothing;
    }

    const { listedKeys, failed } = settled;
    const allGone = listedKeys.size > 0 && [...listedKeys].every((key) => collected.gone.has(key));
    const reasons = collected.unresolved.length > 0
      ? [`${collected.unresolved.length} of ${collected.keys.size} pipeline file(s) could not be resolved: ${nameSome(collected.unresolved)}`]
      : [];
    reasons.push(...settled.deletesOffReasons);
    for (const batch of filesBatches(settled, pipelineId)) {
      await this.sendFilesBatch(batch, `pipeline-files:${pipelineId}`, reasons, allGone ? failed.size : undefined);
    }
    return { failed, listedFileIds: settled.listedFileIds, files: settledMappingFiles(settled) };
  }

  /**
   * The `$files` of a preview run, which collects no files (see
   * `processFiles`), so that a preview maps the values a run would. Each
   * well-formed entry of the launch-time list gets one file-service metadata
   * read, by the files deadline, and resolves as a run resolves it (see
   * `fileOutcome`): no copy, no batch and no write. A Hub file therefore shows
   * the version file-service has, where a run would copy it again first. A
   * file whose read fails is left out, as are the entries the deadline stops
   * before.
   */
  private async previewMappingFiles(launchFiles: unknown[]): Promise<MappingFiles> {
    const deadline = Date.now() + this.filesDeadlineMs;
    const records: PipelineFileRecord[] = [];
    for (const entry of launchFiles.filter(isPipelineFile)) {
      if (Date.now() >= deadline) {
        this.logger.warn(`Preview run: reading pipeline file metadata reached its ${this.filesDeadlineMs} ms deadline; $files leaves the rest out`);
        break;
      }
      try {
        const outcome = this.fileOutcome(entry, await this.fileService.getFile(entry.fileId, { deadline }));
        if (outcome.kind === 'record') {
          records.push(outcome.record);
        }
      } catch (error) {
        this.logger.warn(`Preview run: could not read pipeline file ${describeFile(entry)}, so $files leaves it out: ${(error as Error).message}`);
      }
    }
    return mappingFiles(records);
  }

  /**
   * Send one batch of a run's pipeline files (see `processFiles`) in
   * `groupId`, with deletes on only when nothing in `reasons` turned them off
   * and none of its files failed.
   *
   * When some did, the batch fails:
   * - It still carries every record it has, with deletes off, plus one error
   *   naming each such file, marked terminal (see `filesFailureMessage`).
   * - The platform then fails this batch, imports the run's other batches and
   *   shows the pipeline in error, while each of this batch's objects keeps
   *   its last version.
   * - This holds when every listed file answered 404 too. `allGone` is then
   *   how many files the pipeline lists, since a wrong file-service URL or
   *   missing access looks the same, and the error says so.
   *
   * No batch is sent when there is no record, no failure and deletes are off,
   * since it would change nothing. Otherwise a batch with no record is sent
   * empty, which deletes the objects of removed files. Records go to the
   * platform `FILE_CHUNK_SIZE` at a time, and a failed `addItems` fails the
   * batch too (see `failBatch`).
   */
  private async sendFilesBatch(
    { className, records, failed }: FilesBatch,
    groupId: string,
    reasons: string[],
    allGone?: number,
  ): Promise<void> {
    const deletesEnabled = reasons.length === 0 && failed.size === 0;
    if (records.length === 0 && !deletesEnabled && failed.size === 0) {
      this.logger.warn(
        `No pipeline file produced a ${className} record and deletes are off, so sending no ${className} batch: ${reasons.join('; ')}`
      );
      return;
    }

    this.logger.info(
      `Sending ${records.length} pipeline file record(s) as the ${className} batch (deletes ${deletesEnabled ? 'on' : 'off'})`
    );
    const batch = await this.initBatchForClass(className, groupId, { deletesEnabled });
    try {
      if (reasons.length > 0) {
        await batch.warn(`Deletes are off for this run: ${reasons.join('; ')}`);
      }
      for (let start = 0; start < records.length; start += FILE_CHUNK_SIZE) {
        await batch.addItems(records.slice(start, start + FILE_CHUNK_SIZE).map((payload) => ({ payload })));
      }
    } catch (error) {
      await this.failBatch(batch, `Failed to add pipeline files to the batch: ${(error as Error).message}`, error as Error);
      return;
    }
    if (failed.size > 0) {
      const message = filesFailureMessage(className, failed, allGone);
      await this.failBatch(batch, message, new Error(message), { transient: false });
      return;
    }
    await batch.end();
  }

  /**
   * Resolve `files` one at a time (see `collectFile`) into `collected`,
   * passing `deadline` down to every file-service call. The deadline is
   * checked before each entry: a malformed entry, an unresolved one and every
   * entry not reached in time go in `unresolved`. An entry file-service
   * answered 404 for goes in `gone`, and in `failed` with one whose Hub source
   * answered 404 or refused the copy, which also keeps the record it still has.
   * The evidence definitions of every well-formed entry go in `evidence`.
   */
  private async collectFiles(
    files: unknown[],
    deadline: number,
    collected: CollectedFiles = { records: [], unresolved: [], failed: new Map(), evidence: new Map(), keys: new Set(), gone: new Set() },
  ): Promise<CollectedFiles> {
    for (const entry of files) {
      collected.keys.add(entryKey(entry));
      if (isPipelineFile(entry)) {
        collected.evidence.set(entry.fileId, evidenceDefinitionIdsOf(entry));
      }
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
        collected.failed.set(entry.fileId, {
          name: entry.name,
          reason: 'file-service answered 404 for it, so it was deleted or this job cannot see it',
        });
      } else if (outcome.kind === 'failed') {
        if (outcome.record) {
          collected.records.push(outcome.record);
        }
        collected.failed.set(entry.fileId, { name: entry.name, reason: outcome.reason });
      } else if (outcome.kind === 'unresolved') {
        collected.unresolved.push(describeFile(entry));
      }
    }
    return collected;
  }

  /**
   * Read the pipeline's list again right before the pipeline files batches
   * are created and fit what this run collected to it, so a file added or
   * removed meanwhile is not undone. The records of files no longer listed are
   * dropped. Entries the list now holds that this run did not collect are
   * collected into `collected` too, by the same `deadline`: the run's batches
   * are newer than the platform's own snapshot of the add, which they
   * supersede, so they must carry their records. One of them that is
   * malformed, unresolved or past the deadline turns deletes off, as in the
   * first collection; one that answers 404, or whose Hub source fails, fails
   * like any other. The failures of files no longer listed are dropped with
   * their records. Each file's evidence definitions are taken from this read
   * as well, so a change to them made meanwhile is not undone either.
   *
   * The file IDs it lists for `run` include those of malformed entries that
   * name a `fileId`, so a malformed entry never makes its file's mappings look
   * removed. A malformed entry without one could be any file, so the read then
   * lists no file IDs at all.
   *
   * A failed read keeps every record and failure, and the evidence
   * definitions as collected, turns deletes off and lists no file IDs, so no
   * mapping is taken for one whose file was removed (see `run`). Returns
   * undefined when the pipeline no longer has a `files` key.
   */
  private async settleFiles(collected: CollectedFiles, deadline: number): Promise<SettledFiles | undefined> {
    let listed: unknown[] | undefined;
    try {
      listed = await this.readPipelineFiles();
    } catch (error) {
      this.logger.warn(`Could not read the pipeline's files again before sending them, so deletes are off: ${(error as Error).message}`);
      return {
        records: collected.records,
        failed: collected.failed,
        evidence: collected.evidence,
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

    const current = listed.filter(isPipelineFile);
    const listedIds = new Set(current.map((entry) => entry.fileId));
    const removed = collected.records.filter((record) => !listedIds.has(record.id));
    if (removed.length > 0) {
      this.logger.info(
        `${removed.length} pipeline file(s) were removed while this run collected files; leaving them out: ` +
        nameSome(removed.map((record) => `"${record.name}" (${record.id})`))
      );
    }
    return {
      records: collected.records.filter((record) => listedIds.has(record.id)),
      failed: new Map([...collected.failed].filter(([fileId]) => listedIds.has(fileId))),
      evidence: new Map(current.map((entry): [string, string[]] => [entry.fileId, evidenceDefinitionIdsOf(entry)])),
      listedKeys: new Set(listed.map(entryKey)),
      listedFileIds: listed.some((entry) => namedFileId(entry) === undefined) ? undefined : new Set(listed.map(namedFileId) as string[]),
      deletesOffReasons: [],
    };
  }

  /**
   * Collect one pipeline file by the rule the platform's add/remove endpoint
   * follows, so both build the same record. The file's view is read first:
   * a 404 means the file is gone, and any other failure leaves it unresolved.
   * A gone Hub file is never copied, since copying it again would make
   * file-service create an orphan. A Hub file that exists is copied from its
   * target again (see `copyHubFile`), and its view is read again.
   * - When its source answers 404 or refuses the copy, the file `failed`, with
   *   the record of the view already read, so its object keeps that version.
   * - When the copy call fails any other way, the view already read is used.
   *
   * A failure of the second read counts the same way as one of the first.
   * Every call is bounded by `deadline`.
   */
  private async collectFile(entry: PipelineFile, deadline: number): Promise<FileOutcome> {
    try {
      let view = await this.fileService.getFile(entry.fileId, { deadline });
      if (entry.source === 'hub') {
        const copy = await this.copyHubFile(entry, deadline);
        if (copy.kind === 'failed') {
          const kept = this.fileOutcome(entry, view);
          return { kind: 'failed', reason: copy.reason, record: kept.kind === 'record' ? kept.record : undefined };
        }
        if (copy.kind === 'copied') {
          view = await this.fileService.getFile(entry.fileId, { deadline });
        }
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
   * (see `awaitCopy`). It never throws, and when the copy call itself fails:
   * - A 404, because the object is no longer on the target, or a 409, because
   *   Hub refused the copy, is `failed` with the reason (see `sourceFailure`).
   *   A retry would get the same answer, so neither is retried.
   * - Any other failure is `kept` after a warning, so the caller keeps the
   *   view it read, as a fetch the client already retried may pass by the
   *   next run.
   */
  private async copyHubFile(entry: HubPipelineFile, deadline: number): Promise<CopyOutcome> {
    let status: FileServiceFileStatus | undefined;
    try {
      ({ status } = await this.fileService.copyFile({
        sourceTarget: entry.targetId,
        sourcePath: entry.objectId,
        destinationPath: entry.destinationPath,
      }, { deadline }));
    } catch (error) {
      const reason = sourceFailure(entry, error);
      if (reason) {
        this.logger.warn(`Pipeline file ${describeFile(entry)} can't be copied again: ${reason}`);
        return { kind: 'failed', reason };
      }
      this.logger.warn(
        `Could not copy pipeline file ${describeFile(entry)} again from target ${entry.targetId}; ` +
        `using the version file-service already has: ${(error as Error).message}`
      );
      return { kind: 'kept' };
    }
    if (await this.awaitCopy(entry, deadline, status) === 'error') {
      this.logger.warn(`file-service could not copy pipeline file ${describeFile(entry)} again; using the version it already has`);
    }
    return { kind: 'copied' };
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
   * Fail the batch of a mapping whose source file this run can't refresh (see
   * `processFiles`), without reading the copy file-service still has. The
   * mapping's objects keep their last version rather than taking rows that may
   * be stale.
   *
   * The batch has deletes off and a terminal error, since a retry gets the
   * same answer. The error is rethrown, so the run logs the mapping as failed.
   */
  private async failMappingOfFailedFile(
    dataMapping: DataMapping,
    groupId: string,
    fileId: string,
    failure: FileFailure,
  ): Promise<void> {
    const message = `Source file "${failure.name}" (${fileId}) can't be refreshed: ${failure.reason}. ` +
      "This mapping's objects keep their last version.";
    const batch = await this.initBatchForClass(dataMapping.destination.className, groupId, { deletesEnabled: false });
    const error = new Error(message);
    await this.failBatch(batch, message, error, { transient: false });
    throw error;
  }

  /**
   * Delete the objects of mappings whose source file the pipeline no longer
   * lists: removing a file from the pipeline removes what it was collected
   * into. Their files are not read.
   * - **No other mapping of this run sent the class:** it gets one empty batch,
   *   whose deletes give its objects deleted, empty versions.
   * - **Another mapping sent the class:** it is left to that batch. Its deletes
   *   already take out the objects it no longer carries, and an empty batch of
   *   the same class and group would delete that mapping's objects too.
   *
   * Preview runs send nothing.
   */
  private async clearRemovedMappings(removed: DataMapping[], sentClasses: Set<string>, groupId: string): Promise<void> {
    if (removed.length === 0) {
      return;
    }
    if (this.context.previewMode) {
      this.logger.info(`Preview run: not clearing the ${removed.length} data mapping(s) whose file the pipeline no longer lists`);
      return;
    }
    const byClass = new Map<string, string[]>();
    for (const dataMapping of removed) {
      const { className } = dataMapping.destination;
      byClass.set(className, [...(byClass.get(className) ?? []), dataMapping.metadata.name || dataMapping.id]);
    }
    for (const [className, names] of byClass) {
      const which = `${names.length} data mapping(s) into ${className} read a file the pipeline no longer lists: ${nameSome(names)}`;
      if (sentClasses.has(className)) {
        this.logger.info(`${which}. The class's other batch deletes their objects`);
        continue;
      }
      this.logger.info(`${which}. Sending an empty ${className} batch, so their objects are deleted`);
      try {
        const batch = await this.initBatchForClass(className, groupId);
        await batch.end();
      } catch (error) {
        this.logger.error(`Failed to clear the ${className} objects of a removed file: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Collect the pipeline's files when this job's launch params carry `files`
   * (see `processFiles`), then run its data mappings. Files go first, ahead of
   * the no-mappings return, so a pipeline that only has files still collects
   * them; a failure there is logged and the data mappings still run.
   *
   * Every data mapping's expressions read the files the step resolved as
   * `$files` (see `processDataMapping`). A job whose launch params carry no
   * `files`, as every job of a run but the one that collects them, reads
   * `{}`, as does every mapping of a run whose files step throws.
   *
   * What the files step found decides two kinds of file-backed mapping:
   * - **Its file can't be refreshed:** the mapping fails without reading it,
   *   so its objects keep their last version (see `failMappingOfFailedFile`).
   * - **The pipeline no longer lists its file:** the mapping reads nothing,
   *   and its objects are deleted (see `clearRemovedMappings`). That is only
   *   decided when the list was read right before the pipeline files batches.
   *
   * Both go by file ID, whichever batch the file's records belong to.
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

    let filesOutcome: FilesOutcome = { failed: new Map(), files: NO_MAPPING_FILES };
    if (Array.isArray(files)) {
      try {
        filesOutcome = await this.processFiles(files, `${pipelineId}`);
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
    const sentClasses = new Set<string>();
    const removed: DataMapping[] = [];

    // Process each data mapping
    for (const dataMapping of dataMappings) {
      const fileId = dataMapping.source.file?.fileId;
      const failure = fileId ? filesOutcome.failed.get(fileId) : undefined;
      if (fileId && !failure && filesOutcome.listedFileIds && !filesOutcome.listedFileIds.has(fileId)) {
        removed.push(dataMapping);
        continue;
      }
      sentClasses.add(dataMapping.destination.className);
      try {
        if (fileId && failure) {
          await this.failMappingOfFailedFile(dataMapping, groupId, fileId, failure);
        } else {
          await this.processDataMapping(dataMapping, groupId, queries, filesOutcome.files);
        }
      } catch (error) {
        this.logger.error(
          `Failed to process data mapping ${dataMapping.id}: ${(error as Error).message}`
        );
        // Continue with other mappings even if one fails
      }
    }

    await this.clearRemovedMappings(removed, sentClasses, groupId);
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
 * Why a Hub pipeline file's copy failed for good, or undefined when the
 * failure may pass. file-service answers 404 when the object is no longer on
 * the target, and 409 when Hub refuses the copy, as it does for a deleted
 * connection, expired credentials or revoked access.
 */
function sourceFailure(entry: HubPipelineFile, error: unknown): string | undefined {
  const status = error instanceof FileServiceError ? error.status : undefined;
  if (status === 404) {
    return `it is no longer at its location on target ${entry.targetId} (file-service answered 404)`;
  }
  if (status === 409) {
    return `Hub refused to copy it from target ${entry.targetId} (file-service answered 409), ` +
      'as it does when the connection is deleted, its credentials expire or its access is revoked';
  }
  return undefined;
}

/**
 * The batches a run's pipeline files go in (see `processFiles`), from what
 * `settleFiles` came to. Both are always there, as in the platform's own
 * snapshots:
 * - **`File`:** the records and failures of the files that list no evidence
 *   definitions.
 * - **`EvidenceFile`:** the EvidenceFile records (see `evidenceFileRecords`)
 *   and the failures of the files that list some. When no listed file lists
 *   any, it is empty, so with deletes on it deletes every EvidenceFile object
 *   left in the group.
 *
 * The empty batch is what lets the next run correct a stale one. A run that
 * read the list before a file's last evidence definitions were taken off, or
 * before the last file that lists some was removed, sends batches newer than
 * the platform's snapshot of that change, and they bring back the
 * EvidenceFile objects that snapshot deleted. Without the empty batch,
 * nothing would delete them again.
 *
 * The pipeline's ID is only parsed, as the records' namespace, when there is
 * an EvidenceFile record to build.
 */
function filesBatches({ records, failed, evidence }: SettledFiles, pipelineId: string): FilesBatch[] {
  const listsEvidence = (fileId: string) => (evidence.get(fileId)?.length ?? 0) > 0;
  const evidenced = records.filter((record) => listsEvidence(record.id));
  const namespace = evidenced.length > 0 ? new UUID(pipelineId) : undefined;
  return [
    {
      className: FILE_CLASS,
      records: records.filter((record) => !listsEvidence(record.id)),
      failed: new Map([...failed].filter(([fileId]) => !listsEvidence(fileId))),
    },
    {
      className: EVIDENCE_FILE_CLASS,
      records: namespace ? evidenced.flatMap((record) => evidenceFileRecords(record, evidence.get(record.id) ?? [], namespace)) : [],
      failed: new Map([...failed].filter(([fileId]) => listsEvidence(fileId))),
    },
  ];
}

/**
 * The error that fails a run's `className` batch of pipeline files (see
 * `sendFilesBatch`): each of its files that can't be refreshed, why, and what
 * to do about it. When every listed file answered 404, `allGone` is how many
 * the pipeline lists, and it says so first, as a wrong file-service URL or
 * missing access looks the same.
 */
function filesFailureMessage(className: string, failed: Map<string, FileFailure>, allGone?: number): string {
  const files = [...failed].map(([fileId, failure]) => `"${failure.name}" (${fileId}): ${failure.reason}`);
  const head = allGone
    ? `file-service answered 404 for all ${allGone} pipeline file(s), as it would for a wrong file-service URL or missing access`
    : `${failed.size} pipeline file(s) can't be refreshed`;
  return `${head}: ${nameSome(files)}. The ${className} objects keep their last version. ` +
    'Restore each file at its source, pick it again, or remove it from the pipeline.';
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
 * Either may carry `evidenceDefinitionIds`, which must then be an array of
 * strings; an entry whose `evidenceDefinitionIds` is anything else, null
 * included, is malformed.
 */
function isPipelineFile(entry: unknown): entry is PipelineFile {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const {
    fileId, name, source, targetId, objectId, destinationPath, evidenceDefinitionIds,
  } = entry as Record<string, unknown>;
  if (typeof fileId !== 'string' || typeof name !== 'string') {
    return false;
  }
  if (evidenceDefinitionIds !== undefined && !isStringArray(evidenceDefinitionIds)) {
    return false;
  }
  return source === 'upload'
    || (source === 'hub' && typeof targetId === 'string' && typeof objectId === 'string' && typeof destinationPath === 'string');
}

/** The `fileId` a listed entry names, well-formed or not, or undefined when it names none. */
function namedFileId(entry: unknown): string | undefined {
  const fileId = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).fileId : undefined;
  return typeof fileId === 'string' ? fileId : undefined;
}

/** Whether `value` is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The evidence definitions a pipeline file lists, each once, in the order
 * first listed: none when it lists none, or an empty list.
 */
function evidenceDefinitionIdsOf(entry: PipelineFile): string[] {
  return [...new Set(entry.evidenceDefinitionIds ?? [])];
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
 * The `EvidenceFile` records of a pipeline file that lists evidence
 * definitions, one per evidence definition, built as the platform builds
 * them, key for key and value for value (see `pipelineFileRecord` for why):
 * the file's `File` record under its own `id`, then `pipelineId` and
 * `evidenceDefinition`. That `id` is a UUIDv5 of
 * `<fileId>:<evidenceDefinitionId>` in the pipeline's ID as namespace, so a
 * file and evidence definition keep one object across runs.
 */
function evidenceFileRecords(fileRecord: PipelineFileRecord, evidenceDefinitionIds: string[], pipelineId: UUID): EvidenceFileRecord[] {
  return evidenceDefinitionIds.map((evidenceDefinitionId) => ({
    ...fileRecord,
    id: UUID.generateV5(`${fileRecord.id}:${evidenceDefinitionId}`, pipelineId).toString(),
    pipelineId: pipelineId.toString(),
    evidenceDefinition: evidenceDefinitionId,
  }));
}

/**
 * The `$files` of a run's data mappings (see `MappingFiles`), from what
 * `settleFiles` came to: the record of each file the run resolved, in the
 * order of the list it settled on, so the first listed wins a name several
 * share, even one added mid-run ahead of the files collected before it. A
 * file that can't be refreshed is left out, though its pipeline files batch
 * still carries the version file-service has; one that is unresolved or has
 * no ready version has no record.
 */
function settledMappingFiles({ records, failed, listedKeys }: SettledFiles): MappingFiles {
  const position = new Map([...listedKeys].map((key, index): [string, number] => [key, index]));
  const listedAt = (record: PipelineFileRecord) => position.get(fileKey(record.id)) ?? position.size;
  return mappingFiles(records.filter((record) => !failed.has(record.id)).toSorted((a, b) => listedAt(a) - listedAt(b)));
}

/**
 * The `$files` that `records`, in list order, make: each as a `MappingFile`
 * under its name, the first winning a name several share. It and its values
 * are frozen: every row of the run reads the same objects, and data-utils
 * puts an object an expression returns into the mapped item as it is, so a
 * rule that wrote below it would otherwise change what the rows after read.
 */
function mappingFiles(records: PipelineFileRecord[]): MappingFiles {
  const files = new Map<string, MappingFile>();
  for (const { id, name, fileVersionId, size, mimeType } of records) {
    if (!files.has(name)) {
      files.set(name, Object.freeze({ fileId: id, fileVersionId, name, size, ...(mimeType ? { mimeType } : {}) }));
    }
  }
  return Object.freeze(Object.fromEntries(files));
}

/**
 * The key a `params.files` entry is matched by between the run's two reads of
 * the list: the `fileId` of a well-formed entry (see `fileKey`), the JSON of a
 * malformed one.
 */
function entryKey(entry: unknown): string {
  return isPipelineFile(entry) ? fileKey(entry.fileId) : `entry:${JSON.stringify(entry) ?? String(entry)}`;
}

/** The key (see `entryKey`) of a well-formed entry that lists `fileId`. */
function fileKey(fileId: string): string {
  return `file:${fileId}`;
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
