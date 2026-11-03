import { ConnectionMetadata, UnexpectedError, UUID } from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { extractRows, resolveMappingSql, SavedQueryRegistry } from '@zerobias-org/data-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { FileSourceClient, FileSourceReader } from './FileSourceReader.js';
import { applyMappings } from './Mappers.js';
import { DataMapping, DataMappingParams, DataMappingSource, FileSourceRecord, MappingFileSource } from './types/index.js';

/** Rows read per file-service records page for a file-backed mapping. */
const FILE_RECORDS_PAGE_SIZE = 100;

@injectable()
export class CollectorZerobiasZerobiasDynamicImpl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;

  private _jobId?: UUID;

  private _parameters?: DataMappingParams;

  private _fileSourceReader?: FileSourceReader;

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
   * The file-service reader file-backed mappings go through. It is built from
   * the job's context on first use, so runs without file sources never create
   * one; tests assign a fake here instead.
   */
  get fileSourceReader(): FileSourceReader {
    if (!this._fileSourceReader) {
      this._fileSourceReader = FileSourceClient.fromContext(this.context);
    }
    return this._fileSourceReader;
  }

  set fileSourceReader(reader: FileSourceReader) {
    this._fileSourceReader = reader;
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

  private async initBatchForClass(
    className: string,
    groupId: string
  ): Promise<Batch<any>> {
    const batch = new Batch<any>(
      className,
      this.platform,
      this.logger,
      this.jobId,
      this.connectionMetadata?.tags,
      groupId
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
   *  - `file` set → read an uploaded file through file-service
   *    (see `fetchFileSourceItems`).
   *
   * Every path produces the same item shape (a plain row object) so the
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
    if (source.file) {
      yield* this.fetchFileSourceItems(source.file);
      return;
    }

    const { objectId } = source;
    if (!objectId) {
      throw new Error(`Mapping source "${source.objectName}" has neither an objectId nor a file`);
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
    for await (const item of results) yield item;
  }

  /**
   * Yield the items of a file-backed mapping from the file's **latest**
   * version: the rows of `containerPath` (paged until the reader runs out),
   * or — with no `containerPath` — the file itself as one `FileSourceRecord`.
   * A file that can't be read, or has no current version, throws, so the
   * mapping fails instead of looking like an empty file.
   */
  private async *fetchFileSourceItems(file: MappingFileSource): AsyncIterable<any> {
    const view = await this.fileSourceReader.getFile(file.fileId);
    const fileVersionId = view.fileVersionId;
    if (!fileVersionId) {
      throw new Error(`Source file ${file.fileId} has no current version`);
    }

    if (!file.containerPath) {
      this.logger.info(`Reading source file ${file.fileId} (version ${fileVersionId}) as one record`);
      const record: FileSourceRecord = {
        id: file.fileId,
        fileVersionId,
        name: view.name ?? null,
        mimeType: view.mimeType ?? null,
        size: view.size ?? null,
        created: view.created ?? null,
        updated: view.updated ?? null,
      };
      yield record;
      return;
    }

    this.logger.info(
      `Reading ${file.containerPath} of source file ${file.fileId} (version ${fileVersionId})`
    );
    let read = 0;
    for (let pageNumber = 1; ; pageNumber += 1) {
      const page = await this.fileSourceReader.listContainerRecords(
        fileVersionId,
        file.containerPath,
        pageNumber,
        FILE_RECORDS_PAGE_SIZE,
      );
      for (const row of page.items) yield row;
      read += page.items.length;
      const pastTotal = page.count >= 0 && read >= page.count;
      if (page.items.length < FILE_RECORDS_PAGE_SIZE || pastTotal) {
        break;
      }
    }
    this.logger.info(`Source file ${file.fileId} ${file.containerPath} returned ${read} row(s)`);
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

  public async run(parameters?: DataMappingParams): Promise<void> {
    if (parameters) {
      this.parameters = parameters;
    }
    await this.init();

    const { dataMappings, queries } = this.parameters;

    if (!dataMappings || dataMappings.length === 0) {
      this.logger.warn('No data mappings configured');
      return;
    }

    this.logger.info(
      `Processing ${dataMappings.length} data mapping(s)` +
      (queries ? ` with ${Object.keys(queries).length} saved query(ies)` : '')
    );

    // Use pipeline ID for groupId as per requirements
    const pipelineId = this.context.pipelineId || 'default';
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
