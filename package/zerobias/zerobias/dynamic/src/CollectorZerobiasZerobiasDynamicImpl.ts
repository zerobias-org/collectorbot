import { ConnectionMetadata } from '@auditmation/hub-core';
import { UnexpectedError, UUID } from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient';
import { applyMappings } from './Mappers';
import { DataMapping, DataMappingParams } from './types';

@injectable()
export class CollectorZerobiasZerobiasDynamicImpl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;

  private _jobId?: UUID;

  private _parameters?: DataMappingParams;

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
   * Process a single data mapping configuration
   * - Fetches data from the source using getCollectionElements
   * - Applies field mappings using DataMapper
   * - Adds transformed data to batch
   */
  private async processDataMapping(
    dataMapping: DataMapping,
    groupId: string
  ): Promise<void> {
    const { source, destination, mappings, metadata } = dataMapping;

    this.logger.info(
      `Processing data mapping: ${metadata.name || 'unnamed'} ` +
      `(${source.objectName} -> ${destination.className})`
    );

    // Initialize batch for the destination class
    const batch = await this.initBatchForClass(destination.className, groupId);

    // Get the collections API to fetch data
    const collectionsApi = this.dataproducer.getCollectionsApi();

    try {
      // Fetch collection elements using the source objectId
      this.logger.info(`Fetching collection elements from: ${source.objectId}`);

      const results = await collectionsApi.getCollectionElements(
        source.objectId,
        1,     // pageNumber
        100,   // pageSize (max is 100)
        undefined, // sortBy
        undefined  // sortDir
      );

      // Process each item through the mappings
      let processedCount = 0;
      let errorCount = 0;

      for await (const item of results) {
        // Check preview limit
        if (this.previewCount && processedCount >= this.previewCount) {
          break;
        }

        try {
          // Apply mappings to transform the item
          const { result: mappedItem, errors } = await applyMappings(item, mappings);

          if (errors.length > 0) {
            this.logger.warn(
              `Mapping warnings for item: ${errors.join(', ')}`
            );
          }

          // Add the mapped item to the batch
          await batch.add(mappedItem, item);
          processedCount++;

        } catch (err) {
          errorCount++;
          await batch.error(
            `Failed to process item: ${(err as Error).message}`,
            item
          );
        }
      }

      this.logger.info(
        `Completed mapping ${metadata.name || 'unnamed'}: ` +
        `${processedCount} items processed, ${errorCount} errors`
      );

    } catch (error) {
      this.logger.error(
        `Failed to fetch collection elements: ${(error as Error).message}`
      );
      throw error;
    } finally {
      await batch.end();
    }
  }

  public async run(): Promise<void> {
    await this.init();

    const { params } = this.parameters;
    const { dataMappings } = params;

    if (!dataMappings || dataMappings.length === 0) {
      this.logger.warn('No data mappings configured');
      return;
    }

    this.logger.info(`Processing ${dataMappings.length} data mapping(s)`);

    // Use pipeline ID for groupId as per requirements
    const pipelineId = this.context.pipelineId || 'default';
    const groupId = `${pipelineId}`;

    // Process each data mapping
    for (const dataMapping of dataMappings) {
      try {
        await this.processDataMapping(dataMapping, groupId);
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
