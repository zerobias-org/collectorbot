# @zerobias-org/collectorbot-nist-cmvp

## Description

Collector bot for NIST's Cryptographic Module Validation Program (CMVP)
registry. Calls the `@zerobias-org/module-nist-cmvp` Hub module (an
HTML-scraping client — the registry has no API) and writes
`CmvpCertificate` objects into AuditgraphDB, turning the module's
always-live scraper into the platform's queryable, periodically-refreshed
copy of the registry.

## Data Collected

- **CmvpCertificate**: one object per CMVP certificate — validation
  status, FIPS standard, security level, vendor/module identification, the
  verbatim `caveatText` (the conditions under which a validation actually
  applies — always check this before citing a module as FIPS-validated for
  a specific deployment), and a captured `rawEntryHtml` audit trail.

## Required Permissions

None. The CMVP registry is fully public and unauthenticated — the module's
`connectionProfile.yml` is a near-empty stand-in (see the module's own
README for the rationale).

## Configuration

No parameters required. Every run re-collects the full registry (currently
~1147 certificates) — the registry has no filterable scope.

## GroupId Strategy

Single stable groupId: `'nist-cmvp'`. CMVP is one global public registry,
not scoped per tenant/account/region, so a stable groupId lets the
platform's `Batch` reconciliation handle adds/updates/retirements with no
custom diffing logic.

## Fetch Behavior

`listCertificates()` returns only summary rows, so this collector fetches
full detail for every certificate on each run (one `getCertificate()` call
per row). Concurrency is bounded to 5 concurrent requests — measured live
against the real registry: a full run (~1147 certs) takes roughly 1-2
minutes at this concurrency, chosen as a considerate default against a
public government site with no stated rate limits (see
`CMVP_Connector_STATUS.md` in `~/documents/connectors/CMVP/` for the
underlying timing data).

## Known Limitation (temporary)

`src/SchemaTypes.ts` is a **hand-authored local stand-in** for
`@zerobias-org/schema-nist-cmvp-ts`. The real generated TypeScript twin is
produced by the `zb.schema` Gradle plugin's `schema-ts-generator`, which
only runs as a post-load action of the schema package's `dataloaderExec`
task — that needs a live Neon Postgres branch, unavailable until the
schema package is actually published through CI. Once
`@zerobias-org/schema-nist-cmvp-ts` is publishable, delete
`src/SchemaTypes.ts` and import the real package in `src/Mappers.ts`
instead.

## Development

```bash
npm install
npm run build
npm run lint
npm run test:integration
```

`test:integration` requires a real Hub/platform connection (`API_KEY`,
`ORG_ID`, etc. via env) that this development sandbox does not have
configured — same category of gap as the module's own `testHub`/
`dataloaderExec` limitations. Build and lint are fully verified locally;
the integration test's actual collection run against AuditgraphDB has not
been.
