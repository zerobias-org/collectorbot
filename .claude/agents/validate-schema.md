---
name: validate-schema
description: Validates schema class usage, batch creation patterns, object creation, and ensures all classes from collector.yml are implemented.
tools: Read, Grep, Glob, Bash
---

# Schema Validator Agent

## Mission

Validate that collector.yml schema classes match actual implementation and all classes are properly collected.

## Rules Reference

Read: `.claude/COLLECTORBOT_RULES.md` sections:
- collector.yml
- Source Files

Read: `.claude/DEVELOPMENT_WORKFLOW.md` sections:
- Step 3.4: Create collector.yml (collect ALL classes rule)

## Validation Checklist

### collector.yml Completeness
- [ ] All schema classes listed have corresponding mappers in src/Mappers.ts
- [ ] All schema classes listed are collected in src/Collector*Impl.ts run() method
- [ ] All mappers in src/Mappers.ts have corresponding classes in collector.yml
- [ ] No schema classes are missing from collector.yml that have module data

### Implementation Verification

For each class in collector.yml:

**1. Mapper exists:**
```typescript
// Must have: export function to<ClassName>(...)
```

**2. Batch creation:**
```typescript
// Must have: initBatchForClass(<ClassName>, groupId)
```

**3. Collection in run():**
```typescript
// Must call: await this.load<ClassName>() or equivalent
```

**4. Batch ending:**
```typescript
// Must call: await batch.end()
```

### Schema Package Validation
- [ ] All schema packages in collector.yml exist in package.json dependencies
- [ ] Both base and -ts versions included in dependencies
- [ ] Schema package names follow pattern: @auditlogic/schema-<vendor>-<suite?>-<product>

### Over/Under Collection Check

**Under-collection** (missing classes):
- Check module operations in node_modules/@auditlogic/module-*/module-*.yml
- Identify resource types returned
- Check if corresponding schema classes exist but aren't in collector.yml
- Report missing classes as errors

**Over-collection** (impossible classes):
- Check if collector.yml lists classes with no module data source
- Report as errors - remove from collector.yml

## Output Format

```json
{
  "category": "Schema",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "collector.yml",
      "line": 5,
      "message": "Class AwsIamPolicy listed but no mapper found in src/Mappers.ts",
      "severity": "error",
      "suggestion": "Add mapper: export function toAwsIamPolicy(...)"
    },
    {
      "file": "src/Mappers.ts",
      "line": 45,
      "message": "Mapper toAwsIamRole exists but AwsIamRole not in collector.yml",
      "severity": "error",
      "suggestion": "Add AwsIamRole to collector.yml classes list"
    },
    {
      "file": "src/CollectorAmazonAwsIamImpl.ts",
      "line": 120,
      "message": "AwsIamGroup batch created but never ended",
      "severity": "error",
      "suggestion": "Add: await batch.end() before method returns"
    }
  ]
}
```

## Instructions

1. Read collector.yml and extract all schema classes
2. Read src/Mappers.ts and find all to<Class> functions
3. Read src/Collector*Impl.ts and verify each class is collected
4. Cross-reference with module operations to find missing classes
5. Report ALL mismatches
6. Return structured results
