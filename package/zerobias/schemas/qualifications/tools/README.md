# tools — how the catalog was built, and how to refresh it

**You do not need anything in here to contribute a certification.** The
contribution surface is [`../data/qualifications.json`](../data/qualifications.json);
edit it and run `npm run validate:data`.

These scripts exist so the provenance of the seed data is reproducible and so
someone other than the original author can refresh it.

## The chain

```bash
./scrape-cyberab.sh                                   # ~60s, 29 pages
python3 extract-cyberab.py .cyberab-mirror/cyberab.org > extract.json
```

Then diff `extract.json` against `../data/qualifications.json` by hand and add
what is new. `.cyberab-mirror/` and `extract.json` are working files — do not
commit them.

## What it covers, and what it does not

cyberab.org is the source for the **CMMC**, **SCF** and **SCA** ecosystem
certifications — CCP, CCA, LCCA, CCI, RP, RPA, C3PAO, RPO, ATP, APP, the SCF
practitioner/architect/assessor track and its organizational baselines, and the
SCA CODE levels. The rest of the catalog (CompTIA, GIAC, ISC2, ISACA, IAPP,
OffSec, CREST, ISO lead-auditor certs) was curated by hand from issuer sites and
is **not** reproduced by this chain. Re-running it regenerates a subset.

## Two things that will bite you

**1. It is a targeted fetch, not a mirror — deliberately.** This used to be
`wget --mirror --page-requisites --level=5`. cyberab.org is a DNN site pulling
~1.5MB of CSS plus a long JS tail; measured 2026-08-20, that run had fetched
**one** HTML page in two minutes and would have taken hours, almost all of it on
assets the extractor never opens. The script now fetches exactly the pages in
`extract-cyberab.py`'s `PAGES` map — **the map is the single source of truth**,
so add a page there and the fetch picks it up. A moved page prints `MISS <code>`
rather than disappearing quietly; fix the path in the map when you see one.

**2. The `*-Registration` pages are client-rendered and come back empty.**
11 of the 12 return only "Skip to main content Go to Top" — their content is
injected by JavaScript, which the parser does not execute. An empty
`body_excerpt` there does **not** mean the role was withdrawn. Role names and
the requirements grids come from the `Ecosystem-Roles` pages, which are
server-rendered; that is where the catalog was actually sourced. Getting the
registration detail would need a headless browser.

## Facts the source states that the data depends on

Captured 2026-08-20 so the next person does not have to re-derive them:

- **ISACA is now the Authorized CAICO.** The CMMC pages carry a banner: *"ISACA
  is now the Authorized CAICO for the CMMC program. If you are interested in the
  CCP, CCA, LCCA or CCI credentials, please visit www.isaca.org/cmmc"* — so
  those four are issued by ISACA, while CyberAB remains the accreditation body
  and the issuer for RP / RPA / RPO / C3PAO / ATP / APP.
- **The 8140.3-612 grid is a prerequisite list, not a set of certifications.** The
  Intermediate / Advanced table on the Assessing-and-Certification page
  enumerates the certifications accepted toward CCP/CCA eligibility. Those
  belong on `prerequisiteCodes`, not as rows of their own.
- **Renames in flight:** ATP was LTP, APP was LPP, CompTIA SecurityX was CASP+,
  ISC2 CGRC was CAP. Use `supersedesCode` rather than burying it in the name.
- **SCF's organizational baselines are certifications.** The SCF Certifications
  page calls them *"organizational certification baselines"* — an org is
  certified against e.g. the NIST CSF 2.0 baseline by an SCF 3PAO. They are
  named for the framework they attest to, which makes them easy to mistake for
  frameworks. They are `organizational` scope.
- **SCA CODE is organizational too:** *"Certified Organization for Development
  Excellence (CODE) framework includes three progressive levels of
  certification"* for organizations.

## `type` — what each entry IS, as opposed to who holds it

`scope` says **who holds it** (individual / organizational). `type` says **what it is**,
and the two vary independently — a C3PAO accreditation and an SCF CORE certification are both
organizational.

| value | rule | count |
|---|---|---|
| `certification` | the holder was **assessed** against a standard | 116 |
| `accreditation` | the holder is authorised to **assess or certify others** | 2 |
| `registration` | the holder is **listed on a registry** after training or agreement, with no independent assessment of competency | 4 |
| `authorization` | the holder is approved to **deliver** something — training, a platform, published content — rather than to assess | 4 |

Everything not named below is `certification`. The non-default assignments, in full, so they can be
argued with:

- **accreditation** — `CYBERAB.C3PAO`, `SCF.3PAO`. Both authorise the holder to conduct assessments
  of other organisations. This is the ISO/IEC 17011 sense.
- **registration** — `CYBERAB.RP`, `CYBERAB.RPA`, `CYBERAB.RPO`, `SCF.RPO`. Registry listings.
- **authorization** — `CYBERAB.ATP` (Approved Training Provider), `CYBERAB.APP` (Approved Publishing
  Partner), `SCF.APO` (Authorized Platform Organization), `SCF.APP` (Authorized Platform Partner).
  Approved to deliver, not to assess.

### Two traps in this classification

**"Registered" in a name does not make it a registration.** The CREST tier names —
`CREST.CRT` (Registered Penetration Tester), `CREST.CRIA`, `CREST.CRIS` — are **exam-based
certifications**; "Registered" is CREST's word for an exam level, not a registry listing. They are
typed `certification` deliberately. Only the CyberAB/SCF `RP*` rows are true registrations.

**The SCF and SCA baselines are certifications, not frameworks.** `SCF.EU-DORA`,
`SCF.NIST-CSF-2.0`, `SCF.HIPAA` and the rest read like regulations because they are *named for* the
framework they attest to. The SCF Certifications page calls them, verbatim, *"organizational
certification baselines"* — an organisation is certified against the baseline by an SCF 3PAO. Same
for the `SCA.CODE*` levels. Culling them as "frameworks nobody holds" was proposed once and was
wrong.

### Values deliberately NOT used yet

`license`, `degree` and `clearance` are real instrument types in this family and **no row needs them
today** — the set holds zero state licences, zero academic degrees and zero security clearances.
They are named here so that adding one later is a data change rather than a schema debate. A
`license` is granted by a government body and is jurisdiction-scoped; a `degree` never expires; a
`clearance` carries an adjudicating agency and a reinvestigation cycle. Each of those brings fields
this class does not have, so adding one is not purely a data change if the extra fields matter.

⚠️ **This classification is provisional.** The instrument taxonomy is under discussion with Kevin
(2026-08-21/24) — the working direction is a platform-level `Qualification` base with these as
subtypes. The rules above are the current editorial reading and the Content Team owns the final
call on any individual row.

## Editorial rules that look like bugs

- **An empty `issuerVendorIds` is correct** when the source does not enumerate
  an issuer. The six ISO Lead Auditor / Implementer records read *"Multiple
  (BSI/PECB/etc)"*; writing `["<BSI uuid>"]` would assert BSI is the sole
  issuer, which is false. Empty means unknown.
- **Framework links are per-standard, not per-issuer-family.** 17 links in the
  original source were dropped because six different ISO standards shared one
  framework id, as did six IAPP certifications spanning five jurisdictions. A
  wrong link reads as fact; an absent one reads as pending.
- **Never guess a UUID.** Issuer, framework and standard ids must be looked up
  in the platform catalogs. An id that resolves to the wrong vendor is worse
  than no id.
