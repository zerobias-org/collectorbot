# X12 → Hospital Financials mapping (draft)

Collector `@zerobias-org/collectorbot-x12-x12` reads the transactions buffered by
`@zerobias-org/module-x12-x12` (zerobias-org/module#59) and writes the
`zerobias.schemas.hospitalfinancials` classes (zerobias-org/schema#92).

**Status: draft.** `src/Mappers.ts` and its tests are complete and green. The
collector implementation, generated client and dependency wiring wait on the
module and schema publishing (the repo's `/create-collector` flow requires both).

## 1. Flow

```
module-x12-x12  ──ops/take (per transaction type)──▶  Mappers.ts  ──▶  Batch per class  ──▶  ops/ack
   835 / 837P / 837I / 277CA / 999                      pure            deletesEnabled: false
```

| Transaction | Mapper | Classes written |
|---|---|---|
| 837P (X222), 837I (X223) | `map837` | HospitalPayer, HospitalClaim, HospitalClaimLine |
| 835 (X221) | `map835` | HospitalPayer, HospitalRemittanceAdvice, HospitalRemittanceClaim, HospitalRemittanceServiceLine, HospitalRemittanceAdjustment, HospitalProviderLevelAdjustment |
| 277CA (X214) | `map277CA` | HospitalClaimRejection (STC01-1 ∈ A3 A4 A6 A7 A8) |
| 999 (X231) | `map999` → fetch the 837 → `rejectionsFor999` | HospitalClaimRejection, one per claim of the rejected set |

Not mapped: 277 (X212) status responses, 834, 820 and 270/271. TA1 is outside the module's
scope (DESIGN.md §10). HospitalDiagnosis is also unmapped: 837 HI codes could feed it, but the
class links only to HospitalEncounter (source HL7 DG1), so it needs a `claim` link first (§6).

## 2. Read path and batches

- **Drain, don't browse.** Call `ops/take` with `(transactionType=<TS>)`, map, add to batches,
  end the batches, and only then `ops/ack` the lease. A failed run lets the lease expire and the
  module re-offers the rows, so nothing is lost. Preview mode calls `ops/release` instead of `ack`.
- **`deletesEnabled: false` on every batch.** A drain only sees new transactions, so a batch
  with deletes enabled would delete every claim from earlier runs when it ends
  (COLLECTORBOT_RULES §GroupId). These are event entities, and removal comes from the hospital, not the feed.
- **999 lookup:** a rejected set names the 837 only by `AK102` (GS06) and `AK202` (ST02). The collector
  queries the module for
  `(&(|(transactionType=837P)(transactionType=837I))(gsControlNumber=<AK102>)(stControlNumber=<AK202>)(receiverId=<999 senderId>))`
  (the control numbers resolve through `json_extract`, module DESIGN.md §2.6) and maps the claims of that 837. If the 837 never
  passed through this inbox, the rejection is logged and dropped.

## 3. Identity and joins

IDs are deterministic from business keys (restricted to `[\w.-]`, parts joined with `.`), so a
replayed, recast or re-delivered transaction upserts the same objects.

| Class | id | Why |
|---|---|---|
| HospitalPayer | `x12payer.<payerId>` | payerId from 837 2010BB NM109, or on the 835: 1000A N104, then REF\*2U, then TRN03 |
| HospitalClaim | `x12claim.<CLM01>` | CLM01 = CLP01 = 277CA TRN02: the one key every transaction echoes. A replacement (CLM05-3 = 7) keeps CLM01 and upserts. |
| HospitalClaimLine | `<claim>.ref.<REF*6R>`, else `<claim>.lx.<LX01>` | The 835 echoes REF\*6R, never LX |
| HospitalRemittanceAdvice | `x12remit.<payerId>.<TRN02>` | Trace number is unique per payer payment |
| HospitalRemittanceClaim | `<advice>.clp.<CLP01>.<CLP02>` | A reversal (22) and its correction share CLP01 in one 835 |
| HospitalRemittanceServiceLine | `<remitClaim>.svc.<REF*6R or ordinal>` | |
| HospitalRemittanceAdjustment | `<parent>.cas.<CAS01>.<reason>` | |
| HospitalProviderLevelAdjustment | `<advice>.plb.<reason>.<reference>` | |
| HospitalClaimRejection | `x12rej.277ca.<sender>.<BHT03>.<CLM01>.<cat>.<code>` / `x12rej.999.<sender>.<ISA13>.<AK102>.<AK202>.<CLM01>` | |

Repeats of the same key inside one transaction get `.2`, `.3`, and so on. Links are set on the single-valued
side only (child → parent). The platform infers the multi side.

## 4. Field mapping

Paths are in the module's materialized JSON (DESIGN.md §2.3): loops are `loop<id>`, segments are
lower-case, and elements are `<seg><nn>`. A path that repeats once arrives as an object, otherwise as an array (`asArray`).

**HospitalClaim** (837 loop 2300): `patientControlNumber` CLM01 · `totalCharge` CLM02 ·
`claimType` from GS08 (X222 → PROFESSIONAL, X223 → INSTITUTIONAL) · `billType` CLM05-1 + CLM05-3,
837I only (on an 837P, CLM05-1 is the place of service) · `statementFromDate` / `statementToDate`
DTP\*434 (RD8 split) · `submittedTime` envelope `interchangeDate` (ISA09/10) ·
`interchangeControlNumber` envelope `isaControlNumber` · `payer` → 2010BB.

**HospitalClaimLine** (837 loop 2400): `lineNumber` LX01 · `procedureCode` SV101-2 / SV202-2 ·
`modifiers` SV101-3..6 / SV202-3..6, space-joined · `units` SV104 / SV205 · `lineCharge`
SV102 / SV203 · `revenueCode` SV201 (837I) · `serviceDate` DTP\*472 (start of an RD8).

**HospitalRemittanceAdvice** (835 header): `traceNumber` TRN02 · `paymentAmount` BPR02 ·
`paymentMethod` BPR04 · `paymentDate` BPR16 · `productionDate` DTM\*405 · `payer` → 1000A.

**HospitalRemittanceClaim** (835 loop 2100): CLP01–05, CLP07 as the class describes · `claim` →
`x12claim.<CLP01>`. Claim-level CAS → adjustments linked by `remittanceClaim`.

**HospitalRemittanceServiceLine** (835 loop 2110): `procedureCode` SVC01-2 · `submittedCharge`
SVC02 · `paidAmount` SVC03 · `units` SVC05 (absent = 1, per X221) · `allowedAmount` AMT\*B6 ·
`serviceDate` DTM\*472/150, else claim DTM\*232 · `claimLine` only when REF\*6R is present.

**HospitalRemittanceAdjustment** (CAS): one object per (reason, amount, quantity) triplet,
CAS02–04 through CAS17–19; `groupCode` CAS01.

**HospitalProviderLevelAdjustment** (PLB): one object per (PLB03 composite, amount) pair,
PLB03/04 through PLB13/14; `providerIdentifier` PLB01 · `fiscalPeriodDate` PLB02.

**HospitalClaimRejection**: 277CA 2200D STC01-1/-2, STC12 as `reason`, `claim` from TRN02 (TRN01 = 2);
999: IK502–506 as `statusCode`, IK3/IK4 detail as `reason`, one per claim of the rejected 837.
`rejectionTime` is the acknowledgment's interchange date-time.

## 5. Verification

- `test/unit/Mappers.test.ts`: 19 tests over the module's synthetic fixtures (`test/fixtures/`,
  module output plus the envelope overlay). They include the balancing checks line charge − paid = CAS,
  ΣSVC03 = CLP04 and ΣCLP04 − ΣPLB = BPR02.
- Local sweep over the 33 x12.org example transactions the module parses (not committed; X12
  IP): 11 × 835, 17 × 837, 4 × 277, 1 × 999 map without errors. Every 835 claim and line balances,
  every 837 claim's lines sum to CLM02, and all 277CA rejections resolve a claim.

## 6. Open questions

1. **`deletesEnabled: false` semantics** (Catalin): confirm that `endBatch` then only upserts, and
   what an object added under two groupIds does (payers recur across transactions).
2. **Payer identity across 837 and 835:** the 835 often carries only TRN03 (1 + EIN), which never
   equals the 837's NM109 payer id. Proposal: a `payerAliases` parameter (TRN03/N104 → canonical
   id) until HospitalPayer is sourced from the hospital's payer master.
3. **Code-set links** (`procedureElement`, `reasonCodeElement`): wait on the HCPCS/CARC standard
   packages, which are blocked on whether a standard can hang under a product.
4. **HospitalClaim.encounter:** needs HospitalEncounter's id scheme from the HL7 ADT side.
5. **2200B batch-level 277CA rejections** name no claim. Options: map them to every claim of the
   referenced batch (BHT03 → 837), or log them only.
6. **HospitalDiagnosis from 837 HI:** add `claim` to the class, or leave diagnoses to HL7.
7. **837D (X224):** `hospital.claimType` has no DENTAL value. These are skipped for now.
