import { StellarCyberFinding } from '@zerobias-org/schema-stellarcyber-stellarcyber-ts/dist/index.js';
import { UnexpectedError, UUID } from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import type { Case, CaseAlert } from '@zerobias-org/module-stellarcyber-stellarcyber';
import { Parameters } from '../generated/model/index.js';
import { BaseClient } from '../generated/BaseClient.js';
import { toStellarCyberFinding } from './Mappers.js';

// Stable groupId — each run refreshes the full StellarCyberFinding set for the connection.
const FINDINGS_GROUP = 'stellarcyber-findings';

@injectable()
export class CollectorStellarcyberStellarcyberImpl extends BaseClient {
  private metadata: any;

  private _jobId?: UUID;

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  private async init(): Promise<void> {
    try {
      this.metadata = await this.stellarCyber.metadata();
    } catch (err) {
      this.logger.error(`Unable to get connection metadata: ${err.message}`, err);
      throw new UnexpectedError('Unable to get metadata', err);
    }
  }

  private async initBatchForClass<T extends Record<string, any>>(
    batchItemType: new (...args) => T,
    groupId?: string
  ): Promise<Batch<T>> {
    const batch: Batch<T> = new Batch<T>(
      batchItemType.name,
      this.platform,
      this.logger,
      this.jobId,
      this.metadata?.tags,
      groupId
    );
    await batch.getId();
    return batch;
  }

  private async leadAlert(caseId: string): Promise<CaseAlert | undefined> {
    let lead: CaseAlert | undefined;
    try {
      const alertsPr = await this.stellarCyber.getCaseApi().listAlerts(caseId);
      // first alert carries the representative resource / threat detail
      await alertsPr.forEach(async (a: CaseAlert) => {
        if (!lead) {
          lead = a;
        }
      }, 1, 1);
    } catch (err) {
      this.logger.warn(`Could not retrieve alerts for case ${caseId}: ${err.message}`);
    }
    return lead;
  }

  private async loadFindings(status?: string): Promise<void> {
    const findingBatch = await this.initBatchForClass(StellarCyberFinding, FINDINGS_GROUP);

    const casesPr = await this.stellarCyber.getCaseApi().list(status);
    await casesPr.forEach(async (sc: Case) => {
      const alert = await this.leadAlert(`${sc.id}`);
      await findingBatch.add(toStellarCyberFinding(sc, alert));
    }, 3, this.previewCount);

    await findingBatch.end();
  }

  public async run(parameters?: Parameters): Promise<any> {
    await this.init();
    await this.loadFindings(parameters?.status);
  }
}
