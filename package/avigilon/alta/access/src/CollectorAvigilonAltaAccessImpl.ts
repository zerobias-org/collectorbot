import {
  AvigilonAltaAccessRule,
  AvigilonAltaEntry,
  AvigilonAltaGroup,
  AvigilonAltaSchedule,
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
import { Entry, Group, Schedule, User } from '@zerobias-org/module-avigilon-alta-access';
import { BaseClient } from '../generated/BaseClient';
import { mapAccessRule, mapEntry, mapGroup, mapSchedule, mapSite, mapUser, mapZone } from './Mappers';

@injectable()
export class CollectorAvigilonAltaAccessImpl extends BaseClient {
  private metadata: ConnectionMetadata | undefined;

  private _jobId?: UUID;

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  private _orgId?: string;

  private users: User[] = [];

  private groups: Group[] = [];

  private entries: Entry[] = [];

  // Map of entryId -> userId -> scheduleIds[]
  private entryUserScheduleMap: Map<string, Map<string, string[]>> = new Map();

  get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  get orgId(): string {
    if (!this._orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }
    return this._orgId;
  }

  set orgId(value: string | undefined) {
    this._orgId = value;
  }

  private classes = {
    user: AvigilonAltaUser,
    group: AvigilonAltaGroup,
    site: AvigilonAltaSite,
    zone: AvigilonAltaZone,
    entry: AvigilonAltaEntry,
    schedule: AvigilonAltaSchedule,
    accessRule: AvigilonAltaAccessRule,
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
    if (this._orgId) {
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
    const userBatch = await this.initBatchForClass(this.classes.user, this.orgId);

    const usersPr = await this.access.getUserApi().list(this.orgId);
    await usersPr.forEach(async (user) => {
      this.users.push(user);
      await userBatch.add(mapUser(user), user);
    }, 3, this.previewCount);
    await userBatch.end();
  }

  private async loadGroups(): Promise<void> {
    const groupBatch = await this.initBatchForClass(this.classes.group, this.orgId);
    const groupsPr = await this.access.getGroupApi().list(this.orgId);
    await groupsPr.forEach(async (group) => {
      this.groups.push(group);
      const groupMembersPr = await this.access.getGroupApi().listUsers(this.orgId, group.id);
      const membersIds: string[] = [];
      await groupMembersPr.forEach(async (member) => {
        membersIds.push(`${member.id}`);
      });
      await groupBatch.add(mapGroup(group, membersIds), group);
    }, 3, this.previewCount);
    await groupBatch.end();
  }

  private async loadSites(): Promise<void> {
    const siteBatch = await this.initBatchForClass(this.classes.site, this.orgId);
    const sites = await this.access.getSiteApi().list(this.orgId);
    await PromisePool.for(sites)
      .withConcurrency(3)
      .handleError(async (error, site) => {
        await siteBatch.error(`Error processing site ${site.id}`, error);
      })
      .process(async (site) => {
        await siteBatch.add(mapSite(site), site);
      });
    await siteBatch.end();
  }

  private async loadZones(): Promise<void> {
    const zoneBatch = await this.initBatchForClass(this.classes.zone, this.orgId);
    const zones = await this.access.getZoneApi().list(this.orgId);
    await PromisePool.for(zones)
      .withConcurrency(3)
      .handleError(async (error, zone) => {
        await zoneBatch.error(`Error processing zone ${zone.id}`, error);
      })
      .process(async (zone) => {
        await zoneBatch.add(mapZone(zone), zone);
      });
    await zoneBatch.end();
  }

  private async loadEntries(): Promise<void> {
    const entryBatch = await this.initBatchForClass(this.classes.entry, this.orgId);
    const entries = await this.access.getEntryApi().list(this.orgId);
    await PromisePool.for(entries)
      .withConcurrency(3)
      .handleError(async (error, entry) => {
        await entryBatch.error(`Error processing entry ${entry.id}`, error);
      })
      .process(async (entry) => {
        this.entries.push(entry);
        await entryBatch.add(mapEntry(entry), entry);
      });
    await entryBatch.end();
  }

  private async loadEntrySchedules(): Promise<void> {
    this.logger.info(`Pre-fetching entry schedules for ${this.entries.length} entries`);

    // First, load all organization schedules
    const scheduleBatch = await this.initBatchForClass(this.classes.schedule, this.orgId);
    const schedulesPr = await this.access.getScheduleApi().listSchedules(this.orgId);
    const scheduleMap = new Map<string, Schedule>();

    await schedulesPr.forEach(async (schedule) => {
      scheduleMap.set(`${schedule.id}`, schedule);
      await scheduleBatch.add(mapSchedule(schedule), schedule);
    }, 3, this.previewCount);

    await scheduleBatch.end();

    // Now build the entry-user-schedule mapping
    await PromisePool.for(this.entries)
      .withConcurrency(3)
      .handleError(async (error, entry) => {
        this.logger.warn(`Error fetching schedules for entry ${entry.id}: ${error.message}`);
      })
      .process(async (entry) => {
        try {
          const userSchedulesPr = await this.access.getEntryApi().listUserSchedules(this.orgId, entry.id);
          const userScheduleMap = new Map<string, string[]>();

          await userSchedulesPr.forEach(async (entryUserSchedule) => {
            if (entryUserSchedule.user?.id && entryUserSchedule.schedules) {
              const scheduleIds = entryUserSchedule.schedules
                .map((s) => s.id)
                .filter((id): id is string => id !== undefined);

              if (scheduleIds.length > 0) {
                userScheduleMap.set(`${entryUserSchedule.user.id}`, scheduleIds);
              }
            }
          });

          if (userScheduleMap.size > 0) {
            this.entryUserScheduleMap.set(`${entry.id}`, userScheduleMap);
          }
        } catch (error) {
          this.logger.warn(`Could not retrieve schedules for entry ${entry.id}: ${error.message}`);
        }
      });

    this.logger.info(`Loaded ${scheduleMap.size} schedules and mappings for ${this.entryUserScheduleMap.size} entries`);
  }

  private async loadAccessRules(): Promise<void> {
    if (this.users.length === 0 && this.groups.length === 0) {
      this.logger.warn('No users or groups to process access rules for');
      return;
    }

    try {
      const accessRuleBatch = await this.initBatchForClass(this.classes.accessRule, this.orgId);

      // Respect preview mode for groups
      const groupsToProcess = this.groups.slice(0, this.previewCount);

      // Process groups and their access rules using cached list
      await PromisePool.for(groupsToProcess)
        .withConcurrency(3)
        .handleError(async (error, group) => {
          await accessRuleBatch.error(`Error processing access rules for group ${group.id}`, error);
        })
        .process(async (group) => {
        // Get zones and entries for the group
          const zonesPr = await this.access.getGroupApi().listZones(this.orgId, group.id);
          const entriesPr = await this.access.getGroupApi().listEntries(this.orgId, group.id);

          const zoneIds = new Set<string>();
          const entryIds = new Set<string>();

          await zonesPr.forEach(async (zone) => {
            zoneIds.add(`${zone.id}`);
          });
          await entriesPr.forEach(async (entry) => {
            entryIds.add(`${entry.id}`);
          });

          // Only create access rule if there are resources
          if (zoneIds.size > 0 || entryIds.size > 0) {
            const accessRule = mapAccessRule(
              `${group.id}`,
              'group',
              { zones: zoneIds, entries: entryIds },
              undefined,
              `Group ${group.name} Access`
            );
            await accessRuleBatch.add(accessRule);
          }
        });

      // Respect preview mode for users
      const usersToProcess = this.users.slice(0, this.previewCount);

      // Process users and their access rules using cached list
      await PromisePool.for(usersToProcess)
        .withConcurrency(3)
        .handleError(async (error, user) => {
          await accessRuleBatch.error(`Error processing access rules for user ${user.id}`, error);
        })
        .process(async (user) => {
          // Get zones, entries, and sites for the user
          const zonesPr = await this.access.getUserApi().listZones(this.orgId, user.id);
          const entriesPr = await this.access.getUserApi().listEntries(this.orgId, user.id);
          const sitesPr = await this.access.getUserApi().listSites(this.orgId, user.id);

          const zoneIds = new Set<string>();
          const entryIds = new Set<string>();
          const siteIds = new Set<string>();
          const scheduleIds = new Set<string>();

          await zonesPr.forEach(async (zone) => {
            zoneIds.add(`${zone.id}`);
          });

          // For entries, collect entry IDs and look up schedules from cache
          await entriesPr.forEach(async (entry) => {
            entryIds.add(`${entry.id}`);

            // Look up schedules from pre-fetched cache
            const entrySchedules = this.entryUserScheduleMap.get(`${entry.id}`);
            if (entrySchedules) {
              const userSchedules = entrySchedules.get(`${user.id}`);
              if (userSchedules) {
                userSchedules.forEach((scheduleId) => scheduleIds.add(scheduleId));
              }
            }
          });

          await sitesPr.forEach(async (site) => {
            siteIds.add(`${site.id}`);
          });

          // Only create access rule if there are resources
          if (zoneIds.size > 0 || entryIds.size > 0 || siteIds.size > 0) {
            const userName = `${user.identity?.firstName || ''} ${user.identity?.lastName || ''}`.trim() || `User ${user.id}`;
            const accessRule = mapAccessRule(
              `${user.id}`,
              'user',
              { zones: zoneIds, entries: entryIds, sites: siteIds },
              scheduleIds,
              `${userName} Access`
            );
            await accessRuleBatch.add(accessRule);
          }
        });

      await accessRuleBatch.end();
    } finally {
      // Release memory after processing
      this.users = [];
      this.groups = [];
      this.entries = [];
      this.entryUserScheduleMap.clear();
    }
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
    await this.loadEntrySchedules();
    await this.loadAccessRules();
  }
}
