import { CertificationRecord, ComplianceCertification } from './types/index.js';

/**
 * Schema `date` fields are generated as `Date` in TypeScript but the runtime
 * validator wants a `YYYY-MM-DD` string. The Object.assign form satisfies both
 * (see .claude/ADVANCED_MAPPING_GUIDE.md, "Date vs DateTime Handling").
 */
function toSchemaDate(value: string | null): any {
  if (!value) return undefined;
  return Object.assign(new Date(value), value);
}

function orUndefined(value: string | null): string | undefined {
  return value ?? undefined;
}

/**
 * Map one bundled record to a ComplianceCertification.
 *
 * The id IS the code. `code` is the natural key of the dataset — unique across
 * every record, stable across releases, and free of the characters a batch item
 * id rejects. Deriving it here rather than reading it from the data file is what
 * makes a contributed record safe: an id cannot be invented, duplicated, or left
 * stale when a code changes.
 */
export function toComplianceCertification(record: CertificationRecord): ComplianceCertification {
  return {
    id: record.code,
    name: record.name,
    code: record.code,
    scope: record.scope,
    issuerVendorIds: record.issuerVendorIds,
    frameworkIds: record.frameworkIds,
    standardIds: record.standardIds,
    prerequisiteCertificationIds: record.prerequisiteCertificationIds,
    qualifiesForRoleIds: record.qualifiesForRoleIds,
    supersedesCode: orUndefined(record.supersedesCode),
    proficiency: orUndefined(record.proficiency),
    ecosystemCode: orUndefined(record.ecosystemCode),
    sourceUrl: orUndefined(record.sourceUrl),
    sourceSnapshotDate: toSchemaDate(record.sourceSnapshotDate),
    status: record.status,
    submittedByUserId: orUndefined(record.submittedByUserId),
  } as ComplianceCertification;
}
