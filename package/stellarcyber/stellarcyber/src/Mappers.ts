import * as s from '@zerobias-org/schema-stellarcyber-stellarcyber-ts/dist/index.js';
import type { Case, CaseAlert } from '@zerobias-org/module-stellarcyber-stellarcyber';

// SC severities -> the base Finding severity scale (Critical folds into HIGH).
const SEV_MAP: Record<string, string> = {
  critical: 'HIGH',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'LOW',
  informational: 'LOW',
};

function toSeverity(raw?: string): string | undefined {
  return raw ? SEV_MAP[raw.toLowerCase()] : undefined;
}

function toDate(epochMs?: number): string | undefined {
  if (!epochMs) {
    return undefined;
  }
  const secs = epochMs > 1e12 ? epochMs : epochMs * 1000;
  return new Date(secs).toISOString().split('T')[0];
}

// Best-effort affected-resource ARN so the finding links to a ZB asset.
function resourceArn(alert?: CaseAlert, account?: string): string {
  const src = alert?.source;
  const gd = src?.awsGuardduty;
  if (gd?.arn) {
    return gd.arn;
  }
  const acct = account || gd?.accountId || 'unknown';
  const user = src?.username;
  if (user && user.toLowerCase() === 'root') {
    return `arn:aws:iam::${acct}:root`;
  }
  if (user) {
    return `arn:aws:iam::${acct}:user/${user}`;
  }
  return `arn:aws:iam::${acct}:root`;
}

export function toStellarCyberFinding(raw: Case, alert?: CaseAlert): s.StellarCyberFinding {
  const src = alert?.source;
  const xdr = src?.xdrEvent;
  const account = src?.awsGuardduty?.accountId;

  const output: s.StellarCyberFinding = {
    id: `sc-${raw.id}`,
    name: raw.name || `Case ${raw.id}`,
    arn: resourceArn(alert, account),
    caseScore: raw.score,
    mitreTactic: xdr?.tactic?.name,
    mitreTechnique: xdr?.technique?.name,
    awsAccountId: account,
  };

  // Inherited Finding properties — set loosely (their exact generated types come
  // from the platform schema's Finding interface, resolved at the -ts build).
  Object.assign(output, {
    description: (xdr?.description || raw.name || '').slice(0, 500),
    severity: toSeverity(raw.severity),
    status: raw.status,
    discovered: toDate(raw.createdAt),
  });

  return output;
}
