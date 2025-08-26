import * as s from '@auditlogic/schema-auditmation-auditmation-base-ts';
import { PrincipalType } from '@auditlogic/schema-auditmation-auditmation-base-ts';
import * as m from '@zerobias-org/module-avigilon-alta-access';

function toUserStatus(raw?: m.UserInfo.StatusEnumDef): s.AccountStatus | undefined {
  switch (raw) {
    case m.UserInfo.StatusEnum.Active:
      return s.AccountStatus.ACTIVE;
    case m.UserInfo.StatusEnum.Inactive:
      return s.AccountStatus.INACTIVE;
    case m.UserInfo.StatusEnum.Suspended:
      return s.AccountStatus.DISABLED;
    default:
      return undefined;
  }
}

export function mapUser(raw: m.UserInfo): s.Account {
  const output: s.Account = {
    id: `${raw.id}`,
    name: `${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim(),
    email: raw.email,
    identity: `${raw.email}`,
    login: `${raw.email}`,
    person: `${raw.email}`,
    status: toUserStatus(raw.status),
    app: raw.organizationId ? `${raw.organizationId}` : undefined,
    icon: raw.avatarUrl,
    principalType: PrincipalType.USER,
  };
  Object.assign(
    output,
    {
      dateCreated: raw.createdAt?.toISOString().split('T')[0],
      dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
    }
  );
  return output;
}

export function mapGroup(raw: m.GroupInfo, memberIds: string[]): s.Group {
  const output: s.Group = {
    id: `${raw.id}`,
    name: raw.name,
    description: raw.description,
    groups: raw.parentGroupId ? `${raw.parentGroupId}` : undefined,
    principalType: PrincipalType.GROUP,
    members: memberIds.map((id) => `${id}`),
  };
  Object.assign(
    output,
    {
      dateCreated: raw.createdAt?.toISOString().split('T')[0],
      dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
    }
  );
  return output;
}
