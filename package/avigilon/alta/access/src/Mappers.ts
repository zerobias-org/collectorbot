import * as s from '@auditlogic/schema-avigilon-alta-access-ts';
import { PrincipalType } from '@auditlogic/schema-avigilon-alta-access-ts';
import { GeoCountry, GeoCountryDef, PhoneNumber } from '@auditmation/types-core-js';
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

export function mapUser(raw: m.User): s.Account {
  const output: s.Account = {
    id: `${raw.id}`,
    name: `${raw.identity?.firstName ?? ''} ${raw.identity?.lastName ?? ''}`.trim() || `User ${raw.id}`,
    email: raw.identity?.email,
    identity: `${raw.identity?.email}`,
    login: `${raw.identity?.email}`,
    person: `${raw.identity?.email}`,
    status: toUserStatus(raw.status),
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
    country = GeoCountry.from('{raw.country}');
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

export function mapEntry(raw: m.EntryDetails): s.AvigilonAltaEntry {
  const state = s.PhysicalEntry_status[raw.entryState?.name.toUpperCase() || 'UNKNOWN'];
  const output: s.AvigilonAltaEntry = {
    id: `${raw.id}`,
    name: raw.name || `Entry ${raw.id}`,
    note: raw.notes,
    zone: raw.zone?.id ? `${raw.zone.id}` : undefined,
    aliases: raw.externalUuid,
    state,
  };

  Object.assign(output, {
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });
  return output;
}
