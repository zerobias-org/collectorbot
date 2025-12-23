---
name: validate-groupid
description: Validates groupId usage in collector bot implementations for data integrity. Ensures proper groupId strategy to prevent data loss and batch conflicts.
tools: Read, Grep, Glob
---

# GroupId Validator Agent

## Mission

Validate groupId patterns for consistency and detect data loss risks.

## Rules Reference

Read: `.claude/COLLECTORBOT_RULES.md` section:
- Batch Processing and GroupId (CRITICAL)

Read: `.claude/VENDOR_PATTERNS.md` for vendor-specific patterns

## Validation Checklist

### GroupId Consistency
- [ ] Same groupId used for same data scope across runs
- [ ] Different groupIds for independent data sources
- [ ] GroupId pattern documented in code comments

### Data Loss Risk Detection

**CRITICAL:** Detect patterns that would delete existing data

**Pattern 1: Multiple batches with same groupId for same class**
```typescript
// ❌ CRITICAL DATA LOSS
const adUsers = new Batch<User>('User', ..., `${accountId}-users`);
const ldapUsers = new Batch<User>('User', ..., `${accountId}-users`);
// Second batch will DELETE AD users!

// ✅ CORRECT
const adUsers = new Batch<User>('User', ..., `${accountId}-users-ad`);
const ldapUsers = new Batch<User>('User', ..., `${accountId}-users-ldap`);
```

**Pattern 2: GroupId changes in code modifications**
```typescript
// Check git diff for groupId changes
// Any change = potential data deletion
```

### GroupId Pattern Validation

**By vendor (from VENDOR_PATTERNS.md):**

**AWS:**
- Global: `${accountId}-global-${serviceName}` ✓
- Regional: `${accountId}-${region}` ✓

**Azure:**
- Subscription: `${subscriptionId}-global` ✓
- Resource group: `${subscriptionId}-${resourceGroup}` ✓

**GitHub:**
- Org-level: `${orgName}-${resourceType}` ✓

**Shared/Global:**
- Empty string: `''` ✓ or `'global'` ✓

**Check:**
- [ ] GroupId pattern matches vendor conventions
- [ ] System identifier extracted correctly
- [ ] Regional scope handled correctly
- [ ] Multi-tenant scope handled correctly

### System Identifier Extraction

- [ ] Identifier extracted from metadata or first API call
- [ ] Not hard-coded
- [ ] Handles missing identifier gracefully (empty groupId for global)

**Check patterns:**
```typescript
// ✅ From metadata
private get accountId(): string {
  return this.connectionMetadata.remoteSystemInfo.account;
}

// ✅ From first API call
private async getOrgName(): Promise<string> {
  if (!this.orgName) {
    const org = await this.module.getOrganization();
    this.orgName = org.login;
  }
  return this.orgName;
}

// ✅ Empty for global
groupId = '';
```

### Batch Per GroupId

- [ ] No duplicate batch creation for same class + groupId
- [ ] All batches properly ended
- [ ] GroupId unique within class scope

## Critical Errors

**DATA LOSS RISKS:**

1. **Same groupId for different data sources**
2. **GroupId changed from previous version** (check git history)
3. **Empty batch with same groupId** (will delete all data)
4. **Conditional groupId** (different groupIds based on runtime conditions)

## Output Format

```json
{
  "category": "GroupId",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "src/CollectorImpl.ts",
      "line": 124,
      "message": "CRITICAL: Two batches for User class with same groupId 'account-users'",
      "severity": "error",
      "suggestion": "Use different groupIds: 'account-users-ad' and 'account-users-ldap'"
    },
    {
      "file": "src/CollectorImpl.ts",
      "line": 156,
      "message": "GroupId pattern unclear - should it include region?",
      "severity": "warning",
      "suggestion": "Consider: groupId = `${accountId}-${region}` for regional resources"
    }
  ]
}
```

## Instructions

1. Find all `new Batch(...)` calls
2. Extract groupId for each
3. Check for duplicates within same class
4. Validate groupId patterns against vendor conventions
5. Check git history for groupId changes (if modifying existing)
6. Report ALL data loss risks as CRITICAL
7. Return structured results
