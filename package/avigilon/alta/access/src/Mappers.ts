import * as s from '@auditlogic/schema-avigilon-alta-access-ts';
import { AccessCredential_type, PhysicalEntry_type, PrincipalType } from '@auditlogic/schema-avigilon-alta-access-ts';
import { GeoCountry, GeoCountryDef, PhoneNumber } from '@auditmation/types-core-js';
import * as m from '@zerobias-org/module-avigilon-alta-access';

function toUserStatus(raw?: m.User.StatusEnumDef): s.AccountStatus | undefined {
  switch (raw) {
    case m.User.StatusEnum.A:
      return s.AccountStatus.ACTIVE;
    case m.User.StatusEnum.I:
      return s.AccountStatus.INACTIVE;
    case m.User.StatusEnum.S:
      return s.AccountStatus.DISABLED;
    default:
      return undefined;
  }
}

export function mapUser(raw: m.User, mfaEnabled?: boolean): s.Account {
  // Build description from title and department
  const descriptionParts = [raw.title, raw.department].filter(Boolean);
  const description = descriptionParts.length > 0 ? descriptionParts.join(' - ') : undefined;

  const output: s.Account = {
    id: `${raw.id}`,
    name: `${raw.identity?.firstName ?? ''} ${raw.identity?.lastName ?? ''}`.trim() || `User ${raw.id}`,
    email: raw.identity?.email,
    identity: `${raw.identity?.email}`,
    login: `${raw.identity?.email}`,
    person: `${raw.identity?.email}`,
    status: toUserStatus(raw.status),
    principalType: PrincipalType.USER,
    description,
    mfaEnabled,
    aliases: raw.externalId,
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

export function mapGroup(raw: m.Group, memberIds: string[]): s.Group {
  const output: s.Group = {
    id: `${raw.id}`,
    name: raw.name || `Group ${raw.id}`,
    description: raw.description,
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

export function mapSite(raw: m.Site): s.AvigilonAltaSite {
  let country: GeoCountryDef | undefined;
  try {
    country = raw.country ? GeoCountry.from(raw.country) : undefined;
  } catch {
    // ignore invalid country codes
  }

  let phoneNo: PhoneNumber | undefined;
  try {
    phoneNo = new PhoneNumber(raw.phone || '');
  } catch {
    // ignore invalid phone numbers
  }

  const output: s.AvigilonAltaSite = {
    id: `${raw.id}`,
    name: raw.name || `Site ${raw.id}`,
    locations: [{
      address: {
        addressLine: [`${raw.address}`, `${raw.address2}`].filter(Boolean).join(', '),
        locality: raw.city,
        postalCode: raw.zip,
        country,
      },
      phoneNumber: phoneNo,
    }],
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

export function mapZone(raw: m.Zone): s.AvigilonAltaZone {
  const output: s.AvigilonAltaZone = {
    id: `${raw.id}`,
    name: raw.name || `Zone ${raw.id}`,
    description: raw.description,
    site: `${raw.site?.id}`,
  };

  Object.assign(output, {
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });

  return output;
}

export function mapEntry(raw: m.Entry): s.AvigilonAltaEntry {
  const state = s.PhysicalEntry_status[raw.entryState?.name.toUpperCase() || 'UNKNOWN'];

  // Derive entryType from boolean flags
  const entryType = (raw.isIntercomEntry || raw.isReaderless) ? PhysicalEntry_type.DOOR : undefined;

  // Build note from existing notes + muster point flag
  const noteParts: string[] = [];
  if (raw.notes) {
    noteParts.push(raw.notes);
  }
  if (raw.isMusterPoint) {
    noteParts.push('Muster Point');
  }
  const note = noteParts.length > 0 ? noteParts.join(' - ') : undefined;

  const output: s.AvigilonAltaEntry = {
    id: `${raw.id}`,
    name: raw.name || `Entry ${raw.id}`,
    note,
    zone: raw.zone?.id ? `${raw.zone.id}` : undefined,
    aliases: raw.externalUuid,
    state,
    entryType,
  };

  Object.assign(output, {
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });
  return output;
}

export function mapSchedule(raw: m.Schedule): s.AvigilonAltaSchedule {
  // Build note from scheduleType + isActive
  const noteParts: string[] = [];
  if (raw.scheduleType) {
    const typeLabel = raw.scheduleType.name || raw.scheduleType.code || `Type ${raw.scheduleType.id}`;
    noteParts.push(`Schedule Type: ${typeLabel}`);
  }
  if (raw.isActive !== undefined) {
    noteParts.push(raw.isActive ? 'Active' : 'Inactive');
  }
  const note = noteParts.length > 0 ? noteParts.join(' - ') : undefined;

  const output: s.AvigilonAltaSchedule = {
    id: `${raw.id}`,
    name: raw.name || `Schedule ${raw.id}`,
    description: raw.description,
    note,
  };

  Object.assign(output, {
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });

  return output;
}

export function mapCredential(raw: m.OrgCredential): s.AvigilonAltaCredential {
  // Map credential type
  let credentialType: AccessCredential_type | undefined;
  if (raw.credentialType) {
    const typeName = raw.credentialType.name?.toUpperCase() || raw.credentialType.modelName?.toUpperCase();
    if (typeName) {
      if (typeName.includes('CARD')) credentialType = AccessCredential_type.CARD;
      else if (typeName.includes('MOBILE')) credentialType = AccessCredential_type.MOBILE;
      else if (typeName.includes('PIN')) credentialType = AccessCredential_type.PIN;
      else if (typeName.includes('FOB')) credentialType = AccessCredential_type.FOB;
      else if (typeName.includes('BIOMETRIC')) credentialType = AccessCredential_type.BIOMETRIC;
      else if (typeName.includes('QR')) credentialType = AccessCredential_type.QR_CODE;
      else if (typeName.includes('NFC')) credentialType = AccessCredential_type.NFC;
      else if (typeName.includes('BLUETOOTH')) credentialType = AccessCredential_type.BLUETOOTH;
      else credentialType = AccessCredential_type.OTHER;
    }
  }

  // Build name from credential type and card/mobile info
  let name = `Credential ${raw.id}`;
  if (raw.card?.facilityCode && raw.card?.number) {
    name = `Card ${raw.card.facilityCode}-${raw.card.number}`;
  } else if (raw.mobile?.name) {
    name = `Mobile ${raw.mobile.name}`;
  }

  const output: s.AvigilonAltaCredential = {
    id: `${raw.id}`,
    name,
    credentialType,
    principal: raw.userId,
  };

  Object.assign(output, {
    validFrom: raw.startDate?.toISOString().split('T')[0],
    validUntil: raw.endDate?.toISOString().split('T')[0],
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });

  return output;
}

export function mapRole(raw: m.RoleInfo, assigneeIds: string[]): s.AvigilonAltaRole {
  // Build note from flags
  const noteParts: string[] = [];
  if (raw.isSiteSpecific) {
    noteParts.push('Site-Specific');
  }
  if (raw.isMfaRequired) {
    noteParts.push('MFA Required');
  }
  if (raw.isEditable === false) {
    noteParts.push('System Role');
  }
  const note = noteParts.length > 0 ? noteParts.join(' - ') : undefined;

  const output: s.AvigilonAltaRole = {
    id: `${raw.id}`,
    name: raw.name || `Role ${raw.id}`,
    description: raw.description,
    note,
    isBuiltIn: raw.isEditable === false,
    assignees: assigneeIds,
    sites: raw.sites?.map((site) => `${site.id}`),
  };

  Object.assign(output, {
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });

  return output;
}

export function mapAccessRule(
  principalId: string,
  principalType: 'user' | 'group',
  resources: { entries?: string[] | Set<string>; zones?: string[] | Set<string>; sites?: string[] | Set<string> },
  schedules?: string[] | Set<string>,
  name?: string
): s.AvigilonAltaAccessRule {
  // Convert Sets to Arrays and combine
  const resourceIds = [
    ...(resources.entries ? Array.from(resources.entries) : []),
    ...(resources.zones ? Array.from(resources.zones) : []),
    ...(resources.sites ? Array.from(resources.sites) : []),
  ];

  // Dedupe and sort to prevent false change detection
  const uniqueSortedResources = Array.from(new Set(resourceIds)).sort();
  const uniqueSortedSchedules = schedules
    ? Array.from(schedules).sort()
    : undefined;

  const ruleName = name || `${principalType === 'user' ? 'User' : 'Group'} ${principalId} Access Rule`;

  const output: s.AvigilonAltaAccessRule = {
    id: `${principalId}-${principalType}-access`,
    name: ruleName,
    principals: [principalId],
    resources: uniqueSortedResources,
    schedules: uniqueSortedSchedules,
  };

  return output;
}
