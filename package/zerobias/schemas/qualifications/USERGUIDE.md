# Compliance Certifications Collector — User Guide

## What it does

Loads a curated catalog of 126 cybersecurity and compliance certifications and accreditations into
your graph as `ComplianceCertification` objects. Each entry carries the certification's
code and name, its scope, the platform Vendor that issues it, any frameworks it
is associated with, and a reference to the source it was curated from.

The data ships inside the collector — there is no system to connect and nothing
to authenticate.

## Parameters

None.

## Example Configuration

```yaml
collectorArtifact: '@zerobias-org/collectorbot-zerobias-schemas-qualifications'
executionMode: caller
batchMode: full
format: json
connectorType: product_specific
params: {}
```

## What you will see

| Field | Example | Notes |
|---|---|---|
| `code` | `ISC2.CISSP` | The object id. Unique and stable across releases. |
| `name` | `CISSP` | Display name. |
| `scope` | `individual` | `individual` or `organizational`. 100 individual, 26 organizational. |
| `issuerVendorIds` | `["b2698878-…"]` | Platform Vendor UUIDs. **Empty is normal** — 6 records have no enumerable issuer. |
| `frameworkIds` | `["520f94d1-…"]` | Platform Framework UUIDs. **Empty is normal** — only 14 records carry a framework link today. |
| `qualifiesForRoleIds` | `[]` | Empty on every record today. Do not build on it yet. |
| `ecosystemCode` | `DoD 8140.3 / 612` | Free-form grouping, used where a Framework catalog entry does not exist. |
| `sourceSnapshotDate` | `2026-04-23` | When the source reference was captured. Use it to judge staleness. |

## Filtering

Most consumers want one scope. `scope` is the field to filter on — a picker that
does not filter it will show 123 individual certifications alongside 3
organizational authorizations.

## Refresh cadence

The dataset changes only when a new version of this collector is published. A
scheduled run against an unchanged version is a no-op.
