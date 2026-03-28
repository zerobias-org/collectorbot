import { UUID } from '@zerobias-org/types-core-js';
import { BatchManager, splitArrayBySize } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { Parameters } from '../generated/model/index.js';
import { LoggerEngine } from '@zerobias-org/logger';
import { FhirClient } from './handlers/FhirClient.js';
import { RESOURCE_MAPPERS } from './mappers.js';
import { SUPPORTED_RESOURCE_TYPES, type SupportedResourceType } from './types/index.js';

const LOGGER_NAME = 'Hl7FhirCollector';
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_PAGE_SIZE = 1000;

@injectable()
export class CollectorHl7FhirImpl extends BaseClient {
  override logger: LoggerEngine = LoggerEngine.root().get(LOGGER_NAME);

  private batchManager!: BatchManager;

  private _jobId?: UUID;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  private get previewCount(): number | undefined {
    return this.context.previewMode ? this.context.previewCount : undefined;
  }

  public async run(parameters?: Parameters): Promise<any> {
    const runStart = Date.now();

    if (!parameters?.fhirServerUrl) {
      throw new Error('fhirServerUrl parameter is required');
    }

    const fhirServerUrl = parameters.fhirServerUrl;
    const pageSize = parameters.pageSize ?? DEFAULT_PAGE_SIZE;
    const concurrency = parameters.concurrency ?? DEFAULT_CONCURRENCY;

    this.batchManager = new BatchManager(this.platform, this.logger, this.jobId);

    const client = new FhirClient(fhirServerUrl, {
      clientId: parameters.clientId,
      clientSecret: parameters.clientSecret,
      tokenUrl: parameters.tokenUrl,
      scopes: parameters.scopes,
    });

    // Verify connectivity
    this.logger.info(`Connecting to FHIR server: ${fhirServerUrl}`);
    const connectStart = Date.now();
    const capability = await client.getCapabilityStatement();
    this.logger.info(`Connected — FHIR version: ${capability.fhirVersion} (${Date.now() - connectStart}ms)`);

    // Determine resource types to collect
    let resourceTypes: string[];
    if (parameters.resourceTypes?.length) {
      resourceTypes = parameters.resourceTypes.filter(
        (rt) => SUPPORTED_RESOURCE_TYPES.includes(rt as SupportedResourceType),
      );
    } else {
      resourceTypes = [...SUPPORTED_RESOURCE_TYPES];
    }

    this.logger.info(`Collecting ${resourceTypes.length} resource types, pageSize=${pageSize}, concurrency=${concurrency}`);

    const errors: string[] = [];
    let totalCollected = 0;
    let completed = 0;

    const processResourceType = async (resourceType: string): Promise<void> => {
      const mapping = RESOURCE_MAPPERS[resourceType];
      if (!mapping) {
        this.logger.warn(`No mapper for resource type: ${resourceType}`);
        return;
      }

      const progress = `[${++completed}/${resourceTypes.length}]`;
      const typeStart = Date.now();
      this.logger.info(`${progress} Starting ${resourceType}...`);

      const batch = await this.batchManager.initBatch(mapping.className, `fhir-${resourceType}`);

      try {
        let count = 0;
        let pageNum = 0;

        for await (const resources of client.paginateResources(resourceType, pageSize)) {
          pageNum++;
          const pageStart = Date.now();

          const items: any[] = [];
          for (const resource of resources) {
            try {
              items.push(mapping.mapper(resource));
            } catch (err: any) {
              errors.push(`Failed to map ${resourceType}/${resource.id}: ${err.message}`);
            }
          }
          const mapMs = Date.now() - pageStart;

          if (items.length > 0) {
            const batchStart = Date.now();
            const { chunks, largeItems } = splitArrayBySize(items);
            for (const chunk of chunks) {
              await batch.addItems(chunk.map((item) => ({ payload: item })));
            }
            for (const item of largeItems) {
              await batch.add(item);
            }
            const batchMs = Date.now() - batchStart;
            count += items.length;

            this.logger.debug(`${progress} ${resourceType} page ${pageNum}: ${items.length} items (fetch+map=${mapMs}ms, batch=${batchMs}ms, total=${count})`);
          }

          if (this.previewCount && count >= this.previewCount) {
            this.logger.info(`${progress} Preview mode: stopping ${resourceType} at ${count} items`);
            break;
          }
        }

        const typeMs = Date.now() - typeStart;
        const rate = count > 0 ? Math.round(count / (typeMs / 1000)) : 0;
        this.logger.info(`${progress} Collected ${count} ${resourceType} in ${(typeMs / 1000).toFixed(1)}s (${rate} items/s, ${pageNum} pages)`);
        totalCollected += count;
      } catch (err: any) {
        errors.push(`Failed to collect ${resourceType}: ${err.message}`);
        this.logger.error(`${progress} Error collecting ${resourceType}: ${err.message}`, err);
      } finally {
        await batch.end();
      }
    };

    // Process resource types with bounded concurrency
    const executing = new Set<Promise<void>>();
    for (const resourceType of resourceTypes) {
      const p = processResourceType(resourceType).then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    const totalMs = Date.now() - runStart;
    const totalRate = totalCollected > 0 ? Math.round(totalCollected / (totalMs / 1000)) : 0;
    this.logger.info(`Collection complete in ${(totalMs / 1000).toFixed(1)}s: ${totalCollected} resources (${totalRate} items/s). ${this.batchManager.getSummary()}`);
    if (errors.length > 0) {
      this.logger.warn(`${errors.length} errors during collection:`);
      for (const err of errors) {
        this.logger.warn(`  - ${err}`);
      }
    }
  }
}
