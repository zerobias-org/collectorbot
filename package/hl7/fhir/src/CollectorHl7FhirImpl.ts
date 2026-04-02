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
    if (!this._jobId) this._jobId = this.getJobId();
    return this._jobId;
  }

  private get previewCount(): number | undefined {
    return this.context.previewMode ? this.context.previewCount : undefined;
  }

  private resolveResourceTypes(requested?: string[]): string[] {
    if (requested?.length) {
      return requested.filter((rt) => SUPPORTED_RESOURCE_TYPES.includes(rt as SupportedResourceType));
    }
    return [...SUPPORTED_RESOURCE_TYPES];
  }

  public async run(parameters?: Parameters): Promise<any> {
    const runStart = Date.now();

    if (!parameters?.fhirServerUrl) {
      throw new Error('fhirServerUrl parameter is required');
    }

    const { fhirServerUrl, clientId, clientSecret, tokenUrl, scopes } = parameters;
    const pageSize = parameters.pageSize ?? DEFAULT_PAGE_SIZE;
    const concurrency = parameters.concurrency ?? DEFAULT_CONCURRENCY;

    this.batchManager = new BatchManager(this.platform, this.logger, this.jobId);

    const client = new FhirClient(fhirServerUrl, { clientId, clientSecret, tokenUrl, scopes });

    const connectStart = Date.now();
    const capability = await client.getCapabilityStatement();
    this.logger.info(`Connected to ${fhirServerUrl} — FHIR ${capability.fhirVersion} (${Date.now() - connectStart}ms)`);

    const resourceTypes = this.resolveResourceTypes(parameters.resourceTypes);
    this.logger.info(`Collecting ${resourceTypes.length} resource types, pageSize=${pageSize}, concurrency=${concurrency}`);

    const errors: string[] = [];
    let totalCollected = 0;
    let completed = 0;

    const collectResourceType = async (resourceType: string): Promise<void> => {
      const mapping = RESOURCE_MAPPERS[resourceType];
      if (!mapping) {
        this.logger.warn(`Skipping ${resourceType}: no mapper`);
        return;
      }

      const tag = `[${++completed}/${resourceTypes.length}]`;
      const batch = await this.batchManager.initBatch(mapping.schemaName, `fhir-${resourceType}`);
      const typeStart = Date.now();
      let count = 0;
      let pages = 0;

      try {
        for await (const resources of client.paginateResources(resourceType, pageSize)) {
          pages++;
          const items: any[] = [];

          for (const resource of resources) {
            try {
              items.push(mapping.mapper(resource));
            } catch (error: any) {
              errors.push(`${resourceType}/${resource.id}: ${error.message}`);
            }
          }

          if (items.length > 0) {
            const { chunks, largeItems } = splitArrayBySize(items);
            for (const chunk of chunks) {
              await batch.addItems(chunk.map((item) => ({ payload: item })));
            }
            for (const item of largeItems) {
              await batch.add(item);
            }
            count += items.length;
          }

          if (this.previewCount && count >= this.previewCount) {
            this.logger.info(`${tag} ${resourceType}: preview limit reached (${count})`);
            break;
          }
        }

        const elapsed = (Date.now() - typeStart) / 1000;
        const rate = elapsed > 0 ? Math.round(count / elapsed) : count;
        this.logger.info(`${tag} ${resourceType}: ${count} items in ${elapsed.toFixed(1)}s (${rate}/s, ${pages} pages)`);
        totalCollected += count;
      } catch (error: any) {
        errors.push(`${resourceType}: ${error.message}`);
        this.logger.error(`${tag} ${resourceType} failed: ${error.message}`);
      } finally {
        await batch.end();
      }
    };

    // Bounded concurrency pool
    const executing = new Set<Promise<void>>();
    for (const resourceType of resourceTypes) {
      const p = collectResourceType(resourceType).then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= concurrency) await Promise.race(executing);
    }
    await Promise.all(executing);

    const elapsed = (Date.now() - runStart) / 1000;
    const rate = elapsed > 0 ? Math.round(totalCollected / elapsed) : totalCollected;
    this.logger.info(`Done: ${totalCollected} resources in ${elapsed.toFixed(1)}s (${rate}/s). ${this.batchManager.getSummary()}`);

    if (errors.length > 0) {
      this.logger.warn(`${errors.length} error(s):`);
      for (const message of errors) this.logger.warn(`  - ${message}`);
    }
  }
}
