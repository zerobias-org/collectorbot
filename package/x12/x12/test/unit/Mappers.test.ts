import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import {
  asArray, claimId, makeId, map277CA, map835, map837, map999, rejectionsFor999, toIsoDate,
} from '../../src/Mappers.js';
import type { X12Transaction } from '../../src/types/index.js';

/** Module output for the module's own synthetic fixtures, with the envelope overlay. */
function fixture(name: string): X12Transaction {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

/**
 * The 837I fixture with its DTP*434 statement period swapped. The fixture's own period is
 * one day (`20260905-20260905`), so it cannot tell a lost to-date from a correct one.
 */
function with837IStatementPeriod(dtp03: string): X12Transaction {
  const raw = readFileSync(new URL('../fixtures/837I-005010X223A2.json', import.meta.url), 'utf8');
  return JSON.parse(raw.replace('"20260905-20260905"', JSON.stringify(dtp03)));
}

const round = (n: number) => Math.round(n * 100) / 100;
const sum = (values: Array<number | undefined>) => round(values.reduce<number>((a, v) => a + (v ?? 0), 0));

function expectCleanIds(objects: Array<{ id: string; externalId: string; name: string }>) {
  const ids = objects.map((o) => o.id);
  expect(new Set(ids).size, 'ids unique').to.equal(ids.length);
  for (const o of objects) {
    expect(o.id).to.match(/^[\w.-]+$/);
    expect(o.externalId).to.equal(o.id);
    expect(o.name).to.be.a('string').and.not.equal('');
  }
}

describe('helpers', () => {
  it('asArray normalizes single occurrences and absence', () => {
    expect(asArray(undefined)).to.deep.equal([]);
    expect(asArray({ a: 1 })).to.deep.equal([{ a: 1 }]);
    expect(asArray([1, 2])).to.deep.equal([1, 2]);
  });

  it('toIsoDate accepts ISO, CCYYMMDD and the first half of an RD8', () => {
    expect(toIsoDate('2026-09-01')).to.equal('2026-09-01');
    expect(toIsoDate('20260905')).to.equal('2026-09-05');
    expect(toIsoDate('20260905-20260907')).to.equal('2026-09-05');
    expect(toIsoDate('')).to.equal(undefined);
    expect(toIsoDate('garbage')).to.equal(undefined);
  });

  it('makeId keeps ids to [\\w.-]', () => {
    expect(makeId('x12claim', 'A B/1')).to.equal('x12claim.A_B_1');
    expect(makeId('x', undefined, 'y')).to.equal('x._.y');
  });
});

describe('map837 — professional (X222)', () => {
  const out = map837(fixture('837P-005010X222A1'));

  it('maps the claim with envelope provenance', () => {
    expect(out.claims).to.have.length(1);
    const [claim] = out.claims;
    expect(claim).to.include({
      id: claimId('CLM0001'),
      patientControlNumber: 'CLM0001',
      claimType: 'PROFESSIONAL',
      totalCharge: 300,
      submittedTime: '2026-09-22T12:00:00Z',
      interchangeControlNumber: '000000102',
      payer: 'x12payer.EHPID00001',
    });
    // CLM05-1 on an 837P is place of service, not a bill type.
    expect(claim.billType).to.equal(undefined);
  });

  it('maps service lines that add up to the claim charge', () => {
    expect(out.claimLines.map((l) => l.procedureCode)).to.deep.equal(['99213', '36415']);
    expect(out.claimLines[0]).to.include({
      lineNumber: 1, lineCharge: 200, units: 1, serviceDate: '2026-09-01', claim: claimId('CLM0001'),
    });
    expect(out.claimLines[0].revenueCode).to.equal(undefined);
    expect(sum(out.claimLines.map((l) => l.lineCharge))).to.equal(out.claims[0].totalCharge);
  });

  it('maps the payer from 2010BB', () => {
    expect(out.payers).to.have.length(1);
    expect(out.payers[0]).to.include({ id: 'x12payer.EHPID00001', payerId: 'EHPID00001' });
    expectCleanIds([...out.payers, ...out.claims, ...out.claimLines]);
  });
});

describe('map837 — institutional (X223)', () => {
  const out = map837(fixture('837I-005010X223A2'));

  it('maps bill type and the statement period', () => {
    expect(out.claims[0]).to.include({
      patientControlNumber: 'CLM0002',
      claimType: 'INSTITUTIONAL',
      billType: '131',
      totalCharge: 2500,
      statementFromDate: '2026-09-05',
      statementToDate: '2026-09-05',
    });
  });

  it('keeps both ends of a multi-day statement period, raw RD8 or ISO interval', () => {
    // module#59 passes DTP03 through raw; module#62 normalizes RD8 to an ISO 8601 interval.
    for (const dtp03 of ['20260901-20260930', '2026-09-01/2026-09-30']) {
      const [claim] = map837(with837IStatementPeriod(dtp03)).claims;
      expect(claim, dtp03).to.include({ statementFromDate: '2026-09-01', statementToDate: '2026-09-30' });
    }
  });

  it('maps revenue codes and line charges', () => {
    expect(out.claimLines.map((l) => l.revenueCode)).to.deep.equal(['0450', '0300', '0320']);
    expect(out.claimLines.map((l) => l.procedureCode)).to.deep.equal(['99283', '80048', '71046']);
    expect(sum(out.claimLines.map((l) => l.lineCharge))).to.equal(2500);
    expectCleanIds([...out.payers, ...out.claims, ...out.claimLines]);
  });
});

describe('map835 (X221)', () => {
  const out = map835(fixture('835-005010X221A1'));

  it('maps the payment header', () => {
    expect(out.remittanceAdvices).to.have.length(1);
    expect(out.remittanceAdvices[0]).to.include({
      traceNumber: 'EFT000000101',
      paymentAmount: 450,
      paymentMethod: 'ACH',
      paymentDate: '2026-09-22',
      productionDate: '2026-09-22',
    });
  });

  it('falls back to TRN03 for payer identity when 1000A has no N104 or REF*2U', () => {
    // Known gap: this does not join to the 837's EHPID00001 (MAPPING.md §6).
    expect(out.payers[0]).to.include({ payerId: '1000000000', name: 'EXAMPLE HEALTH PLAN' });
    expect(out.remittanceAdvices[0].payer).to.equal(out.payers[0].id);
  });

  it('links remittance claims to the 837 claim by patient control number', () => {
    expect(out.remittanceClaims.map((c) => c.claim)).to.deep.equal([claimId('CLM0001'), claimId('CLM0002')]);
    expect(map837(fixture('837P-005010X222A1')).claims[0].id).to.equal(out.remittanceClaims[0].claim);
    expect(out.remittanceClaims[0]).to.include({
      claimStatusCode: '1', chargeAmount: 300, paidAmount: 220, patientResponsibilityAmount: 40,
      payerClaimControlNumber: 'EHP2026000001', remittanceAdvice: out.remittanceAdvices[0].id,
    });
  });

  it('maps service lines with allowed amounts and dates', () => {
    expect(out.serviceLines.map((l) => [l.procedureCode, l.paidAmount, l.allowedAmount, l.serviceDate]))
      .to.deep.equal([
        ['99213', 160, 180, '2026-09-01'],
        ['36415', 60, 80, '2026-09-01'],
        ['99214', 240, 240, '2026-09-02'],
      ]);
    // No REF*6R in the fixture, so no billed-line join is attempted.
    expect(out.serviceLines.every((l) => l.claimLine === undefined)).to.equal(true);
  });

  it('explodes CAS triplets and PLB pairs', () => {
    expect(out.adjustments.map((a) => `${a.groupCode}-${a.reasonCode}:${a.amount}`)).to.deep.equal([
      'CO-45:20', 'PR-3:20', 'CO-45:20', 'PR-2:20', 'CO-45:10',
    ]);
    expect(out.adjustments.every((a) => a.serviceLine && !a.remittanceClaim)).to.equal(true);
    expect(out.providerLevelAdjustments).to.have.length(1);
    expect(out.providerLevelAdjustments[0]).to.include({
      providerIdentifier: '1234567893', fiscalPeriodDate: '2026-12-31',
      reasonCode: 'WO', referenceId: 'CLM0000', amount: 10,
    });
  });

  it('balances: line charge − paid = its adjustments; claim paid = its lines; BPR02 = claims − PLB', () => {
    for (const line of out.serviceLines) {
      const adjustments = out.adjustments.filter((a) => a.serviceLine === line.id);
      expect(round(line.submittedCharge! - line.paidAmount!), line.id).to.equal(sum(adjustments.map((a) => a.amount)));
    }
    for (const claim of out.remittanceClaims) {
      const lines = out.serviceLines.filter((l) => l.remittanceClaim === claim.id);
      expect(sum(lines.map((l) => l.paidAmount)), claim.id).to.equal(claim.paidAmount);
    }
    const net = sum(out.remittanceClaims.map((c) => c.paidAmount)) - sum(out.providerLevelAdjustments.map((p) => p.amount));
    expect(round(net)).to.equal(out.remittanceAdvices[0].paymentAmount);
  });

  it('produces clean, unique ids', () => {
    expectCleanIds([
      ...out.payers, ...out.remittanceAdvices, ...out.remittanceClaims,
      ...out.serviceLines, ...out.adjustments, ...out.providerLevelAdjustments,
    ]);
  });
});

describe('map277CA (X214)', () => {
  it('yields nothing when every claim status is an acceptance (A1/A2)', () => {
    expect(map277CA(fixture('277CA-005010X214'))).to.deep.equal([]);
  });

  it('maps a rejected claim status to a rejection linked by TRN02', () => {
    const tx = fixture('277CA-005010X214');
    const claimLoop = (tx.detail as any)[0].loop2000A[0].loop2000B.loop2000C[0].loop2000D[0].loop2200D[0];
    claimLoop.stc[0].stc01 = { c04301: 'A7', c04302: '21', c04303: 'PR' };
    const rejections = map277CA(tx);
    expect(rejections).to.have.length(1);
    expect(rejections[0]).to.include({
      acknowledgmentType: 'ACK_277CA',
      statusCategoryCode: 'A7',
      statusCode: '21',
      rejectionTime: '2026-09-22T12:00:00Z',
      claim: claimId('CLM0001'),
    });
    expectCleanIds(rejections);
  });
});

describe('map999 (X231) + rejectionsFor999', () => {
  const ack = fixture('999-005010X231A1');
  const rejected = map999(ack);

  it('returns only rejected transaction sets, with their error detail', () => {
    expect(rejected).to.have.length(1);
    expect(rejected[0]).to.include({
      groupControlNumber: '102',
      transactionSetControlNumber: '0002',
      implementationGuide: '005010X222A1',
      ackCode: 'R',
    });
    expect(rejected[0].errorCodes).to.deep.equal(['5']);
    expect(rejected[0].errorDetail).to.deep.equal(['NM1@8 loop 2010AA el 9 err 7']);
  });

  it('turns a rejected set into one rejection per claim of the fetched 837', () => {
    const rejections = rejectionsFor999(rejected[0], ack, fixture('837P-005010X222A1'));
    expect(rejections).to.have.length(1);
    expect(rejections[0]).to.include({
      acknowledgmentType: 'ACK_999',
      statusCode: '5',
      claim: claimId('CLM0001'),
      rejectionTime: '2026-09-22T12:00:00Z',
    });
    expectCleanIds(rejections);
  });
});
