export { ComplianceCertification } from '@zerobias-org/schema-zerobias-schemas-qualifications-ts/dist/src/index.js';

/**
 * One record of the bundled data file (`data/qualifications.json`).
 *
 * NOTE: there is deliberately no `id`. Object ids are derived from `code` at
 * collect time so a contributor cannot supply a duplicate or invented one — a
 * duplicate id silently breaks the upsert property of a collection run.
 */
export interface CertificationRecord {
  code: string;
  name: string;
  /** Who holds it. An explicit column, not an inference from links. */
  scope: 'individual' | 'organizational';
  /**
   * WHAT it is, as opposed to who holds it. Varies independently of `scope`.
   * certification  — the holder was assessed against a standard
   * accreditation  — the holder is authorised to assess or certify others
   * registration   — the holder is listed on a registry after training or agreement
   * authorization  — the holder is approved to deliver training, a platform, or content
   */
  instrumentType: 'certification' | 'accreditation' | 'registration' | 'authorization';
  proficiency: string | null;
  ecosystemCode: string | null;
  issuerVendorIds: string[];
  frameworkIds: string[];
  /** Platform Standard UUIDs this certification is assessed against. */
  standardIds: string[];
  /** CODES (not UUIDs) of certifications accepted toward eligibility. */
  prerequisiteCodes: string[];
  qualifiesForRoleIds: string[];
  /** Code of the certification this one replaced; need not still be carried. */
  supersedesCode: string | null;
  sourceUrl: string | null;
  sourceSnapshotDate: string | null;
  status: string;
  submittedByUserId: string | null;
}
