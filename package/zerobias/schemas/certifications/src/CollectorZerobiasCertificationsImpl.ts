/**
 * Compliance Certifications Collector — loads the curated certification catalog that
 * ships inside this package into AuditgraphDB as ComplianceCertification objects.
 *
 * There is no external system and no Hub module: the dataset IS the package.
 * Refreshing the data means publishing a new version of this collector, which
 * is the same way schema / product / vendor content already ships.
 */

import { readFileSync } from 'node:fs';
import { UUID } from '@zerobias-org/types-core-js';
import { BatchManager, splitArrayBySize } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { LoggerEngine } from '@zerobias-org/logger';
import { BaseClient } from '../generated/BaseClient.js';
import { Parameters } from '../generated/model/index.js';

import { CertificationRecord } from './types/index.js';
import { toComplianceCertification } from './mappers.js';

const LOGGER_NAME = 'ComplianceCertificationsCollector';

// Resolved from dist/src/ at runtime and from src/ under tsx, so walk up to the
// package root either way rather than assuming one depth.
const DATA_URL = new URL('../data/certifications.json', import.meta.url);
const DATA_URL_FROM_DIST = new URL('../../data/certifications.json', import.meta.url);

/**
 * One group for the whole dataset. A run with the same groupId replaces the
 * previous run's objects wholesale — which is the intent here: the bundled file
 * is the complete set, so anything absent from it has been retired.
 */
const GROUP_ID = 'zerobias-compliance-certifications';

@injectable()
export class CollectorZerobiasCertificationsImpl extends BaseClient {
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
    return this.context.previewMode ? (this.context.previewCount || 10) : undefined;
  }

  private loadRecords(): CertificationRecord[] {
    let raw: string;
    try {
      raw = readFileSync(DATA_URL_FROM_DIST, 'utf8');
    } catch {
      raw = readFileSync(DATA_URL, 'utf8');
    }

    const records = JSON.parse(raw) as CertificationRecord[];
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('data/certifications.json is empty or not an array — refusing to run, a full-replace batch would wipe the dataset');
    }

    const seen = new Set<string>();
    for (const record of records) {
      if (!record.code) {
        throw new Error(`Record "${record.name}" has no code; code is the object id and is required`);
      }
      if (seen.has(record.code)) {
        throw new Error(`Duplicate code "${record.code}" — codes are object ids and must be unique`);
      }
      seen.add(record.code);
    }

    return records;
  }

  public async run(_parameters?: Parameters): Promise<any> {
    this.batchManager = new BatchManager(this.platform, this.logger, this.jobId);

    let records = this.loadRecords();
    this.logger.info(`Loaded ${records.length} certifications from the bundled catalog`);

    if (this.previewCount) {
      this.logger.info(`Preview mode: limiting to ${this.previewCount} of ${records.length} certifications`);
      records = records.slice(0, this.previewCount);
    }

    const batch = await this.batchManager.initBatch('ComplianceCertification', GROUP_ID);
    const certifications = records.map((record) => toComplianceCertification(record));
    const { chunks, largeItems } = splitArrayBySize(certifications);

    for (const chunk of chunks) {
      await batch.addItems(chunk.map((certification) => ({ payload: certification })));
    }
    for (const item of largeItems) {
      await batch.add(item);
    }

    await batch.end();

    this.logger.info(`Collection complete. ${this.batchManager.getSummary()}`);
  }
}
