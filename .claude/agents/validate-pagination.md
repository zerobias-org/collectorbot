---
name: validate-pagination
description: Validates pagination parameters, preview mode implementation, and pageSize optimization in collector bot implementations.
tools: Read, Grep, Glob
---

# Pagination Validator Agent

## Mission

Ensure all data pages are processed (no data loss) and pagination is optimized.

## Rules Reference

Read: `.claude/ADVANCED_MAPPING_GUIDE.md` sections:
- Batch Management Patterns
- Performance Optimization (Pagination Parameter Optimization)

Read: `.claude/VENDOR_PATTERNS.md` for vendor-specific page size limits

## Validation Checklist

### Complete Data Collection (NO DATA LOSS)

**Critical checks:**

**1. forEach with limit parameter:**
```typescript
// ❌ WRONG - only processes first 10 items total!
await resources.forEach(async (r) => { ... }, undefined, 10);

// ✅ CORRECT - processes all items (10 limit only for preview mode)
await resources.forEach(async (r) => { ... }, undefined, this.previewCount);
```

**2. Pagination loops complete:**
```typescript
// ❌ WRONG - only processes first page!
const resources = await this.module.list();
await resources.forEach(async (r) => { ... });
// Missing hasNext() check!

// ✅ CORRECT - processes all pages
const resources = await this.module.list();
await resources.forEach(async (r) => { ... });
// forEach internally handles pagination

// ✅ ALSO CORRECT - manual pagination
let page = 1;
let hasMore = true;
while (hasMore) {
  const resources = await this.module.list(undefined, page, 1000);
  await resources.forEach(async (r) => { ... });
  hasMore = resources.hasNext();
  page++;
}
```

**3. Preview mode doesn't prevent full collection:**
```typescript
// Check previewCount is ONLY used in preview mode
if (!this.context.previewMode && this.previewCount) {
  // ❌ ERROR - limiting full collection!
}
```

**4. Nested iteration doesn't skip data:**
```typescript
// Parent-child collection
await parents.forEach(async (parent) => {
  const children = await this.module.getChildren(parent.id);
  await children.forEach(async (child) => { ... }, concurrency, this.previewCount);
  // ✅ Both loops should process all pages
});
```

### Pagination Optimization

**1. Page size optimization:**
```typescript
// ❌ BAD - using default (50 items per page)
const resources = await this.module.list();

// ⚠️ SUBOPTIMAL - small page size
const resources = await this.module.list(undefined, 1, 100);

// ✅ GOOD - optimized page size
const resources = await this.module.list(undefined, 1, 1000);
```

**Check:**
- [ ] Page size specified in list/search calls
- [ ] Page size is ≥1000 (unless vendor limit is lower)
- [ ] Vendor-specific limits respected (GitHub: 100, AWS: 1000)

**2. Unnecessary pagination:**
```typescript
// ❌ INEFFICIENT - manual pagination when module handles it
let page = 1;
while (hasMore) {
  const resources = await this.module.list(undefined, page, 1000);
  // ...
  page++;
}

// ✅ BETTER - let forEach handle pagination
const resources = await this.module.list(undefined, 1, 1000);
await resources.forEach(async (r) => { ... });
// forEach automatically handles all pages
```

### Preview Mode Implementation

- [ ] previewCount calculated correctly:
  ```typescript
  private previewCount?: number = this.context.previewMode
    ? (this.context.previewCount || 10)
    : undefined;
  ```
- [ ] Preview count passed to forEach: `forEach(callback, concurrency, this.previewCount)`
- [ ] Preview count applied per-batch, not total
- [ ] Preview count applied per-source when collecting from multiple sources

## Data Loss Patterns (CRITICAL ERRORS)

### Pattern 1: Only First Page
```typescript
// ❌ CRITICAL - DATA LOSS
const users = await this.module.listUsers(undefined, 1, 50);
// Only gets first 50 users, rest are lost!

await users.forEach(async (user) => {
  await batch.add(toUser(user), user);
});
// No pagination loop!
```

### Pattern 2: Hard-coded Limit
```typescript
// ❌ CRITICAL - DATA LOSS in production
await users.forEach(async (user) => {
  await batch.add(toUser(user), user);
}, undefined, 10);  // ALWAYS limits to 10!
// Should be: this.previewCount
```

### Pattern 3: Missing hasNext() Check
```typescript
// ❌ CRITICAL - might miss pages
if (resources.length > 0) {  // WRONG check
  // Process
}

// ✅ CORRECT
while (resources.hasNext()) {
  // Process next page
}
```

## Output Format

```json
{
  "category": "Pagination",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "src/CollectorImpl.ts",
      "line": 145,
      "message": "CRITICAL: Data loss - only processing first page of users",
      "severity": "error",
      "suggestion": "forEach automatically handles pagination - verify module.listUsers returns PagedResults"
    },
    {
      "file": "src/CollectorImpl.ts",
      "line": 167,
      "message": "Suboptimal: pageSize is 50 (default), should be 1000",
      "severity": "warning",
      "suggestion": "Change to: this.module.list(undefined, 1, 1000)"
    }
  ]
}
```

## Instructions

1. Find all module API calls that return lists
2. Verify each call processes ALL pages
3. Check pageSize parameters are optimized
4. Verify preview mode doesn't cause data loss in production
5. Check nested iteration handles pagination correctly
6. Report ALL data loss risks as CRITICAL
7. Return structured results
