/**
 * CI gate for `data/qualifications.json` — run with `npm run validate:data`.
 *
 * The data file is the contribution surface for this package: a third party
 * forks, edits it, and opens a PR. Each check here exists because it is a
 * mistake a well-meaning contributor makes and a reviewer cannot see.
 */

import { readFileSync } from 'node:fs';

const DATA = new URL('../data/qualifications.json', import.meta.url);
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const SCOPES = new Set(['individual', 'organizational']);
const QUALIFICATION_TYPES = new Set(['certification', 'accreditation', 'registration', 'authorization']);
const STATUSES = new Set(['curated', 'submitted', 'rejected']);
const UUID_LISTS = ['issuerVendorIds', 'frameworkIds', 'standardIds', 'qualifiesForRoleIds'];
// Characters a batch item id rejects. `code` becomes the object id.
const INVALID_ID_CHARS = /[\s,{}[\]()]/;

const errors: string[] = [];
const records = JSON.parse(readFileSync(DATA, 'utf8'));

if (!Array.isArray(records) || records.length === 0) {
  console.error('FAIL: data/qualifications.json must be a non-empty array');
  process.exit(1);
}

const codes = new Set<string>(records.map((r) => r.code).filter(Boolean));
const seen = new Set<string>();

for (const [index, record] of records.entries()) {
  const where = `record ${index} (${record.code ?? record.name ?? 'unnamed'})`;

  // An id in the file is always wrong: ids are derived from `code` at collect
  // time. A supplied one is either invented or a duplicate, and a duplicate
  // silently turns the upsert into an insert.
  if ('id' in record) errors.push(`${where}: must not supply an "id" — it is derived from "code"`);

  if (!record.code) errors.push(`${where}: "code" is required`);
  else if (INVALID_ID_CHARS.test(record.code)) errors.push(`${where}: "code" contains a character an object id rejects`);
  else if (seen.has(record.code)) errors.push(`${where}: duplicate "code" — codes must be unique`);
  else seen.add(record.code);

  if (!record.name) errors.push(`${where}: "name" is required`);
  if (!SCOPES.has(record.scope)) errors.push(`${where}: "scope" must be ${[...SCOPES].join(' or ')}`);
  if (!QUALIFICATION_TYPES.has(record.qualificationType)) {
    errors.push(`${where}: "qualificationType" must be one of ${[...QUALIFICATION_TYPES].join(', ')}`);
  }
  if (!STATUSES.has(record.status)) errors.push(`${where}: "status" must be one of ${[...STATUSES].join(', ')}`);

  // The issuer check matters most. An issuer that is guessed rather than
  // sourced reads as fact once it is in the catalog. Empty means "the source
  // did not enumerate one", which is legitimate and common here.
  for (const key of UUID_LISTS) {
    const value = record[key];
    if (!Array.isArray(value)) {
      errors.push(`${where}: "${key}" must be an array (use [] when unknown, never null)`);
      continue;
    }
    for (const id of value) {
      if (!UUID_RE.test(id)) errors.push(`${where}: "${key}" entry "${id}" is not a platform UUID`);
    }
  }

  // Prerequisites are CODES, not UUIDs, and must resolve inside this file —
  // a prerequisite pointing at nothing is an eligibility rule that silently
  // never applies.
  if (!Array.isArray(record.prerequisiteCodes)) {
    errors.push(`${where}: "prerequisiteCodes" must be an array`);
  } else {
    for (const code of record.prerequisiteCodes) {
      if (!codes.has(code)) errors.push(`${where}: prerequisite "${code}" is not a code in this file`);
    }
  }

  // supersedesCode deliberately need NOT resolve: it names a retired code that
  // is no longer carried (CompTIA.CASP+, CYBERAB.LTP). Shape only.
  if (record.supersedesCode != null && typeof record.supersedesCode !== 'string') {
    errors.push(`${where}: "supersedesCode" must be a string or null`);
  }

  if (record.sourceSnapshotDate && !/^\d{4}-\d{2}-\d{2}$/.test(record.sourceSnapshotDate)) {
    errors.push(`${where}: "sourceSnapshotDate" must be YYYY-MM-DD`);
  }
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} problem(s) in data/qualifications.json\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const byScope = records.reduce((a, r) => ((a[r.scope] = (a[r.scope] || 0) + 1), a), {});
const byType = records.reduce((a, r) => ((a[r.qualificationType] = (a[r.qualificationType] || 0) + 1), a), {});
console.log(`OK: ${records.length} entries (${byScope.individual} individual, ${byScope.organizational} organizational), `
  + `${seen.size} unique codes, no supplied ids`);
console.log(`     by qualificationType: ${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ')}`);
