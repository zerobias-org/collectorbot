/**
 * Local types for the X12 collector.
 *
 * Source side: the transaction JSON served by @zerobias-org/module-x12-x12
 * (collection elements of /x12-receiver/by-type/<TS>, and `ops/take`
 * transactions). The module generates a full schema per implementation guide;
 * only the paths the mappers read are typed here, loosely, because the
 * materializer emits a single object where a segment/loop repeats once and an
 * array where it repeats more (see `asArray`).
 *
 * Target side: mirrors of the zerobias.schemas.hospitalfinancials classes.
 * TODO: replace with imports from @zerobias-org/schema-zerobias-schemas-hospitalfinancials-ts
 * once schema#92 merges and publishes.
 */

/* ------------------------------------------------------------------ */
/* Source: module-x12-x12 transaction JSON                            */
/* ------------------------------------------------------------------ */

export type Many<T> = T | T[] | undefined;
export type Segment = Record<string, any>;
export type Loop = Record<string, any>;

/** Envelope overlay the module writes at the top level of every transaction. */
export interface X12Envelope {
  elementKey: string;
  fileId?: string;
  fileName?: string;
  sourceName?: string;
  isaControlNumber?: string;
  gsControlNumber?: string;
  stControlNumber?: string;
  gs08: string;
  transactionType: string;
  senderId?: string;
  receiverId?: string;
  /** ISA09 + ISA10 as an ISO date-time. */
  interchangeDate?: string;
  receivedAt?: string;
  status?: string;
}

export interface X12Transaction extends X12Envelope {
  st?: Segment;
  header?: Loop;
  detail?: Many<Loop>;
  footer?: Loop;
  se?: Segment;
}

/* ------------------------------------------------------------------ */
/* Target: zerobias.schemas.hospitalfinancials                         */
/* ------------------------------------------------------------------ */

/** Fields every collected object carries (hl7/fhir collector convention). */
export interface BaseObject {
  id: string;
  externalId: string;
  name: string;
}

export type ClaimType = 'INSTITUTIONAL' | 'PROFESSIONAL';
export type AdjustmentGroupCode = 'CO' | 'PR' | 'OA' | 'PI' | 'CR';
export type AcknowledgmentType = 'TA1' | 'ACK_999' | 'ACK_277CA';

/** Schema `date` fields: runtime value must be `YYYY-MM-DD`. */
export type SchemaDate = string;
/** Schema `date-time` fields: ISO 8601. */
export type SchemaDateTime = string;

export interface HospitalPayer extends BaseObject {
  payerId?: string;
}

export interface HospitalClaim extends BaseObject {
  patientControlNumber: string;
  claimType?: ClaimType;
  billType?: string;
  totalCharge?: number;
  statementFromDate?: SchemaDate;
  statementToDate?: SchemaDate;
  submittedTime?: SchemaDateTime;
  interchangeControlNumber?: string;
  payer?: string;
}

export interface HospitalClaimLine extends BaseObject {
  lineNumber?: number;
  modifiers?: string;
  units?: number;
  lineCharge?: number;
  serviceDate?: SchemaDate;
  revenueCode?: string;
  procedureCode?: string;
  claim: string;
}

export interface HospitalRemittanceAdvice extends BaseObject {
  traceNumber?: string;
  paymentAmount?: number;
  paymentMethod?: string;
  paymentDate?: SchemaDate;
  productionDate?: SchemaDate;
  payer?: string;
}

export interface HospitalRemittanceClaim extends BaseObject {
  patientControlNumber: string;
  claimStatusCode?: string;
  chargeAmount?: number;
  paidAmount?: number;
  patientResponsibilityAmount?: number;
  payerClaimControlNumber?: string;
  remittanceAdvice: string;
  claim?: string;
}

export interface HospitalRemittanceServiceLine extends BaseObject {
  submittedCharge?: number;
  paidAmount?: number;
  units?: number;
  allowedAmount?: number;
  serviceDate?: SchemaDate;
  procedureCode?: string;
  remittanceClaim: string;
  claimLine?: string;
}

export interface HospitalRemittanceAdjustment extends BaseObject {
  groupCode?: AdjustmentGroupCode;
  reasonCode?: string;
  amount?: number;
  quantity?: number;
  serviceLine?: string;
  remittanceClaim?: string;
}

export interface HospitalProviderLevelAdjustment extends BaseObject {
  providerIdentifier?: string;
  fiscalPeriodDate?: SchemaDate;
  reasonCode?: string;
  referenceId?: string;
  amount?: number;
  remittanceAdvice: string;
}

export interface HospitalClaimRejection extends BaseObject {
  acknowledgmentType: AcknowledgmentType;
  statusCategoryCode?: string;
  statusCode?: string;
  reason?: string;
  rejectionTime?: SchemaDateTime;
  claim?: string;
}

/* ------------------------------------------------------------------ */
/* Mapper results — one per transaction, grouped by target class       */
/* ------------------------------------------------------------------ */

export interface Mapped837 {
  payers: HospitalPayer[];
  claims: HospitalClaim[];
  claimLines: HospitalClaimLine[];
}

export interface Mapped835 {
  payers: HospitalPayer[];
  remittanceAdvices: HospitalRemittanceAdvice[];
  remittanceClaims: HospitalRemittanceClaim[];
  serviceLines: HospitalRemittanceServiceLine[];
  adjustments: HospitalRemittanceAdjustment[];
  providerLevelAdjustments: HospitalProviderLevelAdjustment[];
}

/**
 * A 999 transaction-set rejection. It names the rejected 837 by group and
 * transaction-set control number but not its claims, so the collector has to
 * fetch that 837 from the module and call `rejectionsFor999`.
 */
export interface RejectedTransactionSet {
  ackElementKey: string;
  /** AK102: GS06 of the rejected functional group. */
  groupControlNumber?: string;
  /** AK202: ST02 of the rejected transaction set. */
  transactionSetControlNumber?: string;
  /** AK203 / AK103: the rejected set's implementation guide. */
  implementationGuide?: string;
  /** IK501: A accepted, E accepted with errors, M/R/W/X rejected. */
  ackCode: string;
  /** IK502..IK506 syntax error codes. */
  errorCodes: string[];
  /** IK3/IK4 segment and element errors, flattened to text. */
  errorDetail: string[];
  rejectionTime?: SchemaDateTime;
}
