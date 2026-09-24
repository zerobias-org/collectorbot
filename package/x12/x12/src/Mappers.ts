/**
 * X12 transaction JSON (module-x12-x12) → zerobias.schemas.hospitalfinancials.
 *
 * Every mapper is pure: one transaction in, the objects it yields out, grouped
 * by target class. IDs are deterministic from business keys so a replayed or
 * re-delivered transaction upserts the same objects (see MAPPING.md §3).
 * Links are set on the single-valued side only; the platform infers the
 * multi side.
 */
import type {
  AdjustmentGroupCode, ClaimType, HospitalClaim, HospitalClaimLine,
  HospitalClaimRejection, HospitalPayer, HospitalProviderLevelAdjustment,
  HospitalRemittanceAdjustment, HospitalRemittanceAdvice, HospitalRemittanceClaim,
  HospitalRemittanceServiceLine, Loop, Many, Mapped835, Mapped837,
  RejectedTransactionSet, Segment, X12Transaction,
} from './types/index.js';

// --- Shared helpers ---

const INVALID_ID_CHARS = /[^\w.-]/g;

/** The materializer emits an object for a single occurrence and an array for many. */
export function asArray<T>(value: Many<T>): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Schema `date` → `YYYY-MM-DD`. DT elements arrive already ISO. DTP03 arrives raw
 * from module#59 (`CCYYMMDD`, or `CCYYMMDD-CCYYMMDD` for RD8 — first half) and as
 * ISO from module#62, which normalizes it by its 1250 qualifier.
 */
export function toIsoDate(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/**
 * DTP date or date range → [from, to]; a D8 gives the same date twice. An RD8 comes as
 * raw `CCYYMMDD-CCYYMMDD` (module#59) or as the ISO 8601 interval
 * `YYYY-MM-DD/YYYY-MM-DD` (module#62) — both must keep the to-date.
 */
function dateRange(value: unknown): [string | undefined, string | undefined] {
  const s = str(value);
  const range = s
    ? (/^(\d{8})-(\d{8})$/.exec(s) ?? /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(s))
    : null;
  return range ? [toIsoDate(range[1]), toIsoDate(range[2])] : [toIsoDate(s), toIsoDate(s)];
}

/** Deterministic id from business-key parts, restricted to [\w.-]. */
export function makeId(...parts: Array<string | number | undefined>): string {
  return parts
    .map((p) => (p === undefined || p === '' ? '_' : String(p)).replaceAll(INVALID_ID_CHARS, '_'))
    .join('.');
}

/** Suffix repeats of the same id within one transaction (`x`, `x.2`, `x.3`). */
function uniqueIds() {
  const seen = new Map<string, number>();
  return (id: string): string => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}.${n}`;
  };
}

function base(id: string, name: string) {
  return { id, externalId: id, name };
}

/** First segment in a Many whose qualifier element matches. */
function qualified(segments: Many<Segment>, element: string, ...codes: string[]): Segment | undefined {
  return asArray(segments).find((s) => codes.includes(str(s?.[element]) ?? ''));
}

function claimTypeFor(gs08: string | undefined): ClaimType | undefined {
  if (gs08?.includes('X222')) return 'PROFESSIONAL';
  if (gs08?.includes('X223')) return 'INSTITUTIONAL';
  // X224 (dental) has no hospital.claimType value yet.
  return undefined;
}

const GROUP_CODES = new Set<AdjustmentGroupCode>(['CO', 'PR', 'OA', 'PI', 'CR']);

// --- Shared ids (the join keys between 837, 835 and acknowledgments) ---

export const payerId = (id: string) => makeId('x12payer', id);

/**
 * CLM01 (837) = CLP01 (835) = TRN02 (277CA 2200D): the patient control
 * number is the only key every transaction echoes. A replacement claim
 * (CLM05-3 = 7) keeps CLM01, so it upserts the original.
 */
export const claimId = (patientControlNumber: string) => makeId('x12claim', patientControlNumber);

/** REF*6R line item control number when the 837 sent one (the 835 echoes it); else LX01. */
export const claimLineId = (claim: string, lineControl: string | undefined, lx?: unknown) =>
  lineControl ? makeId(claim, 'ref', lineControl) : makeId(claim, 'lx', str(lx));

function payer(id: string | undefined, name: string | undefined): HospitalPayer | undefined {
  if (!id) return undefined;
  return { ...base(payerId(id), name ?? `Payer ${id}`), payerId: id };
}

// --- 837 (X222 professional / X223 institutional) ---

export function map837(tx: X12Transaction): Mapped837 {
  const out: Mapped837 = { payers: [], claims: [], claimLines: [] };
  const claimType = claimTypeFor(tx.gs08 ?? str(tx.st?.st03));

  for (const detail of asArray(tx.detail)) {
    for (const provider of asArray<Loop>(detail.loop2000A)) {
      for (const subscriber of asArray<Loop>(provider.loop2000B)) {
        const payerNm1 = subscriber.loop2010BB?.nm1;
        const payerObj = payer(str(payerNm1?.nm109), str(payerNm1?.nm103));
        if (payerObj && !out.payers.some((p) => p.id === payerObj.id)) out.payers.push(payerObj);

        // Claims sit under the subscriber, or under 2000C when the patient is a dependent.
        const claimLoops = [
          ...asArray<Loop>(subscriber.loop2300),
          ...asArray<Loop>(subscriber.loop2000C).flatMap((patient) => asArray<Loop>(patient.loop2300)),
        ];
        for (const loop of claimLoops) {
          const mapped = map837Claim(tx, loop, claimType, payerObj?.id);
          if (!mapped) continue;
          out.claims.push(mapped.claim);
          out.claimLines.push(...mapped.lines);
        }
      }
    }
  }
  return out;
}

function map837Claim(
  tx: X12Transaction,
  loop: Loop,
  claimType: ClaimType | undefined,
  payerRef: string | undefined,
): { claim: HospitalClaim; lines: HospitalClaimLine[] } | undefined {
  const clm = loop.clm ?? {};
  const pcn = str(clm.clm01);
  if (!pcn) return undefined;

  const id = claimId(pcn);
  const facility = clm.clm05 ?? {};
  const [statementFrom, statementTo] = dateRange(qualified(loop.dtp, 'dtp01', '434')?.dtp03);

  const claim: HospitalClaim = {
    ...base(id, `Claim ${pcn}`),
    patientControlNumber: pcn,
    claimType,
    // CLM05-1 is the facility type only on 837I; on 837P it is the place of service.
    billType: claimType === 'INSTITUTIONAL' && str(facility.c02301)
      ? `${str(facility.c02301)}${str(facility.c02303) ?? ''}`
      : undefined,
    totalCharge: num(clm.clm02),
    statementFromDate: statementFrom,
    statementToDate: statementTo,
    submittedTime: str(tx.interchangeDate),
    interchangeControlNumber: str(tx.isaControlNumber),
    payer: payerRef,
  };

  const unique = uniqueIds();
  const lines = asArray<Loop>(loop.loop2400).map((line): HospitalClaimLine => {
    const service = line.sv1 ?? line.sv2 ?? {};
    const procedure = line.sv1 ? service.sv101 : service.sv202;
    const lineControl = str(qualified(line.ref, 'ref01', '6R')?.ref02);
    const lineId = unique(claimLineId(id, lineControl, line.lx?.lx01));
    const code = str(procedure?.c00302);
    return {
      ...base(lineId, `${pcn} line ${str(line.lx?.lx01) ?? '?'}${code ? ` ${code}` : ''}`),
      lineNumber: num(line.lx?.lx01),
      procedureCode: code,
      modifiers: ['c00303', 'c00304', 'c00305', 'c00306']
        .map((k) => str(procedure?.[k]))
        .filter(Boolean)
        .join(' ') || undefined,
      units: num(line.sv1 ? service.sv104 : service.sv205),
      lineCharge: num(line.sv1 ? service.sv102 : service.sv203),
      revenueCode: line.sv2 ? str(service.sv201) : undefined,
      serviceDate: dateRange(qualified(line.dtp, 'dtp01', '472')?.dtp03)[0],
      claim: id,
      // TODO(procedureElement): uniLink to the HCPCS/CPT standard Element once
      // the standard packages exist (blocked on the standards-under-a-product answer).
    };
  });

  return { claim, lines };
}

// --- 835 (X221) ---

/**
 * Payer identity on an 835: N104 when 1000A carries one, else REF*2U, else
 * TRN03 (the payer's 1+EIN originating company id).
 * TODO: TRN03 will not match the 837 NM109 (PI) for the same payer, so those
 * payers stay separate objects until a payer crosswalk exists (MAPPING.md §6).
 */
function payer835(tx: X12Transaction): HospitalPayer | undefined {
  const loop = tx.header?.loop1000A ?? {};
  const id = str(loop.n1?.n104)
    ?? str(qualified(loop.ref, 'ref01', '2U')?.ref02)
    ?? str(tx.header?.trn?.trn03);
  return payer(id, str(loop.n1?.n102));
}

export function map835(tx: X12Transaction): Mapped835 {
  const out: Mapped835 = {
    payers: [], remittanceAdvices: [], remittanceClaims: [],
    serviceLines: [], adjustments: [], providerLevelAdjustments: [],
  };
  const header = tx.header ?? {};
  const payerObj = payer835(tx);
  if (payerObj) out.payers.push(payerObj);

  const trace = str(header.trn?.trn02);
  const adviceId = makeId('x12remit', payerObj?.payerId, trace ?? tx.elementKey);
  const amount = num(header.bpr?.bpr02);
  out.remittanceAdvices.push({
    ...base(adviceId, `835 ${trace ?? tx.stControlNumber ?? ''}`.trim()),
    traceNumber: trace,
    paymentAmount: amount,
    paymentMethod: str(header.bpr?.bpr04),
    paymentDate: toIsoDate(header.bpr?.bpr16),
    productionDate: toIsoDate(qualified(header.dtm, 'dtm01', '405')?.dtm02),
    payer: payerObj?.id,
  });

  const uniqueClaim = uniqueIds();
  for (const detail of asArray(tx.detail)) {
    for (const lx of asArray<Loop>(detail.loop2000)) {
      for (const clpLoop of asArray<Loop>(lx.loop2100)) {
        mapRemittanceClaim(out, adviceId, clpLoop, uniqueClaim);
      }
    }
  }

  const uniquePlb = uniqueIds();
  for (const plb of asArray<Segment>(tx.footer?.plb)) {
    // PLB carries up to six (reason:reference, amount) pairs: PLB03/04 … PLB13/14.
    for (let i = 3; i <= 13; i += 2) {
      const reason = plb[`plb${String(i).padStart(2, '0')}`];
      const value = num(plb[`plb${String(i + 1).padStart(2, '0')}`]);
      if (!reason || value === undefined) continue;
      const reasonCode = str(reason.c04201);
      const id = uniquePlb(makeId(adviceId, 'plb', reasonCode, str(reason.c04202)));
      out.providerLevelAdjustments.push({
        ...base(id, `PLB ${reasonCode ?? '?'} ${value}`),
        providerIdentifier: str(plb.plb01),
        fiscalPeriodDate: toIsoDate(plb.plb02),
        reasonCode,
        referenceId: str(reason.c04202),
        amount: value,
        remittanceAdvice: adviceId,
        // TODO(reasonCodeElement): uniLink to the PLB adjustment reason code list.
      });
    }
  }
  return out;
}

function mapRemittanceClaim(
  out: Mapped835,
  adviceId: string,
  loop: Loop,
  unique: (id: string) => string,
): void {
  const clp = loop.clp ?? {};
  const pcn = str(clp.clp01);
  if (!pcn) return;
  const status = str(clp.clp02);
  // A reversal (CLP02 22) and its correction share CLP01 in one 835; status keeps them apart.
  const id = unique(makeId(adviceId, 'clp', pcn, status));
  const claimRef = claimId(pcn);

  out.remittanceClaims.push({
    ...base(id, `Remit ${pcn}`),
    patientControlNumber: pcn,
    claimStatusCode: status,
    chargeAmount: num(clp.clp03),
    paidAmount: num(clp.clp04),
    patientResponsibilityAmount: num(clp.clp05),
    payerClaimControlNumber: str(clp.clp07),
    remittanceAdvice: adviceId,
    claim: claimRef,
  });
  out.adjustments.push(...mapCas(loop.cas, id, { remittanceClaim: id }));

  const claimDate = toIsoDate(qualified(loop.dtm, 'dtm01', '232')?.dtm02);
  const uniqueLine = uniqueIds();
  asArray<Loop>(loop.loop2110).forEach((line, index) => {
    const svc = line.svc ?? {};
    const code = str(svc.svc01?.c00302);
    const lineControl = str(qualified(line.ref, 'ref01', '6R')?.ref02);
    const lineId = uniqueLine(makeId(id, 'svc', lineControl ?? String(index + 1)));
    out.serviceLines.push({
      ...base(lineId, `${pcn} ${code ?? 'service'}`),
      procedureCode: code,
      submittedCharge: num(svc.svc02),
      paidAmount: num(svc.svc03),
      // SVC05 absent means one unit (X221 situational rule).
      units: num(svc.svc05) ?? 1,
      allowedAmount: num(qualified(line.amt, 'amt01', 'B6')?.amt02),
      serviceDate: toIsoDate(qualified(line.dtm, 'dtm01', '472', '150')?.dtm02) ?? claimDate,
      remittanceClaim: id,
      // Only a REF*6R echo identifies the billed line; without it there is no safe join.
      claimLine: lineControl ? claimLineId(claimRef, lineControl) : undefined,
      // TODO(procedureElement): uniLink to the HCPCS/CPT standard Element.
    });
    out.adjustments.push(...mapCas(line.cas, lineId, { serviceLine: lineId }));
  });
}

/** CAS carries up to six (reason, amount, quantity) triplets: CAS02–04 … CAS17–19. */
function mapCas(
  segments: Many<Segment>,
  parentId: string,
  link: Pick<HospitalRemittanceAdjustment, 'serviceLine' | 'remittanceClaim'>,
): HospitalRemittanceAdjustment[] {
  const unique = uniqueIds();
  const result: HospitalRemittanceAdjustment[] = [];
  for (const cas of asArray(segments)) {
    const group = str(cas.cas01) as AdjustmentGroupCode | undefined;
    for (let i = 2; i <= 17; i += 3) {
      const key = (n: number) => `cas${String(n).padStart(2, '0')}`;
      const reason = str(cas[key(i)]);
      const amount = num(cas[key(i + 1)]);
      if (!reason || amount === undefined) continue;
      const id = unique(makeId(parentId, 'cas', group, reason));
      result.push({
        ...base(id, `${group ?? '?'}-${reason} ${amount}`),
        groupCode: group && GROUP_CODES.has(group) ? group : undefined,
        reasonCode: reason,
        amount,
        quantity: num(cas[key(i + 2)]),
        ...link,
        // TODO(reasonCodeElement): uniLink to the CARC standard Element.
      });
    }
  }
  return result;
}

// --- 277CA (X214) ---

/** STC01-1 categories that mean the claim was not accepted into adjudication. */
export const REJECTED_277_CATEGORIES = new Set(['A3', 'A4', 'A6', 'A7', 'A8']);

export function map277CA(tx: X12Transaction): HospitalClaimRejection[] {
  const result: HospitalClaimRejection[] = [];
  const unique = uniqueIds();
  const reference = str(tx.header?.bht?.bht03) ?? tx.elementKey;

  for (const detail of asArray(tx.detail)) {
    for (const source of asArray<Loop>(detail.loop2000A)) {
      for (const receiver of asArray<Loop>(source.loop2000B)) {
        // TODO: 2200B STC rejects a whole submitter batch; it names no claim, so it is only logged.
        for (const provider of asArray<Loop>(receiver.loop2000C)) {
          for (const patient of asArray<Loop>(provider.loop2000D)) {
            for (const claimLoop of asArray<Loop>(patient.loop2200D)) {
              const pcn = str(qualified(claimLoop.trn, 'trn01', '2')?.trn02);
              for (const stc of asArray<Segment>(claimLoop.stc)) {
                const category = str(stc.stc01?.c04301);
                if (!category || !REJECTED_277_CATEGORIES.has(category)) continue;
                const code = str(stc.stc01?.c04302);
                const id = unique(makeId('x12rej', '277ca', tx.senderId, reference, pcn, category, code));
                result.push({
                  ...base(id, `277CA ${category}:${code ?? '?'} ${pcn ?? ''}`.trim()),
                  acknowledgmentType: 'ACK_277CA',
                  statusCategoryCode: category,
                  statusCode: code,
                  reason: str(stc.stc12) ?? `${category}:${code ?? ''} (${str(stc.stc01?.c04303) ?? 'entity n/a'})`,
                  rejectionTime: str(tx.interchangeDate)
                    ?? (toIsoDate(stc.stc02) ? `${toIsoDate(stc.stc02)}T00:00:00Z` : undefined),
                  claim: pcn ? claimId(pcn) : undefined,
                });
              }
            }
          }
        }
      }
    }
  }
  return result;
}

// --- 999 (X231) ---

/** IK501 values that reject the transaction set (A and E are acceptances). */
const REJECTED_999_CODES = new Set(['M', 'R', 'W', 'X']);

/**
 * The rejected transaction sets in a 999. Each names an 837 by control
 * numbers only; the collector fetches that 837 and calls `rejectionsFor999`.
 */
export function map999(tx: X12Transaction): RejectedTransactionSet[] {
  const ak1 = tx.header?.ak1 ?? {};
  return asArray<Loop>(tx.header?.loop2000)
    .filter((set) => REJECTED_999_CODES.has(str(set.ik5?.ik501) ?? ''))
    .map((set) => ({
      ackElementKey: tx.elementKey,
      groupControlNumber: str(ak1.ak102),
      transactionSetControlNumber: str(set.ak2?.ak202),
      implementationGuide: str(set.ak2?.ak203) ?? str(ak1.ak103),
      ackCode: str(set.ik5?.ik501) ?? '',
      errorCodes: ['ik502', 'ik503', 'ik504', 'ik505', 'ik506']
        .map((k) => str(set.ik5?.[k]))
        .filter((c): c is string => Boolean(c)),
      errorDetail: asArray<Loop>(set.loop2100).flatMap((segErr) => {
        const ik3 = segErr.ik3 ?? {};
        const where = `${str(ik3.ik301) ?? '?'}@${str(ik3.ik302) ?? '?'}${ik3.ik303 ? ` loop ${str(ik3.ik303)}` : ''}`;
        const elements = asArray<Loop>(segErr.loop2110).map((el) => {
          const ik4 = el.ik4 ?? {};
          return `${where} el ${str(ik4.ik401?.c03001) ?? '?'} err ${str(ik4.ik403) ?? '?'}`;
        });
        return elements.length > 0 ? elements : [`${where} err ${str(ik3.ik304) ?? '?'}`];
      }),
      rejectionTime: str(tx.interchangeDate),
    }));
}

/** One rejection per claim in the 837 transaction set the 999 rejected. */
export function rejectionsFor999(
  rejected: RejectedTransactionSet,
  ack: Pick<X12Transaction, 'senderId' | 'isaControlNumber'>,
  rejected837: X12Transaction,
): HospitalClaimRejection[] {
  return map837(rejected837).claims.map((claim) => {
    const id = makeId(
      'x12rej', '999', ack.senderId, ack.isaControlNumber,
      rejected.groupControlNumber, rejected.transactionSetControlNumber, claim.patientControlNumber,
    );
    return {
      ...base(id, `999 ${rejected.ackCode} ${claim.patientControlNumber}`),
      acknowledgmentType: 'ACK_999',
      statusCode: rejected.errorCodes.join(' ') || rejected.ackCode,
      reason: rejected.errorDetail.join('; ') || `Transaction set rejected (IK501 ${rejected.ackCode})`,
      rejectionTime: rejected.rejectionTime,
      claim: claim.id,
    };
  });
}
