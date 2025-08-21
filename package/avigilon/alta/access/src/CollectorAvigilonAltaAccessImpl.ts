import { ConnectionMetadata } from '@auditmation/hub-core';
import {
  InvalidStateError,
  UnexpectedError,
  UUID
} from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils/dist/src';
import { Parameters } from 'generated/model';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient';
import { mapGroup, mapUser } from './Mappers';

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
    user: 'Account',
    group: 'Group',
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
    className: string,
    groupId?: string
  ): Promise<Batch<T>> {
    const batch: Batch<T> = new Batch<T>(
      className,
      this.platform,
      this.logger,
      this.jobId,
      this.metadata?.tags || [],
      groupId
    );
    await batch.getId();
    return batch;
  }

  private async loadUsers(): Promise<void> {
    if (!this.orgId) {
      throw new InvalidStateError('Organization ID is not set');
    }

    const userBatch = await this.initBatchForClass(this.classes.user);

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

    const groupBatch = await this.initBatchForClass(this.classes.group);
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

  public async run(parameters?: Parameters): Promise<any> {
    await this.init();
    this.orgId = parameters?.organizationId;

    await this.loadUsers();
    await this.loadGroups();
  }
}
