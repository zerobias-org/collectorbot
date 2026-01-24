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
- [ ] Name follows `@auditlogic/collectorbot-<vendor>-<suite?>-<product>` pattern
- [ ] Version starts at `0.0.0` for new collectors
- [ ] Main points to `dist/src/index.js`
- [ ] Files includes: `dist`, `*.yml`, `*.md`, `dependency-tree.json`
- [ ] All required scripts present and EXACT match to template
- [ ] Repository directory matches package path
- [ ] Author is `ctamas@zerobias.com` for new collectors
- [ ] auditmation.package format: `<vendor>.<suite?>.<product>.collectorbot`
- [ ] auditmation.dataloader-version is exactly `0.5.4`
- [ ] auditmation.import-artifact is exactly `collectorbot`
- [ ] Dependencies section valid (see dependency validator)

### hub.yml
- [ ] Has `modules` key (can be empty `{}`)
- [ ] Has `products` key (can be empty `{}`)
- [ ] Module IDs are valid UUIDs
- [ ] Product IDs are valid UUIDs
- [ ] Module package names match dependencies in package.json
- [ ] **NO operations section** (should be omitted)
- [ ] Permissions section optional (if present, for documentation only)

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
- [ ] info.title is `@com/hub-client-codegen`

### tsconfig.json
- [ ] experimentalDecorators: true
- [ ] emitDecoratorMetadata: true
- [ ] outDir: dist
- [ ] target: ES5
- [ ] module: commonjs
- [ ] includes: src/**, test/**, generated/**
- [ ] excludes: dist, node_modules

### .eslintrc
- [ ] Extends @auditmation
- [ ] Parser is @typescript-eslint/parser
- [ ] max-len code: 150
- [ ] Allows no-await-in-loop, no-continue
- [ ] env includes: commonjs, node, mocha

### .mocharc.json
- [ ] extension: ["ts"]
- [ ] require: ts-node/register
- [ ] timeout: exactly 6000000

### .gitignore
- [ ] Includes node_modules/
- [ ] Includes dist/
- [ ] Includes generated/
- [ ] Does NOT include .npmrc or .nvmrc (they're symlinks)

### .npmrc and .nvmrc
- [ ] Are SYMLINKS (not regular files)
- [ ] Point to correct depth (../../../ or ../../../../ based on structure)
- [ ] Verified with `ls -la`

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
      "message": "Name doesn't follow pattern @auditlogic/collectorbot-*",
      "severity": "error",
      "suggestion": "Change to: @auditlogic/collectorbot-amazon-aws-iam"
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
