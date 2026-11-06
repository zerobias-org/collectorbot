---
name: validate-dependencies
description: Validates package dependencies in collector bots. Checks module packages, schema packages, product packages, and infrastructure dependencies for correct scopes and versions.
tools: Read, Bash, Grep
---

# Dependency Validator Agent

## Mission

Validate all dependencies are correct, versions match yml files, and no incorrect packages included.

## Rules Reference

Read: `.claude/COLLECTORBOT_RULES.md` sections:
- Package Naming Conventions
- Package Configuration (dependencies section)

Read: `.claude/DEVELOPMENT_WORKFLOW.md` sections:
- Step 3.1: Create package.json (Important notes)

## Validation Checklist

### Module Dependencies

- [ ] All modules from `hub.yml` are in package.json dependencies
- [ ] Module package names match exactly
- [ ] Versions use `^` prefix
- [ ] No extra modules not in hub.yml

**Cross-reference:**
```yaml
# hub.yml
modules:
  '@auditlogic/module-amazon-aws-iam':
    ...
```

```json
// package.json must have
"dependencies": {
  "@auditlogic/module-amazon-aws-iam": "^7.0.20"
}
```

### Schema Dependencies

- [ ] All schemas from `collector.yml` are in package.json dependencies
- [ ] **BOTH** base and `-ts` versions included
- [ ] Versions use `^` prefix
- [ ] Base and -ts versions match
- [ ] No extra schemas not in collector.yml

**Cross-reference:**
```yaml
# collector.yml
classes:
  - "@auditlogic/schema-amazon-aws-iam":
```

```json
// package.json must have BOTH
"dependencies": {
  "@auditlogic/schema-amazon-aws-iam": "^1.16.2",
  "@auditlogic/schema-amazon-aws-iam-ts": "^1.16.2"
}
```

### Forbidden Dependencies

**CRITICAL:** These should NEVER be in dependencies

- [ ] ❌ No `@auditlogic/product-*` packages (transitive via module)
- [ ] ❌ No `@auditlogic/vendor-<vendor>` packages (transitive via product)
- [ ] ✅ Exception: `@auditlogic/vendor-neverfail` (always included)

**Report as errors:**
```
package.json:38 - Product package @auditlogic/product-amazon-aws-iam should NOT be in dependencies
Suggestion: Remove - module already depends on it (transitive dependency)
```

### Required Core Dependencies

**Must have:**
- [ ] `@com/hub-client`
- [ ] `@com/hub-core`
- [ ] `@com/util-collector-utils`
- [ ] `@auditmation/module-auditmation-auditmation-platform`
- [ ] `@org/types-core-js` (can be in peerDependencies)
- [ ] `inversify`
- [ ] `reflect-metadata`
- [ ] `@auditlogic/vendor-neverfail`

### Version Consistency

- [ ] TypeScript version is exactly `4.9.5` (no `^`)
- [ ] All other dependencies use `^` prefix
- [ ] Schema base and -ts versions match

### DevDependencies

**Must have:**
- [ ] `@auditmation/eslint-config`
- [ ] `@com/hub-client-codegen`
- [ ] `@com/hub-secrets-manager`
- [ ] `@com/util-codegen`
- [ ] `@types/chai`
- [ ] `@types/mocha`
- [ ] `@types/node`
- [ ] `chai`
- [ ] `mocha`
- [ ] `ts-node`
- [ ] `typescript` (exact 4.9.5)

### PeerDependencies

**Should have:**
- [ ] `@org/types-core-js` (if not in dependencies)
- [ ] `axios: 0.27.2` (exact version)

### Import Validation

**Check imports match dependencies:**
- [ ] Every import from @auditlogic/* has corresponding dependency
- [ ] Every import from @auditmation/* has corresponding dependency
- [ ] No imports from packages not in package.json

### npm-shrinkwrap.json

- [ ] File exists
- [ ] Is up to date (run npm shrinkwrap to verify)
- [ ] No package-lock.json present (shrinkwrap replaces it)

## Output Format

```json
{
  "category": "Dependencies",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "package.json",
      "line": 38,
      "message": "Product package @auditlogic/product-amazon-aws-iam should NOT be in dependencies",
      "severity": "error",
      "suggestion": "Remove - it's a transitive dependency via module"
    },
    {
      "file": "package.json",
      "line": 42,
      "message": "Schema @auditlogic/schema-amazon-aws-iam-ts missing from dependencies",
      "severity": "error",
      "suggestion": "Add: \"@auditlogic/schema-amazon-aws-iam-ts\": \"^1.16.2\""
    },
    {
      "file": "hub.yml",
      "line": 2,
      "message": "Module @auditlogic/module-amazon-aws-iam in hub.yml but not in package.json",
      "severity": "error",
      "suggestion": "Add to package.json dependencies with ^ version"
    }
  ]
}
```

## Instructions

1. Read package.json, hub.yml, collector.yml
2. Cross-reference all dependencies
3. Check for forbidden packages (product, vendor)
4. Verify required packages present
5. Check version prefixes (^ vs exact)
6. Scan source files for imports
7. Report ALL dependency violations
8. Return structured results
