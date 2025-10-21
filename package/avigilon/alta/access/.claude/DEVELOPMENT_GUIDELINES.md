# Development Guidelines for Avigilon Alta Access Collector

This document contains best practices and patterns derived from successful development sessions.

## Core Principles

### 1. Incremental Development with Todo Tracking
- Break down complex tasks into discrete, trackable steps
- Use TodoWrite to create a plan upfront, then mark items in_progress/completed as you go
- Example: When adding new entity types (Credentials, Roles), create clear steps:
  1. Add imports
  2. Register classes
  3. Create mapper functions
  4. Implement loader methods
  5. Integrate into run()
  6. Build and test

### 2. Investigation Before Implementation
- Always explore the API/models first before writing code
- Read type definitions to understand what's available
- Check both source models (`@zerobias-org/module-avigilon-alta-access`) and target schemas (`@auditlogic/schema-avigilon-alta-access-ts`)
- Example locations:
  - Source: `node_modules/@zerobias-org/module-avigilon-alta-access/dist/generated/model/*.d.ts`
  - Target: `node_modules/@auditlogic/schema-avigilon-alta-access-ts/src/class/*.ts`
  - APIs: `node_modules/@zerobias-org/module-avigilon-alta-access/dist/generated/api/*.d.ts`

### 3. Consistent Mapper Pattern
Every entity follows the same mapping pattern:

```typescript
export function mapEntity(raw: m.SourceType, ...additionalParams): s.TargetType {
  // 1. Derive/enrich data when possible
  const derivedField = raw.someFlag ? 'Value' : undefined;

  // 2. Build note fields from flags
  const noteParts: string[] = [];
  if (raw.flag1) noteParts.push('Flag 1 Description');
  if (raw.flag2) noteParts.push('Flag 2 Description');
  const note = noteParts.length > 0 ? noteParts.join(' - ') : undefined;

  // 3. Create output object
  const output: s.TargetType = {
    id: `${raw.id}`,
    name: raw.name || `Entity ${raw.id}`,
    // ... other fields
    note,
  };

  // 4. Add dates separately to avoid type issues
  Object.assign(output, {
    dateCreated: raw.createdAt?.toISOString().split('T')[0],
    dateLastModified: raw.updatedAt?.toISOString().split('T')[0],
  });

  return output;
}
```

**Key mapper rules:**
- Always include `dateCreated`/`dateLastModified` from `createdAt`/`updatedAt`
- Use `toISOString().split('T')[0]` for date formatting (YYYY-MM-DD)
- Provide fallback names: `raw.name || \`Entity ${raw.id}\``
- Build readable names from available data (e.g., "Card 123-456")
- Use note fields to capture flags and metadata
- Never use the `metadata` field (reserved for platform use)

### 4. Loader Method Pattern
Every entity type has a dedicated loader method:

```typescript
private async loadEntities(): Promise<void> {
  const entityBatch = await this.initBatchForClass(this.classes.entity, this.orgId);
  const entitiesPr = await this.access.getEntityApi().list(this.orgId);

  await entitiesPr.forEach(async (entity: EntityType) => {
    // Cache if needed for later use
    this.entities.push(entity);

    // Fetch associations if needed
    const associations = await this.fetchAssociations(entity.id);

    // Add to batch with raw object
    await entityBatch.add(mapEntity(entity, associations), entity);
  }, 3, this.previewCount);

  await entityBatch.end();
}
```

**Key loader rules:**
- Always use concurrency of 3: `forEach(async (item) => {...}, 3, this.previewCount)`
- Always pass raw object as second parameter: `batch.add(mapped, raw)`
- Use `PromisePool` for arrays: `await PromisePool.for(items).withConcurrency(3)`
- Respect preview mode with `slice(0, this.previewCount)`
- Use try/catch for non-critical operations, log warnings on failure
- Cache entities if they're needed later (users, groups, entries for access rules)

### 5. Fix Issues Immediately
- When a problem is identified, fix it right away
- Run `npm run build && npm run lint` after every significant change
- Don't accumulate technical debt - address it in the moment
- Example: Redundant code like `raw.userId ? \`${raw.userId}\` : undefined` should be simplified to `raw.userId` immediately

### 6. Performance Awareness
- **Identify N+1 patterns**: Making 1 API call per item in a loop
  - Sometimes acceptable (MFA check: 1 call per user)
  - Sometimes fixable (schedule pre-fetching instead of per-entry calls)
- **Use Sets for deduplication**: `new Set<string>()` during collection
- **Convert to sorted Arrays**: `Array.from(set).sort()` for output consistency
- **Respect preview mode**: `items.slice(0, this.previewCount)`
- **Cache when needed**: Store frequently-accessed data to avoid repeated API calls

### 7. Error Handling Strategy
```typescript
// Critical operations - throw errors
if (!this._orgId) {
  throw new InvalidStateError('Organization ID is not set');
}

// Non-critical operations - log warnings and continue
try {
  const mfaCredsPr = await this.access.getUserApi().listMfaCredentials(this.orgId, user.id);
  // ... process
} catch (error) {
  this.logger.warn(`Could not retrieve MFA credentials for user ${user.id}: ${error.message}`);
}

// Batch processing - handle errors per item
await PromisePool.for(items)
  .withConcurrency(3)
  .handleError(async (error, item) => {
    await batch.error(`Error processing item ${item.id}`, error);
  })
  .process(async (item) => {
    // ... process item
  });
```

### 8. Type Safety First
- Use explicit type imports: `import type { OrgCredential, RoleInfo }`
- Add type annotations to resolve linter warnings: `(credential: OrgCredential)`
- Never use `any` - always find the proper type
- Use union types appropriately: `string | undefined`
- Avoid unnecessary type assertions - prefer type guards

### 9. Build Incrementally, Test Frequently
1. Make one logical change at a time
2. Run `npm run build && npm run lint` after each change
3. Fix TypeScript errors before moving to next feature
4. Don't batch multiple unrelated changes before testing

### 10. Learn from the Codebase
- Follow existing patterns (e.g., how Groups fetch members, how Sites use PromisePool)
- Use the same error handling approach as existing code
- Match the concurrency level (3) used elsewhere
- Keep consistent code style and naming conventions

## Anti-Patterns to Avoid

❌ **Don't guess at property names** - Always check type definitions
❌ **Don't batch multiple unrelated changes** - Test after each logical change
❌ **Don't implement without understanding** - Read the data model first
❌ **Don't ignore linter warnings** - They often reveal real issues
❌ **Don't overthink** - If the task is clear, just do it
❌ **Don't use template literals unnecessarily** - `raw.userId` not `\`${raw.userId}\``
❌ **Don't check `undefined` when already optional** - `raw.field` not `raw.field ? raw.field : undefined`

## Project-Specific Conventions

### Execution Order in run()
The order matters for data dependencies:
1. Users (needed for roles, access rules, credentials)
2. Groups (needed for access rules)
3. Sites (needed for zones, roles)
4. Zones (needed for entries, access rules)
5. Entries (needed for schedules, access rules)
6. Credentials (independent)
7. Roles (needs users as assignees)
8. Entry Schedules (needs entries loaded)
9. Access Rules (needs users, groups, entries, zones, sites, schedules)

### Memory Management
```typescript
try {
  // Use cached data
  await this.processWithCachedData();
} finally {
  // Release memory after processing
  this.users = [];
  this.groups = [];
  this.entries = [];
  this.entryUserScheduleMap.clear();
}
```

### Getter/Setter Pattern for Required Fields
```typescript
private _orgId?: string;

get orgId(): string {
  if (!this._orgId) {
    throw new InvalidStateError('Organization ID is not set');
  }
  return this._orgId;
}

set orgId(value: string | undefined) {
  this._orgId = value;
}
```
This eliminates the need for non-null assertions (`this.orgId!`) throughout the code.

## Key Takeaway

**"Read first, plan second, implement third, verify fourth"**

Success comes from:
1. Understanding the problem space before writing code
2. Breaking work into clear, trackable steps
3. Validating each change immediately
4. Following established patterns consistently
