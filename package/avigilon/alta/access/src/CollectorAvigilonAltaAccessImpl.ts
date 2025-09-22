import {
  AvigilonAltaEntry,
  AvigilonAltaGroup,
  AvigilonAltaSite,
  AvigilonAltaUser,
  AvigilonAltaZone
} from '@auditlogic/schema-avigilon-alta-access-ts';
import { ConnectionMetadata } from '@auditmation/hub-core';
import {
  InvalidStateError,
  UnexpectedError,
  UUID
} from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils/dist/src';
import { Parameters } from 'generated/model';
import { injectable } from 'inversify';
import PromisePool from '@supercharge/promise-pool';
import { BaseClient } from '../generated/BaseClient';
import { mapEntry, mapGroup, mapSite, mapUser, mapZone } from './Mappers';

@injectable()
export class CollectorAvigilonAltaAccessImpl extends BaseClient {
  private metadata: ConnectionMetadata | undefined;

  private _jobId?: UUID;

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  private orgId?: string;

  get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  private classes = {
    user: AvigilonAltaUser,
    group: AvigilonAltaGroup,
    site: AvigilonAltaSite,
    zone: AvigilonAltaZone,
    entry: AvigilonAltaEntry,
  };

  private async init() {
    try {
      this.metadata = await this.access.metadata();
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

  private async identifyOrganization(): Promise<void> {
    if (this.orgId) {
      this.logger.info(`Organization ID already set to ${this.orgId}`);
      return;
    }
    this.logger.info('Identifying organization ID by token scope');
    const tokenInfo = await this.access.getAuthApi().getTokenProperties();
    if (tokenInfo.organizationId) {
      this.orgId = `${tokenInfo.organizationId}`;
      this.logger.info(`Identified organization ID: ${this.orgId}`);
    } else {
      throw new InvalidStateError('Organization ID is not set and cannot be identified from token');
    }
  }

  private async loadUsers(): Promise<void> {
    if (!this.orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }

    const userBatch = await this.initBatchForClass(this.classes.user, this.orgId);

    const usersPr = await this.access.getUserApi().list(this.orgId);
    await usersPr.forEach(async (user) => {
      const userInfo = await this.access.getUserApi().get(this.orgId!, user.id);
      await userBatch.add(mapUser(userInfo));
    }, 3, this.previewCount);
    await userBatch.end();
  }

  private async loadGroups(): Promise<void> {
    if (!this.orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }

    const groupBatch = await this.initBatchForClass(this.classes.group, this.orgId);
    const groupsPr = await this.access.getGroupApi().list(this.orgId);
    await groupsPr.forEach(async (group) => {
      const groupInfo = await this.access.getGroupApi().get(this.orgId!, group.id);
      const groupMembersPr = await this.access.getGroupApi().listUsers(this.orgId!, group.id);
      const membersIds: string[] = [];
      await groupMembersPr.forEach(async (member) => {
        membersIds.push(`${member.id}`);
      });
      await groupBatch.add(mapGroup(groupInfo, membersIds));
    }, 3, this.previewCount);
    await groupBatch.end();
  }

  private async loadSites(): Promise<void> {
    if (!this.orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }

    const siteBatch = await this.initBatchForClass(this.classes.site, this.orgId);
    const sites = await this.access.getSiteApi().list(this.orgId);
    await PromisePool.for(sites)
      .withConcurrency(3)
      .handleError(async (error, site) => {
        await siteBatch.error(`Error processing site ${site.id}`, error);
      })
      .process(async (site) => {
        await siteBatch.add(mapSite(site));
      });
    await siteBatch.end();
  }

  private async loadZones(): Promise<void> {
    if (!this.orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }

    const zoneBatch = await this.initBatchForClass(this.classes.zone, this.orgId);
    const zones = await this.access.getZoneApi().list(this.orgId);
    await PromisePool.for(zones)
      .withConcurrency(3)
      .handleError(async (error, zone) => {
        await zoneBatch.error(`Error processing zone ${zone.id}`, error);
      })
      .process(async (zone) => {
        await zoneBatch.add(mapZone(zone));
      });
    await zoneBatch.end();
  }

  private async loadEntries(): Promise<void> {
    if (!this.orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }

    const entryBatch = await this.initBatchForClass(this.classes.entry, this.orgId);
    const entries = await this.access.getEntryApi().list(this.orgId);
    await PromisePool.for(entries)
      .withConcurrency(3)
      .handleError(async (error, entry) => {
        await entryBatch.error(`Error processing entry ${entry.id}`, error);
      })
      .process(async (entry) => {
        await entryBatch.add(mapEntry(entry));
      });
    await entryBatch.end();
  }

  public async run(parameters?: Parameters): Promise<any> {
    await this.init();
    this.orgId = parameters?.organizationId;

    await this.identifyOrganization();

    await this.loadUsers();
    await this.loadGroups();
    await this.loadSites();
    await this.loadZones();
    await this.loadEntries();
  }
}
