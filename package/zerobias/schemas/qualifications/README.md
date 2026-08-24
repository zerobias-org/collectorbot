# Compliance Certifications Collector

Loads the curated catalog of cybersecurity and compliance certifications and
accreditations — CISSP, CMMC CCP/CCA, C3PAO, FedRAMP 3PAO, OSCP, CIPP and 120
more — into AuditgraphDB as `ComplianceCertification` objects.

## Description

There is no external system to connect to and no Hub module. **The dataset is
the package**: `data/qualifications.json` ships inside it, and refreshing the data
means publishing a new version of this collector. That is the same way schema,
product, and vendor content already reaches the catalog.

## Data Collected

| | |
|---|---|
| Class | `ComplianceCertification` (`@zerobias-org/schema-zerobias-schemas-qualifications`) |
| Records | 126 |
| Scope | 100 individual, 26 organizational |
| Issuer resolved | 115 of 126 (11 deliberately empty — see below) |
| Framework linked | 14 |

## Required Permissions

None. The collector reads a file that ships with it.

## Configuration

No parameters. Preview mode is honoured and limits the run to `previewCount`
records (default 10).

## GroupId Strategy

One group for the whole dataset: `zerobias-compliance-certifications`.

A run replaces the previous run's objects wholesale. That is intentional — the
bundled file is the complete set, so a certification absent from it has been
retired and should disappear. **The consequence is that nothing may be added to
this dataset at runtime**: anything not in the data file is deleted on the next
run. The contribution path is a PR against `data/qualifications.json`, not a write
into the graph.

## Contributing a certification

Edit `data/qualifications.json`, then run:

```bash
npm run validate:data
```

Two editorial rules look like bugs and are not:

- **An empty `issuerVendorIds` is correct** when the source does not enumerate
  an issuer. The six ISO Lead Auditor / Lead Implementer records read
  *"Multiple (BSI/PECB/etc)"* in the source; writing `["<BSI uuid>"]` would
  assert that BSI is the sole issuer, which is false. Empty means *unknown*.
  A one-element array would mean something wrong.
- **Framework links are per-standard, not per-issuer-family.** 17 links present
  in the original source were dropped for this reason: six different ISO
  standards (27001, 27701, 22301, 9001, 42001) were sharing a single framework
  id, as were six IAPP certifications spanning five jurisdictions. A wrong link
  reads as fact; an absent one reads as pending.

**Never supply an `id`.** Object ids are derived from `code` at collect time, so
a contributor cannot invent or duplicate one. The validator rejects a supplied
id.

## Where the data came from

`tools/` carries the mirror-and-extract chain used to build the CMMC / DoD 8140
subset from cyberab.org. **You do not need it to contribute a certification** — see
[tools/README.md](tools/README.md).

## Development

```bash
npm install
npm run build
npm run lint
npm run validate:data
```
