---
name: validate-mapping
description: Validates src/Mappers.ts for correct field mappings, date/datetime handling (Object.assign), enum mapping, stable ID generation, and required fields.
tools: Read, Grep, Bash, Glob
---

# Mapping Validator Agent

## Mission

Validate field mappings are semantically correct, not nested, enums mapped properly, dates handled correctly.

## Rules Reference

Read: `.claude/ADVANCED_MAPPING_GUIDE.md` sections:
- Field Mapping Strategies
- Date vs DateTime Handling
- Enum Mapping
- ID Generation
- Required Fields

## Validation Checklist

### Mapping Nesting
- [ ] No nested mapper calls within mapper functions (should be flat)
- [ ] Each mapper is a pure function with single responsibility
- [ ] Complex transformations use helper functions, not inline nesting

**BAD - Nested:**
```typescript
export function toUser(source: ModuleUser): SchemaUser {
  return {
    id: source.id,
    manager: toUser(source.manager),  // ❌ NESTED - recursion
    groups: source.groups.map(g => toGroup(g))  // ❌ NESTED - cross-mapper call
  };
}
```

**GOOD - Flat:**
```typescript
export function toUser(source: ModuleUser): SchemaUser {
  return {
    id: source.id,
    manager: source.managerId,  // ✅ Just ID reference
    groups: source.groupIds.sort()  // ✅ Array of IDs
  };
}
```

### Date Handling
- [ ] Check base schema (not TS) to determine date vs datetime
- [ ] Date fields use Object.assign workaround
- [ ] DateTime fields use toISOString()

**Validation process:**
1. Find mapper returning Date type
2. Check corresponding schema base package (node_modules/@auditlogic/schema-*/classes/*.ts)
3. Look for `@Property({ type: 'date' })` vs `@Property({ type: 'datetime' })`
4. Verify correct conversion used

**Report errors:**
```
src/Mappers.ts:45 - dateCreated uses toISOString() but schema expects date (YYYY-MM-DD)
Suggestion: Use Object.assign workaround - see ADVANCED_MAPPING_GUIDE.md Date vs DateTime section
```

### Enum Mapping
- [ ] Enum values match schema enum exactly (case-sensitive)
- [ ] Semantic mapping for different enum names
- [ ] Unmapped enum values handled (error/warn)

**Check:**
1. Find enum assignments in mappers
2. Get schema enum definition from -ts package
3. Verify values match or are semantically mapped
4. Check for unmapped value handling

### ID Generation
- [ ] IDs are stable (derived from source, not random)
- [ ] IDs use natural keys (ARN, email, etc.) when available
- [ ] Composite IDs use consistent order
- [ ] No UUID.generateV4() or random IDs
- [ ] No index-based IDs

### Required Fields
- [ ] Every mapper returns `id` field
- [ ] Every mapper returns `name` field
- [ ] Required fields from schema are all populated

### Semantic Correctness
- [ ] Field names match semantically (userName → name)
- [ ] Descriptions checked when names unclear
- [ ] Type conversions appropriate
- [ ] No obvious mismatches (e.g., status → description)

## Output Format

```json
{
  "category": "Mapping",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "src/Mappers.ts",
      "line": 67,
      "message": "Nested mapping detected: calling toGroup() inside toUser()",
      "severity": "error",
      "suggestion": "Use group IDs instead: groups: source.groupIds.sort()"
    },
    {
      "file": "src/Mappers.ts",
      "line": 89,
      "message": "dateCreated uses toISOString() but schema expects date type (YYYY-MM-DD)",
      "severity": "error",
      "suggestion": "Use Object.assign workaround - see ADVANCED_MAPPING_GUIDE.md"
    },
    {
      "file": "src/Mappers.ts",
      "line": 102,
      "message": "Enum value 'ACTIVE' but schema enum is 'Active'",
      "severity": "error",
      "suggestion": "Change to: status: 'Active'"
    }
  ]
}
```

## Instructions

1. Read all mapper functions in src/Mappers.ts
2. For each mapper:
   - Check for nested calls to other mappers
   - Verify Date vs DateTime handling
   - Verify enum values match schema
   - Verify ID generation is stable
   - Verify required fields present
3. Cross-reference with schema packages
4. Report ALL violations
5. Return structured results
