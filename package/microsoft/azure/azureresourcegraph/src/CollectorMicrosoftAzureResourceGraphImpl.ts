import type { Resource, ResourceContainer } from '@zerobias-org/module-microsoft-azure-azureresourcegraph';
import {
  AzureResourceGraph,
  AzureResourceGraphResource,
  AzureResourceGraphResourceType
} from '@zerobias-org/schema-microsoft-azure-azureresourcegraph-ts/dist/index.js';
import {
  AzureResourceGroup,
  AzureSubscription
} from '@zerobias-org/schema-microsoft-azure-ts/dist/index.js';
import { ConnectionMetadata, UUID, UnexpectedError } from '@zerobias-org/types-core-js';
import { Batch, splitArrayBySize } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { Parameters } from '../generated/model/index.js';
import {
  toResourceGraph,
  toResourceGraphResource,
  toResourceGraphResourceType,
  toResourceGroup,
  toSubscription
} from './Mappers.js';

const SUBSCRIPTION_TYPE = 'microsoft.resources/subscriptions';
const RESOURCE_GROUP_TYPE = 'microsoft.resources/subscriptions/resourcegroups';
const MANAGEMENT_GROUP_TYPE = 'microsoft.management/managementgroups';

interface AzureResourceGraphRemoteSystemInfo {
  tenantId?: string;
}

@injectable()
export class CollectorMicrosoftAzureResourceGraphImpl extends BaseClient {
  private _jobId?: UUID;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId!;
  }

  private SKIP_RESOURCE_TYPES: string[] = [];

  private connectionMetadata: ConnectionMetadata | undefined;

  private tenantId = '';

  private appId = '';

  private subscriptions?: string[];

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  private classes = {
    azureResourceGraph: AzureResourceGraph,
    azureResourceGraphResource: AzureResourceGraphResource,
    azureResourceGraphResourceType: AzureResourceGraphResourceType,
    azureSubscription: AzureSubscription,
    azureResourceGroup: AzureResourceGroup,
  };

  public async run(parameters?: Parameters): Promise<any> {
    this.subscriptions = parameters?.subscriptions?.length
      ? parameters.subscriptions.map((id) => `${id}`)
      : undefined;

    // ARM resource types are case-insensitive — normalize once for the skip check
    this.SKIP_RESOURCE_TYPES = (parameters?.skipResourceTypes || []).map(
      (resourceType) => resourceType.toLowerCase()
    );

    await this.init();
    await this.loadResourceGraph();
    await this.loadResourceContainers();
    await this.loadResources();
  }

  private async init() {
    this.logger.info('Initializing Azure Resource Graph Collector');
    try {
      this.connectionMetadata = await this.azureresourcegraph.metadata();
      this.tenantId = (this.connectionMetadata?.remoteSystemInfo as AzureResourceGraphRemoteSystemInfo)?.tenantId ?? '';
    } catch (error) {
      this.logger.error(`An error happened requesting metadata - ${error.message}`);
    }

    // remoteSystemInfo is not always surfaced by the platform. Fall back to
    // probing the first Resource Graph row — every row carries tenantId.
    if (!this.tenantId) {
      this.logger.info('Tenant missing from connection metadata; probing first resource for tenant id');
      try {
        const probe = await this.azureresourcegraph.getResourceApi().list(this.subscriptions, 1, undefined);
        this.tenantId = probe?.items?.[0]?.tenantId ? `${probe.items[0].tenantId}` : '';
      } catch (err) {
        this.logger.error(`First-resource probe failed: ${err.message}`);
      }
    }

    if (!this.tenantId) {
      throw new UnexpectedError('Tenant ID missing — connection metadata and first-resource probe both empty');
    }

    this.appId = `azure-resource-graph:${this.tenantId}`;
    this.logger.info('Initializing Azure Resource Graph Collector - done');
  }

  private async initBatchForClass<T extends Record<string, any>>(
    batchItemType: new (...args) => T,
    groupId?: string
  ): Promise<Batch<T>> {
    const batch: Batch<T> = new Batch<T>(
      batchItemType.name,
      this.platform,
      this.logger as any,
      this.jobId,
      this.connectionMetadata?.tags,
      groupId ?? `${this.tenantId}-global-azureresourcegraph`
    );
    await batch.getId();
    return batch;
  }

  private async logError(batch: Batch<Record<string, any>>, message: string, err: Error) {
    await batch.error(message, err);
    this.logger.error(message, err);
  }

  private async loadResourceGraph(): Promise<void> {
    this.logger.info('Loading Azure Resource Graph application');
    const batch = await this.initBatchForClass(this.classes.azureResourceGraph);
    try {
      const resourceGraph = toResourceGraph(this.appId, this.tenantId);
      await batch.add(resourceGraph, resourceGraph as any);
    } catch (err) {
      await this.logError(batch, 'Unable to load Azure Resource Graph application to batch', err);
    } finally {
      await batch.end();
    }
    this.logger.info('Loading Azure Resource Graph application - done');
  }

  private async loadResourceContainers(): Promise<void> {
    this.logger.info('Loading Resource Containers');

    const subscriptionBatch = await this.initBatchForClass(this.classes.azureSubscription);
    const resourceGroupBatch = await this.initBatchForClass(this.classes.azureResourceGroup);
    let managementGroupCount = 0;

    try {
      const containersPr = await this.azureresourcegraph.getResourceContainerApi()
        .list(this.subscriptions, this.previewCount ?? 1000, undefined);

      await containersPr.forEach(async (container: ResourceContainer) => {
        const containerType = container.type ? `${container.type}`.toLowerCase() : '';
        switch (containerType) {
          case SUBSCRIPTION_TYPE: {
            try {
              await subscriptionBatch.add(toSubscription(container), container as any);
            } catch (err) {
              await this.logError(subscriptionBatch, `Unable to add subscription ${container.id} to batch`, err);
            }
            break;
          }
          case RESOURCE_GROUP_TYPE: {
            try {
              await resourceGroupBatch.add(toResourceGroup(container), container as any);
            } catch (err) {
              await this.logError(resourceGroupBatch, `Unable to add resource group ${container.id} to batch`, err);
            }
            break;
          }
          case MANAGEMENT_GROUP_TYPE: {
            // The Azure suite schema has no management-group class yet — counted
            // and skipped (see PR discussion; suite-schema decision pending).
            managementGroupCount += 1;
            break;
          }
          default: {
            this.logger.warn(`Unknown resource container type: ${containerType}`);
          }
        }
      }, undefined, this.previewCount);
    } catch (err) {
      await this.logError(subscriptionBatch, 'Unable to get resource containers', err);
    } finally {
      await subscriptionBatch.end();
      await resourceGroupBatch.end();
    }

    if (managementGroupCount > 0) {
      this.logger.info(`Skipped ${managementGroupCount} management group container(s) — no schema class to populate`);
    }
    this.logger.info('Loading Resource Containers - done');
  }

  private async loadResources(): Promise<void> {
    this.logger.info('Loading Resources');

    const resourceBatch = await this.initBatchForClass(this.classes.azureResourceGraphResource);
    const resourceTypes = new Set<string>();

    const resourcesPr = await this.azureresourcegraph.getResourceApi()
      .list(this.subscriptions, this.previewCount ?? 1000, undefined)
      .catch(async (err) => {
        await this.logError(resourceBatch, 'Unable to get resources', err);
      });

    // Collect items in memory then bulk-add — per-item batch.add fired inside
    // forEach saturates the platform-sdk endpoint with concurrent calls under
    // any non-trivial inventory size (rexplorer precedent).
    const items: { payload: AzureResourceGraphResource; rawData?: Record<string, unknown> }[] = [];
    await resourcesPr?.forEach(async (resource: Resource) => {
      const resourceType = resource.type ? `${resource.type}`.toLowerCase() : '';
      if (resourceType && this.SKIP_RESOURCE_TYPES.includes(resourceType)) {
        return;
      }
      if (resourceType) {
        resourceTypes.add(`${resource.type}`);
      }
      items.push({
        payload: toResourceGraphResource(this.appId, resource),
        rawData: resource as unknown as Record<string, unknown>,
      });
    }, undefined, this.previewCount);

    if (items.length > 0) {
      // Chunk by payload size — large inventories exceed the platform-sdk JSON
      // body limit when sent as a single addItems call (rexplorer precedent).
      const { chunks, largeItems } = splitArrayBySize(items);
      for (const chunk of chunks) {
        try {
          await resourceBatch.addItems(chunk);
        } catch (e) {
          await this.logError(resourceBatch, `Unable to bulk-add azure resource items chunk (count=${chunk.length})`, e);
        }
      }
      for (const item of largeItems) {
        try {
          await resourceBatch.addItems([item]);
        } catch (e) {
          await this.logError(
            resourceBatch,
            `Unable to add oversized azure resource item: ${(item as { payload: AzureResourceGraphResource }).payload?.id}`,
            e
          );
        }
      }
    }

    await resourceBatch.end();

    await this.loadResourceTypes(resourceTypes);

    this.logger.info('Loading Resources - done');
  }

  private async loadResourceTypes(resourceTypes: Set<string>): Promise<void> {
    this.logger.info(`Loading ${resourceTypes.size} Resource Types`);
    const batch = await this.initBatchForClass(this.classes.azureResourceGraphResourceType);
    try {
      for (const resourceType of resourceTypes) {
        try {
          await batch.add(toResourceGraphResourceType(resourceType));
        } catch (err) {
          await this.logError(batch, `Unable to add resource type ${resourceType} to batch`, err);
        }
      }
    } finally {
      await batch.end();
    }
    this.logger.info('Loading Resource Types - done');
  }
}
