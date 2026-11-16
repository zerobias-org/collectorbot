---
name: create-collector
description: Create a new collector bot package with automatic implementation and validation, either a tenant collector (one customer connection through Hub) or a shared collector (global/public data, no connection profile, module used in-process as an SDK; e.g. NIST CMVP, CVE). Use when user wants to create a new collector from scratch.
---

# create-collector

Create a new collector bot package with automatic implementation and validation.

## Usage

`/create-collector <vendor> <suite?> <product> [--shared]`

**Arguments:**
- `vendor` (required) - Vendor name (e.g., `amazon`, `microsoft`, `google`)
- `suite` (optional) - Suite name if vendor has suites (e.g., `aws`, `365`)
- `product` (required) - Product name (e.g., `iam`, `s3`, `entra`)
- `--shared` (optional) - Build a **shared collector** (see [Collector modes](#collector-modes)). If the flag is absent, ask the user which mode when the data is global/public.

**Examples:**
```
/create-collector amazon aws s3
/create-collector microsoft entra
/create-collector google workspace sheets
/create-collector nist cmvp --shared
```

## Collector modes

| | Tenant collector (default) | Shared collector (`--shared`) |
|---|---|---|
| Data | One customer's system | Global/public reference data (CMVP, CVE, CPE, standards) |
| Run model | On demand, per customer connection | Perpetual daily pipeline, one run for everybody |
| Source module | Listed in `hub.yml` `modules:`; codegen injects `<X>HubImpl`, called **through Hub** with the customer's connection (`targetId`) | **Not** in `hub.yml` `modules:`; plain npm dependency used **in-process as an SDK**: `newX()` (+ `connect(...)` only if the module has a connection profile) |
| Connection profile | Customer's, held by Hub | None. If the module needs credentials, they are read-only, public-data-scoped values passed as collector **parameters** (set in the pipeline YAML `params:`) |
| Paging | `PagedResults.forEach(cb, concurrency, this.previewCount)` | Explicit page loop calling the API with `pageNumber`/`pageSize` until a short/empty page. **Never** `PagedResults.forEach` / `for await` over Hub paged results: they need Hub and fail in-process |
| groupId | Per tenant (`${account}-${region}`, …) | One fixed global value (e.g. `'nist-cmvp'`, or `''`) |
| Pipeline artifact | Optional | Required: `zerobias-org/pipeline`, `executionMode: caller`, `batchMode: full`, daily |

**Why the source module stays out of `hub.yml` in shared mode:** hub-client-codegen turns every non-SDK `modules:` entry into a `<X>HubImpl` binding that throws `requires targetId` when no Hub connection exists (`optional: true` only lets hub-client start; the generated binding still needs a target). Platform SDKs (`@zerobias-com/*-sdk`, e.g. `platform-sdk`) are different: codegen discovers them from `hub.yml` or `package.json` and injects a connected `<X>ApiClient` derived from the run context, so declare and use those normally.

**Reference shared collectors:** `package/auditmation/generic/tls` (in-process module; still on legacy `@auditlogic` deps pending migration, do not copy those), `package/hl7/fhir` (no module, direct HTTP). Worked example for a module without a connection profile: `@zerobias-org/module-nist-cmvp` (`newCmvp().getCertificateApi().list(page, size)`, no `connect()`).

## Description

End-to-end collector creation with automatic validation:
1. Verify module and schema dependencies exist
2. Create directory structure and configuration files
3. Generate code (npm install + generate)
4. **Spawn 2 creation agents in parallel** (Implementation + Mapping)
5. Create documentation (README, USERGUIDE)
6. Build and lint
7. **Automatically validate with /review-collector**
8. Fix critical issues or report to user
9. Ready for commit

## Execution Instructions for Claude

### Phase 1: Parse Arguments & Verify

**Step 1.1: Parse vendor/suite/product**
```javascript
const args = args.trim().split(/\s+/);
// Examples:
// "amazon aws s3" → vendor=amazon, suite=aws, product=s3
// "microsoft entra" → vendor=microsoft, suite=null, product=entra
// "adp workforcenowng" → vendor=adp, suite=null, product=workforcenowng
```

**Step 1.2: Decide the mode**
- `--shared` given → shared mode.
- Otherwise, if the source is global/public data (no per-customer account), ask: "This looks like shared data — build a shared collector (no connection profile, daily shared pipeline)?"

**Step 1.3: Verify dependencies exist (zerobias-org only)**
```bash
npm view @zerobias-org/module-<vendor>-<suite?>-<product>
npm view @zerobias-org/schema-<vendor>-<suite?>-<product>
npm view @zerobias-org/schema-<vendor>-<suite?>-<product>-ts
npm view @zerobias-org/product-<vendor>-<suite?>-<product>

# Or browse the bundles
npm view @zerobias-org/module-bundle --json | jq '.dependencies'
npm view @zerobias-org/schema-bundle --json | jq '.dependencies'
npm view @zerobias-org/product-bundle --json | jq '.dependencies'
```

**Never** depend on `@auditlogic/*` packages: this repository is open source and only takes `@zerobias-org/*` content plus the `@zerobias-com/*` platform runtime (`hub-client`, `hub-core`, `platform-sdk`, `hub-client-codegen`). If only an `@auditlogic` version exists, STOP and tell the user the module/schema/product must first be published to zerobias-org.

**Shared mode, extra check:** does the module have a connection profile?
```bash
npm view @zerobias-org/module-<...> files | grep -i connectionProfile   # connectionProfile.yml present = has a profile
```
- No profile (e.g. `module-nist-cmvp`) → no `connect()`, no credential parameters.
- Profile with read-only credentials → plan collector parameters for them (Step 3.3).

**If missing**: STOP and inform user that module/schema/product must be created first.

---

### Phase 2: Create Structure

**Step 2.1: Create directory**
```bash
mkdir -p package/<vendor>/<suite?>/<product>
cd package/<vendor>/<suite?>/<product>
```

**Step 2.2: Create .npmrc and .nvmrc** (regular committed files, copies of the root; not symlinks)
```bash
# Based on depth (3 or 4 levels)
cp ../../../../.npmrc .npmrc    # or ../../../
cp ../../../../.nvmrc .nvmrc    # or ../../../
```

**Step 2.3: Copy templates**
```bash
# Copy from a reference collector (microsoft/azure/azureresourcegraph for tenant mode)
cp ../../../microsoft/azure/azureresourcegraph/.mocharc.json .
cp ../../../microsoft/azure/azureresourcegraph/tsconfig.json .
cp ../../../microsoft/azure/azureresourcegraph/build.gradle.kts .   # plugins { id("zb.typescript-collectorbot") }
```
(No per-package `.eslintrc`: linting uses the root `eslint.config.js`.)

**Step 2.4: Create .gitignore**
```
node_modules/
dist/
generated/
build/
eslint.config.js
eslint.config.mjs
```
(Never ignore `gate-stamp.json`.)

---

### Phase 3: Create Configuration Files

**Step 3.1: Create package.json** (use template from DEVELOPMENT_WORKFLOW.md)
- Version: 0.0.0
- Author: team@zerobias.com
- Dependencies: module + product + schema (base + ts) + core deps, all `@zerobias-org` / `@zerobias-com`
- Exact pins of the latest versions (`npm view <pkg> version`); no `^`, `~` or `latest`

**Step 3.2: Get UUIDs and create hub.yml**
```bash
npm install  # Temporary to get module installed
jq -r .moduleId node_modules/@zerobias-org/module-*/package.json   # field is camelCase moduleId
cat node_modules/@zerobias-org/product-*/index.yml | grep "^id:"
```

Tenant mode: hub.yml lists the product and the source module (operations section omitted).

Shared mode: hub.yml lists the product only; the source module stays a plain `package.json` dependency. Platform SDKs may be listed under `modules:`.
```yaml
# hub.yml (shared)
modules: {}
products:
  nist.cmvp:
    id: <product uuid>
    name: NIST CMVP
```

**Step 3.3: Ask user about parameters**
"What parameters should this collector accept (if any)?"
- If none: use minimal template
- If provided: create with user's parameters

Shared mode: if the module needs credentials, they become parameters (e.g. `nvdApiKey`), passed to `connect(...)` in-process. They are set as literal `params:` in the public `zerobias-org/pipeline` YAML, so they must be **read-only and scoped to public data**; refuse anything that grants write access or reaches private data. Optional tuning parameters (`pageSize`, `retryCount`) are fine.

**Step 3.4: Explore schema and create collector.yml**
```bash
cat node_modules/@zerobias-org/schema-*/dist/index.d.ts
cat node_modules/@zerobias-org/module-*/module-*.yml
```

Match operations to classes and include ALL classes with module data.

**Step 3.5: Generate code**
```bash
npm install
zbb build        # generate + compile
```

Verify generated/BaseClient.ts and get module connector name. Shared mode: BaseClient must NOT contain a `<X>HubImpl` for the source module (only SDK `ApiClient`s, if any); get the module's factory name instead (`newCmvp`, `newNvd`, …) from its `dist/index.d.ts`.

---

### Phase 4: Spawn Creation Agents (PARALLEL)

**CRITICAL:** Spawn BOTH agents in a SINGLE message with 2 Task calls.

**Agent 1: Implementation Agent**
- Read `.claude/agents/create-implementation.md`
- Pass: collector path, module connector name, schema classes, vendor type, **mode** (tenant/shared)
- Shared mode also pass: module factory name, whether it has a connection profile, credential parameter names, the global groupId
- Creates: src/index.ts, src/Collector*Impl.ts

**Agent 2: Mapping Agent**
- Read `.claude/agents/create-mappings.md`
- Pass: collector path, module types, schema types, schema classes
- Creates: src/Mappers.ts

Wait for both to complete.

---

### Phase 5: Create Documentation

**Step 5.1: Create README.md**
- What data is collected
- Schema classes
- Required permissions
- Development commands

**Step 5.2: Create USERGUIDE.md** (if has parameters)
- Only document parameters
- Customer-facing tone (shared mode: written for pipeline authors, not customers)
- How to find values (shared mode: how to obtain a read-only key, and that it ends up in a public pipeline YAML)
- Example JSON

**Step 5.3: Create test/e2e/Collector*IT.ts**
- Copy pattern from a similar collector (`getClient` from `@zerobias-com/hub-client`, skip when no live target)
- Adjust class name and parameters

---

### Phase 6: Build & Lint

```bash
zbb build
zbb lint
```

If errors: attempt to fix common issues, otherwise report to user.

---

### Phase 7: Validate with /review-collector

**CRITICAL:** Automatically run the validation system.

```bash
/review-collector .
```

This spawns all 8 validation agents.

**If compliance < 90%:**
- Report issues to user
- Ask if they want auto-fix for simple issues
- **Critical issues** (data loss, data deletion): Must be fixed before commit

**If compliance >= 90%:**
- Report minor issues as warnings
- Proceed to finalization

---

### Phase 8: Finalize

**Step 8.1: Lock file and gate**
```bash
rm -rf node_modules package-lock.json && npm install && npm ci --dry-run   # lock in sync
git add <the new package files>        # the gate hashes git-tracked files only
zbb gate                               # commit the generated gate-stamp.json
```

**Step 8.2: Report to user**

Display summary:
```
✅ Collector created: @zerobias-org/collectorbot-<vendor>-<suite?>-<product>

📦 Package: package/<vendor>/<suite?>/<product>

📊 Validation Results:
   ✅ Configuration: PASS
   ✅ Schema: PASS
   ✅ Mapping: PASS
   ✅ Pagination: PASS
   ✅ GroupId: PASS
   ✅ Security: PASS
   ✅ Performance: PASS
   ✅ Dependencies: PASS

   📈 Compliance: 100%

🎉 Collector is ready for commit!

📝 Next steps:
   1. Review the implementation in src/
   2. Test with: zbb testDirect (needs a live target; skips otherwise)
   3. Commit with: git commit -m "feat(s3): initial S3 collector"
   4. Shared mode: after the collector is published, add its pipeline artifact
      in zerobias-org/pipeline (daily, executionMode: caller, batchMode: full,
      credential params if any)
```

**If issues found:**
```
⚠️  Collector created with issues (Compliance: 75%)

Issues found:
   ❌ Mapping: 2 errors
   ⚠️  Performance: 1 warning

Run /review-collector to see details.

Would you like me to fix these issues automatically?
```

---

## Notes

- Implementation and Mapping agents can share documentation with validation agents
- Validation is AUTOMATIC - no manual step needed
- Creates production-ready collector in one command
- User only needs to review and commit
