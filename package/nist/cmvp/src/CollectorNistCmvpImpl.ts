import { UUID } from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { PromisePool } from '@supercharge/promise-pool';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { CmvpCertificate } from './SchemaTypes.js';
import { toCmvpCertificate } from './Mappers.js';

/**
 * One global, public registry — not scoped per tenant/account/region, so a
 * single stable groupId lets the platform's Batch reconciliation handle
 * adds/updates/retirements with no custom diffing (see CMVP_Connector_PLAN.md).
 */
const GROUP_ID = 'nist-cmvp';

/**
 * Fetches full detail for every certificate on each run — listCertificates()
 * only returns summaries. Concurrency 5 measured against the live site
 * (~1147 certs in ~2 minutes); see CMVP_Connector_STATUS.md for the timing
 * data behind this choice.
 */
const DETAIL_FETCH_CONCURRENCY = 5;

@injectable()
export class CollectorNistCmvpImpl extends BaseClient {
  private _jobId?: UUID;

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  private async initBatchForClass<T extends Record<string, any>>(className: string, groupId: string): Promise<Batch<T>> {
    const batch = new Batch<T>(className, this.platform, this.logger, this.jobId, [], groupId);
    await batch.getId();
    return batch;
  }

  private async loadCertificates(): Promise<void> {
    const certApi = this.cmvp.getCertificateApi();
    const batch = await this.initBatchForClass<CmvpCertificate>('CmvpCertificate', GROUP_ID);

    const summaries = await certApi.list(1, 5000);
    const toFetch = summaries.slice(0, this.previewCount);

    await PromisePool.for(toFetch)
      .withConcurrency(DETAIL_FETCH_CONCURRENCY)
      .handleError(async (error, summary) => {
        await batch.error(`Error fetching certificate ${summary.certificateNumber}: ${error.message}`, summary);
      })
      .process(async (summary) => {
        const cert = await certApi.get(summary.certificateNumber);
        await batch.add(toCmvpCertificate(cert));
      });

    await batch.end();
  }

  public async run(): Promise<void> {
    await this.loadCertificates();
  }
}
