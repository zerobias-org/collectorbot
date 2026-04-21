# Gradle Migration Skill — Collector Bots (zerobias-org)

Migrate a collector bot in this repo (`zerobias-org/collectorbot`) from the old Lerna/Nx/npm-scripts build to Gradle + zbb.

## Overview

This replaces the old workflow (Lerna orchestration, npm scripts for build/test) with:
- **Gradle** for build lifecycle (validate -> generate -> compile -> lint -> test -> gate -> publish)
- **zbb** for local development (build, test, gate)
- **`test/e2e/`** tests (renamed from `test/integration/`)
- **Pinned dependencies** to exact latest versions

## Reference Implementations

- **First migrated bot in this repo**: `package/avigilon/alta/access/` (when complete)
- **Cross-repo reference (auditlogic conventions, mostly applicable)**: `auditlogic/collectorbot/package/github/github/collectorbot/`
- **Skill source-of-truth (auditlogic)**: `auditlogic/collectorbot/.claude/skills/gradle-migration/SKILL.md`

## Prerequisites

- Root Gradle infrastructure already in place (`build.gradle.kts`, `settings.gradle.kts`, gradle wrapper, `gradle.properties`, `gradle-ci.properties`)
- Node 22.21.x (`.nvmrc` = `v22.21.1`, `gradle.properties` `nodeVersion=22.21.0`)
- `zbb` CLI installed globally (`npm i -g @zerobias-org/zbb`)
- `hub-generator` installed globally or available via npx
- `zb.typescript-collectorbot` plugin available in build-tools (resolved via `../util/packages/build-tools` for local dev or `maven.pkg.github.com/zerobias-org/util` for CI)

## Migration Steps

### 1. Add build.gradle.kts

Create `package/<vendor>/<product>/<collectorbot-name>/build.gradle.kts`:
```kotlin
plugins {
    id("zb.typescript-collectorbot")
}
```

This is how Gradle discovers the collectorbot. The plugin wires up the entire lifecycle.

### 2. Add .mocharc.json (if missing)

Create `package/<vendor>/<product>/<collectorbot-name>/.mocharc.json`:
```json
{
  "extension": ["ts"],
  "require": "tsx",
  "timeout": 6000000
}
```

Used by Gradle's test tasks to run TypeScript tests natively via tsx. The
generous timeout matters: the smoke e2e test invokes `client.run()` which
performs real hub calls and may take minutes. A short (default 2s) timeout
will cut the test off before the collector finishes, masking real flow as
a timeout error.

### 3. Rewrite package.json

**Strip all npm scripts** — Gradle handles the lifecycle. Keep only `clean`:
```json
"scripts": {
  "clean": "rm -rf dist/ generated/"
}
```

**Remove old fields:**
- All build/generate/validate/test/lint/transpile scripts
- `directories` section
- `auditmation` metadata key (use `zerobias` instead)

**Pin all dependencies to exact latest versions (no `^` or `~` or `latest`):**

Run `npm view <pkg> version` to find the latest for each package.

Example (Avigilon Alta Access shape — adapt scope per package):
```json
"dependencies": {
  "@auditlogic/schema-<vendor>-<product>-<sub>": "1.1.6",
  "@auditlogic/schema-<vendor>-<product>-<sub>-ts": "1.1.6",
  "@supercharge/promise-pool": "3.3.0",
  "@zerobias-com/hub-client": "1.0.61",
  "@zerobias-com/platform-sdk": "1.1.12",
  "@zerobias-org/module-<vendor>-<product>-<sub>": "<latest>",
  "@zerobias-org/product-<vendor>-<product>-<sub>": "<latest>",
  "@zerobias-org/types-core-js": "1.2.19",
  "@zerobias-org/util-collector": "1.0.37",
  "inversify": "8.1.0",
  "reflect-metadata": "0.2.2"
}
```

**peerDependencies use caret from latest:**
```json
"peerDependencies": {
  "axios": "^1.13.0"
}
```

**devDependencies — pin to exact latest:**
```json
"devDependencies": {
  "@types/chai": "5.2.3",
  "@types/mocha": "10.0.10",
  "@types/node": "22.0.0",
  "@zerobias-com/hub-client-codegen": "1.0.59",
  "@zerobias-com/hub-secrets-manager": "1.0.56",
  "@zerobias-org/eslint-config": "1.0.36",
  "@zerobias-org/util-codegen": "2.0.44",
  "chai": "4.3.8",
  "mocha": "11.7.5",
  "tsx": "4.21.0",
  "typescript": "5.9.3"
}
```

**Remove from dependencies:**
- `dotenv` — Gradle/zbb manages env
- `nock` — move to devDependencies if still used by tests

**Simplify `files` array:**
```json
"files": [
  "dist",
  "*.yml"
]
```

**Update `zerobias` metadata:**
```json
"zerobias": {
  "package": "<vendor>.<product>.<sub>.collectorbot",
  "dataloader-version": "0.5.4",
  "import-artifact": "collectorbot"
}
```

### 4. Rename test/integration to test/e2e

```bash
mv test/integration test/e2e
```

This aligns with the module pattern where e2e tests live in `test/e2e/`.

### 5. Update .gitignore (at package level if needed)

Ensure these are ignored:
```
node_modules/
dist/
generated/
build/
eslint.config.js
eslint.config.mjs
```

### 6. Major version bump (REQUIRED)

Every collectorbot migrated to Gradle gets a **major version bump**:
- `0.2.9` -> `1.0.0`
- `1.2.0` -> `2.0.0`
- `2.4.1` -> `3.0.0`

### 7. Delete npm-shrinkwrap.json (if present)

Old collectorbots may have `npm-shrinkwrap.json`. Delete it — npm will keep updating the shrinkwrap instead of `package-lock.json`. CI runs `npm ci` which expects `package-lock.json`.

```bash
rm npm-shrinkwrap.json
rm -rf node_modules package-lock.json
npm install
```

### 8. Version for non-main branches

For development branches, set `package.json` version with the branch suffix:
```json
"version": "3.0.0-uat.0"
```

Branch suffix mapping:
- `main` -> no suffix (clean semver)
- `qa` -> `-rc.N`
- `dev` -> `-dev.N`
- `uat` or any other branch -> `-uat.N`

## Validation

After migration, verify:

```bash
cd package/<vendor>/<product>/<collectorbot-name>

# Build (from repo root)
cd ../../../.. && ./gradlew :<vendor>:<product>:<collectorbot-name>:build

# Or using zbb (from package directory)
zbb build

# Unit tests
zbb testUnit

# E2E tests
zbb testDirect

# Full gate
zbb gate

# Lint only
zbb lint
```

### REQUIRED before PR: run `zbb gate` and commit gate-stamp.json

CI validates the `gate-stamp.json` file. If missing or stale, publish fails.

**Always:**
1. Run `zbb gate` after migration is complete
2. Commit the generated `gate-stamp.json` alongside your changes
3. Do NOT gitignore `gate-stamp.json`

## CRITICAL: Package Scope Rules (zerobias-org)

This repo's collectorbots publish under `@zerobias-org/collectorbot-*`. Other content scopes:

| Scope | Rule | Notes |
|-------|------|-------|
| `@zerobias-org/collectorbot-*` | **NO CHANGE** | All collectorbots in this repo stay `@zerobias-org` |
| `@zerobias-org/module-*` | **NO CHANGE** | Open-source modules stay `@zerobias-org` |
| `@zerobias-org/product-*` | **NO CHANGE** | Open-source product catalogs stay `@zerobias-org` |
| `@zerobias-org/vendor-*` | **NO CHANGE** | Open-source vendors stay `@zerobias-org` |
| `@auditlogic/schema-*` | **NO CHANGE** | Schemas stay `@auditlogic` (shared with auditlogic) |
| `@auditmation/*` | -> `@zerobias-org/*` or `@zerobias-com/*` | All utilities move |
| `@auditlogic/product-*` (legacy) | -> `@zerobias-org/product-*` | Product catalogs move to org scope |

**Key difference vs auditlogic/collectorbot:** that repo uses `@auditlogic/collectorbot-*` and `@auditlogic/module-*`. This repo (zerobias-org) uses `@zerobias-org/collectorbot-*` and `@zerobias-org/module-*`. **Do not change package scopes when migrating bots in this repo.**

## Common Issues

### "No such Module" during tests
Version mismatch between dataloader and deployment. Ensure `package.json` version includes the branch suffix.

### npm-shrinkwrap.json must be replaced with package-lock.json
Old collectorbots have `npm-shrinkwrap.json`. npm will keep updating the shrinkwrap instead of `package-lock.json`. **Delete `npm-shrinkwrap.json` first**, then `rm -rf node_modules && npm install`.

### Always fresh install after dependency changes
After modifying `package.json` deps, always `rm -rf node_modules package-lock.json && npm install`.

### node-fetch errors on Node 22
Remove `node-fetch` from dependencies and its import. Node 22 has built-in `fetch`.

### Import errors after ESM migration
All relative imports need `.js` extension. Package imports do not.

### Generated model type renames after codegen upgrade
New codegen may rename types. After regenerating, grep for compile errors and update source references.

### ESM Source Code Updates (if not already ESM)

All relative imports must have `.js` extension:
```typescript
// Before
import { Foo } from './Bar';
// After
import { Foo } from './Bar.js';
```

Replace old package imports:
```
@auditmation/hub-core           -> @zerobias-org/util-connector
@auditmation/util-logger        -> @zerobias-org/logger
@auditmation/types-core         -> @zerobias-org/types-core
@auditmation/types-core-js      -> @zerobias-org/types-core-js
```

## Collectorbot vs Module — Key Differences

| Aspect | Module | Collectorbot |
|--------|--------|-------------|
| Plugin | `zb.typescript-connector` | `zb.typescript-collectorbot` |
| Spec file | `api.yml` | `parameters.yml` + `hub.yml` + `collector.yml` |
| Code gen | `hub-generator` (full API) | `hub-generator` (models only) + `hub-client-codegen` |
| Docker | Yes (builds/runs Docker image) | No (library package) |
| Server | Yes (generates REST server) | No |
| E2E modes | Direct, Docker, Hub | Direct only (test/e2e/) |
| Publish | npm + Docker image | npm only |
