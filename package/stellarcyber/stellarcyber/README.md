# @zerobias-org/collectorbot-stellarcyber-stellarcyber

Collector bot for **Stellar Cyber** Open XDR threat findings.

Connects via the Stellar Cyber module (`CaseApi.list` / `CaseApi.listAlerts`), maps each
correlated case + its lead alert into a `StellarCyberFinding`, and pushes them into
AuditgraphDB via `Batch`. The finding's `arn` links it to the affected ZB asset.

## Populates
- `StellarCyberFinding` (`@zerobias-org/schema-stellarcyber-stellarcyber`)

## Parameters
- `status` (optional) — filter cases by Stellar Cyber status.

## GroupId
Findings use a stable groupId (`stellarcyber-findings`) so each run refreshes the full
finding set for the connection.
