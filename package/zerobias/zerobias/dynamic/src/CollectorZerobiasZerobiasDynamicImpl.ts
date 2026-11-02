import { ConnectionMetadata, UnexpectedError, UUID } from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { extractRows, resolveMappingSql, SavedQueryRegistry } from '@zerobias-org/data-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { FileService, FileServiceClient, FileServiceFile } from './FileServiceClient.js';
import { applyMappings } from './Mappers.js';
import { DataMapping, DataMappingParams, DataMappingSource, PipelineFile, PipelineFileRecord } from './types/index.js';

/** file-service statuses whose version may stand in when a file's view has no current version yet. */
const USABLE_FILE_STATUSES = new Set(['created', 'fetching', 'ready']);

@injectable()
export class CollectorZerobiasZerobiasDynamicImpl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;

  private _jobId?: UUID;

  private _parameters?: DataMappingParams;

  private _fileService?: FileService;

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
   * A source fetch that fails part-way is logged as an error on the batch
   * before it ends, so the platform fails the batch instead of treating the
   * partial item list as complete and deleting every object it left out.
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
      await batch.error(
        `Failed to fetch source items: ${(error as Error).message}`
      );
      throw error;
    } finally {
      await batch.end();
    }
  }

  /**
   * Collect the files attached to the pipeline (`params.files`) again as a
   * single `File` batch, so the objects the platform imported when each file
   * was added stay current and those of removed files are deleted.
   *
   * Every entry is resolved before the batch is created, because
   * `deletesEnabled` is fixed at creation: deletes stay on only when every
   * entry resolved, so a file-service hiccup never deletes the object of a
   * file that is still attached. An empty list still sends an empty batch,
   * which deletes objects a stale run brought back; a non-empty list where
   * nothing resolved sends no batch. Preview runs skip files entirely.
   *
   * Problems are logged at warn, never error: an error log on the batch makes
   * the platform fail it. The one exception is a failed `addItems`, where
   * failing the batch is the point.
   */
  private async processFiles(files: PipelineFile[], pipelineId: string): Promise<void> {
    if (this.context.previewMode) {
      this.logger.info(`Preview run: skipping ${files.length} pipeline file(s)`);
      return;
    }

    const records: PipelineFileRecord[] = [];
    const unresolved: PipelineFile[] = [];
    for (const entry of files) {
      const record = await this.collectFile(entry);
      if (record) {
        records.push(record);
      } else {
        unresolved.push(entry);
      }
    }

    if (files.length > 0 && records.length === 0) {
      this.logger.warn(`None of the ${files.length} pipeline file(s) could be resolved; sending no File batch`);
      return;
    }

    const deletesEnabled = unresolved.length === 0;
    this.logger.info(
      `Sending ${records.length} pipeline file(s) as a File batch (deletes ${deletesEnabled ? 'on' : 'off'})`
    );
    const batch = await this.initBatchForClass('File', `pipeline-files:${pipelineId}`, deletesEnabled);
    try {
      if (!deletesEnabled) {
        await batch.warn(
          `Deletes are off for this run: ${unresolved.length} of ${files.length} pipeline file(s) could not be resolved: ` +
          `${unresolved.map(describeFile).join(', ')}`
        );
      }
      if (records.length > 0) {
        await batch.addItems(records.map((payload) => ({ payload })));
      }
    } catch (error) {
      await batch.error(`Failed to add pipeline files to the batch: ${(error as Error).message}`);
    } finally {
      await batch.end();
    }
  }

  /**
   * Collect one pipeline file. A `hub` entry is copied from its target again
   * first so the latest remote contents become a new version; if that copy
   * fails, the version file-service already holds is used instead.
   */
  private async collectFile(entry: PipelineFile): Promise<PipelineFileRecord | undefined> {
    if (entry.source === 'hub') {
      try {
        await this.fileService.copyFile({
          sourceTarget: entry.targetId,
          sourcePath: entry.objectId,
          destinationPath: entry.destinationPath,
        });
      } catch (error) {
        this.logger.warn(
          `Could not copy pipeline file ${describeFile(entry)} again from target ${entry.targetId}; ` +
          `using the version file-service already has: ${(error as Error).message}`
        );
      }
    }
    return this.resolveFileRecord(entry);
  }

  /**
   * Build the `File` record for a pipeline file from file-service, or return
   * undefined when the entry is unresolved: its view cannot be read (a 404
   * included), it has no usable version, or its size is unknown. A view
   * without a current version falls back to the version on the file's status
   * while that status is `created`, `fetching` or `ready`.
   */
  private async resolveFileRecord(entry: PipelineFile): Promise<PipelineFileRecord | undefined> {
    let view: FileServiceFile;
    try {
      view = await this.fileService.getFile(entry.fileId);
    } catch (error) {
      this.logger.warn(`Pipeline file ${describeFile(entry)} is unresolved: could not read it: ${(error as Error).message}`);
      return undefined;
    }

    let versionId = view.fileVersionId;
    if (!versionId) {
      try {
        const status = await this.fileService.getFileStatus(entry.fileId);
        if (status.status && USABLE_FILE_STATUSES.has(status.status) && status.fileVersionId) {
          versionId = status.fileVersionId;
          this.logger.warn(
            `Pipeline file ${describeFile(entry)} has no current version; using version ${versionId} from its status (${status.status})`
          );
        } else {
          this.logger.warn(`Pipeline file ${describeFile(entry)} has no current version and its status is ${status.status}`);
        }
      } catch (error) {
        this.logger.warn(`Could not read the status of pipeline file ${describeFile(entry)}: ${(error as Error).message}`);
      }
    }

    if (!versionId || view.size === null || view.size === undefined) {
      this.logger.warn(
        `Pipeline file ${describeFile(entry)} is unresolved: ${versionId ? 'its size is unknown' : 'it has no usable version'}`
      );
      return undefined;
    }

    const record: PipelineFileRecord = {
      id: entry.fileId,
      name: entry.name,
      fileVersionId: versionId,
      size: view.size,
    };
    if (view.mimeType) {
      record.mimeType = view.mimeType;
    }
    return record;
  }

  /**
   * Collect the pipeline's files (when `files` is present), then run its data
   * mappings. Files go first, ahead of `init()` and the no-mappings return,
   * so a pipeline that only has files still collects them; a failure there is
   * logged and the data mappings still run.
   */
  public async run(parameters?: DataMappingParams): Promise<void> {
    if (parameters) {
      this.parameters = parameters;
    }
    const { dataMappings, queries, files } = this.parameters;

    // Use pipeline ID for groupId as per requirements
    const pipelineId = this.context.pipelineId || 'default';

    if (files) {
      try {
        await this.processFiles(files, `${pipelineId}`);
      } catch (error) {
        this.logger.error(`Failed to collect pipeline files: ${(error as Error).message}`);
      }
    }

    await this.init();

    if (!dataMappings || dataMappings.length === 0) {
      this.logger.warn('No data mappings configured');
      return;
    }

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
 * Name a pipeline file in log lines by its entry name and file ID.
 */
function describeFile(entry: PipelineFile): string {
  return `"${entry.name}" (${entry.fileId})`;
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
