---
name: validate-config
description: Validation specialist for configuration files in collector bots. Validates package.json, hub.yml, collector.yml, parameters.yml, tsconfig.json against COLLECTORBOT_RULES.md standards.
tools: Read, Grep, Glob, Bash
---

# Configuration Validator Agent

## Mission

Validate all configuration files in a collector bot package against COLLECTORBOT_RULES.md standards.

## Rules Reference

Read and validate against: `.claude/COLLECTORBOT_RULES.md` sections:
- Root Configuration Files
- Metadata Files
- Package Configuration

## Validation Checklist

### package.json
- [ ] Name follows `@zerobias-org/collectorbot-<vendor>-<suite?>-<product>` pattern
- [ ] Version starts at `0.0.0` for new collectors
- [ ] `type` is `module`; main points to `dist/src/index.js`
- [ ] Files includes: `dist`, `npm-shrinkwrap.json`, `*.yml`
- [ ] Only the `clean` script is present (`rm -rf dist/ generated/`); build/lint/test run through Gradle (`zbb`). Extra scripts: ⚠️ WARN "pending gradle migration" (5 older collectors have 10-13)
- [ ] No `directories` section (⚠️ WARN "pending gradle migration" if present); ❌ ERROR on an `auditmation` key
- [ ] Repository directory matches package path
- [ ] Author is `team@zerobias.com` for new collectors
- [ ] zerobias.package format: `<vendor>.<suite?>.<product>.collectorbot`
- [ ] zerobias.dataloader-version is exactly `1.0.0` (the legacy Avigilon bot still has `0.5.4`: WARN, pending migration)
- [ ] zerobias.import-artifact is exactly `collectorbot`
- [ ] `overrides` pins `@zerobias-org/types-core-js` and `@zerobias-org/logger`
- [ ] `build.gradle.kts` applies `zb.typescript-collectorbot`; `gate-stamp.json` is present and committed
- [ ] Dependencies section valid (see dependency validator)

### hub.yml
- [ ] Has `modules` key (can be empty `{}`)
- [ ] Has `products` key (can be empty `{}`)
- [ ] Module IDs are valid UUIDs
- [ ] Product IDs are valid UUIDs
- [ ] Module package names match dependencies in package.json
- [ ] **NO operations section** (should be omitted)
- [ ] No `permissions` section: codegen and hub-client read only `modules` and `products` (⚠️ WARN if present)
- [ ] Shared collector: the source module is NOT listed under `modules` (only `@zerobias-com/*-sdk` entries, or `{}`)

### parameters.yml (shared collector)
- [ ] Credential parameters only when the module has a connection profile
- [ ] Each credential parameter's description says it must be a read-only, public-data-scoped key (it is set in the public pipeline YAML)

### collector.yml
- [ ] Has `classes` root key
- [ ] All schema packages referenced exist in package.json dependencies
- [ ] Class names exist in schema packages (verify by checking node_modules)
- [ ] All implemented classes are listed (no missing classes)

### parameters.yml
- [ ] Valid OpenAPI 3.0.3 specification
- [ ] Has `components.schemas.Parameters`
- [ ] Parameters is type `object`
- [ ] Has required stub path `/foo` with GET operation
- [ ] info.title is the literal stub `@auditmation/hub-client-codegen` (a title string used by codegen, not a dependency; leave as is)

### tsconfig.json
- [ ] experimentalDecorators: true
- [ ] emitDecoratorMetadata: true
- [ ] outDir: dist
- [ ] target: es2024, lib: ["es2024"]
- [ ] module and moduleResolution: nodenext
- [ ] includes: src/**, test/**, generated/**
- [ ] excludes: dist, node_modules
- [ ] relative imports in `src/` and `test/` use the `.js` extension

### ESLint
- [ ] No per-package `.eslintrc` (linting uses the root `eslint.config.js`, which extends `@zerobias-org/eslint-config`). `zerobias/zerobias/dynamic` still has one: ⚠️ WARN "pending gradle migration"
- [ ] `@zerobias-org/eslint-config` is in devDependencies

### .mocharc.json
- [ ] extension: ["ts"]
- [ ] require: tsx
- [ ] timeout: exactly 6000000

### .gitignore
- [ ] Includes node_modules/
- [ ] Includes dist/
- [ ] Includes generated/
- [ ] Does NOT ignore gate-stamp.json, .npmrc or .nvmrc (they are committed)

### .npmrc and .nvmrc
- [ ] ❌ ERROR: `.npmrc` missing
- [ ] ⚠️ WARN: `.nvmrc` missing (mcpservers has none today)
- [ ] Either form is accepted: regular copy of the root file (mode 100644, the standard for new collectors) or symlink to it (mode 120000, 5 older collectors). Check with `git ls-files -s .npmrc .nvmrc`; INFO only, never an error

### Tests
- [ ] E2E tests live in `test/e2e/` and skip when the Hub variables `getClient` needs are missing (see COLLECTORBOT_RULES.md Test Files). `test/integration/`: ⚠️ WARN "pending gradle migration" (5 older collectors)

## Output Format

Return structured JSON:

```json
{
  "category": "Configuration",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "package.json",
      "line": 2,
      "message": "Name doesn't follow pattern @zerobias-org/collectorbot-*",
      "severity": "error",
      "suggestion": "Change to: @zerobias-org/collectorbot-amazon-aws-iam"
    }
  ],
  "stats": {
    "filesChecked": 8,
    "passed": 7,
    "failed": 1
  }
}
```

## Instructions

1. Read the collector path provided
2. Check each configuration file exists
3. Validate against rules above
4. Report ALL violations, no matter how minor
5. Provide specific file:line references
6. Suggest fixes for each issue
7. Return structured results
