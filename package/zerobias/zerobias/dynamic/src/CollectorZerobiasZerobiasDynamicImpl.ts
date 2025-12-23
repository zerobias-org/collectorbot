import { ConnectionMetadata } from '@auditmation/hub-core';
import { UnexpectedError, UUID } from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient';
import { OperationConfig } from '../generated/model/OperationConfig';
import { Parameters } from '../generated/model/Parameters';
import { toMultipleElements, toSingleElement } from './Mappers';

@injectable()
export class CollectorZerobiasZerobiasDynamicImpl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;

  private _jobId?: UUID;

  private _parameters?: Parameters;

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

  get parameters(): Parameters {
    if (!this._parameters) {
      throw new UnexpectedError('No Parameters were provided');
    }
    return this._parameters;
  }

  set parameters(parameters: Parameters) {
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

  private async processMultipleElementOperation(
    operation: OperationConfig,
    groupId: string
  ): Promise<void> {
    const opType = (operation.operationType as any).value || operation.operationType;
    this.logger.info(`Processing operation ${opType} for class ${operation.className}`);

    const batch = await this.initBatchForClass(operation.className, groupId);
    const params: any = operation.operationParameters || {};

    const objectsApi = this.dataproducer.getObjectsApi();
    const collectionsApi = this.dataproducer.getCollectionsApi();
    let results;

    // Route to the correct operation based on operationType
    switch (opType) {
      case 'getChildren':
        results = await objectsApi.getChildren(
          String(params.objectId),
          Number(params.pageNumber) || 1,
          Number(params.pageSize) || 1000,
          params.sortBy,
          params.sortDir
        );
        break;

      case 'objectSearch':
        results = await objectsApi.objectSearch(
          String(params.objectId),
          Number(params.pageNumber) || 1,
          Number(params.pageSize) || 1000,
          params.sortBy,
          params.sortDir
        );
        break;

      case 'getCollectionElements':
        results = await collectionsApi.getCollectionElements(
          String(params.objectId),
          Number(params.pageNumber) || 1,
          Number(params.pageSize) || 1000,
          params.sortBy,
          params.sortDir
        );
        break;

      case 'searchCollectionElements':
        results = await collectionsApi.searchCollectionElements(
          String(params.objectId),
          Number(params.pageNumber) || 1,
          Number(params.pageSize) || 1000,
          params.filter
        );
        break;

      default:
        throw new Error(`Unknown operation type: ${opType}`);
    }

    // Process results
    await results.forEach(async (item: any) => {
      try {
        const mapped = toMultipleElements(item);
        await batch.add(mapped, item);
      } catch (err) {
        await batch.error(
          `Failed to process item: ${(err as Error).message}`,
          item
        );
      }
    }, undefined, this.previewCount);

    await batch.end();
    this.logger.info(`Completed operation ${opType}`);
  }

  private async processSingleElementOperation(
    operation: OperationConfig,
    groupId: string
  ): Promise<void> {
    const opType = (operation.operationType as any).value || operation.operationType;
    this.logger.info(`Processing operation ${opType} for class ${operation.className}`);

    const batch = await this.initBatchForClass(operation.className, groupId);
    const params: any = operation.operationParameters || {};

    const objectsApi = this.dataproducer.getObjectsApi();
    const collectionsApi = this.dataproducer.getCollectionsApi();
    let result;

    // Route to the correct operation based on operationType
    switch (opType) {
      case 'getRootObject':
        result = await objectsApi.getRootObject();
        break;

      case 'getObject':
        result = await objectsApi.getObject(String(params.objectId));
        break;

      case 'getCollectionElement':
        result = await collectionsApi.getCollectionElement(
          String(params.objectId),
          String(params.elementKey)
        );
        break;

      default:
        throw new Error(`Unknown operation type: ${opType}`);
    }

    // Process single result
    try {
      const mapped = toSingleElement(result);
      await batch.add(mapped, result);
    } catch (err) {
      await batch.error(
        `Failed to process result: ${(err as Error).message}`,
        result
      );
    }

    await batch.end();
    this.logger.info(`Completed operation ${opType}`);
  }

  public async run(): Promise<void> {
    await this.init();

    const { operations } = this.parameters;

    if (!operations || operations.length === 0) {
      this.logger.warn('No operations configured');
      return;
    }

    this.logger.info(`Processing ${operations.length} operation(s)`);

    // Use pipeline ID for groupId as per user requirements
    const pipelineId = this.context.pipelineId || 'default';
    const groupId = `${pipelineId}`;

    // Multiple element operations
    const multipleElementOps = ['getChildren', 'objectSearch', 'getCollectionElements', 'searchCollectionElements'];

    // Single element operations
    const singleElementOps = ['getRootObject', 'getObject', 'getCollectionElement'];

    for (const operation of operations) {
      const opValue = (operation.operationType as any).value || operation.operationType;

      if (multipleElementOps.includes(opValue)) {
        await this.processMultipleElementOperation(operation, groupId);
      } else if (singleElementOps.includes(opValue)) {
        await this.processSingleElementOperation(operation, groupId);
      } else {
        this.logger.error(`Unknown operation type: ${opValue}`);
      }
    }

    this.logger.info('All operations completed');
  }
}
