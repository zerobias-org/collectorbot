# Advanced Mapping & Validation Guide

This document covers complex topics for autonomous collector development: schema validation, field mapping, type conversions, relationships, and edge cases.

## Table of Contents

1. [Schema Validation & Type Safety](#schema-validation--type-safety)
2. [Field Mapping Strategies](#field-mapping-strategies)
3. [Date vs DateTime Handling](#date-vs-datetime-handling)
4. [Enum Mapping](#enum-mapping)
5. [ID Generation](#id-generation)
6. [Object Relationships & Links](#object-relationships--links)
7. [Required Fields](#required-fields)
8. [When Mapping Fails](#when-mapping-fails)
9. [Default Values](#default-values)
10. [Batch Management Patterns](#batch-management-patterns)
11. [Performance Optimization](#performance-optimization)
12. [Incremental Collection Patterns](#incremental-collection-patterns)
13. [Retry Logic & Resilience](#retry-logic--resilience)

---

## Schema Validation & Type Safety

### Understanding Schema Structure

Each schema has TWO packages:
1. **Base schema** (`@auditlogic/schema-<vendor>-<product>`) - Runtime definitions with full metadata
2. **TypeScript schema** (`@auditlogic/schema-<vendor>-<product>-ts`) - Generated TypeScript interfaces

**CRITICAL:** TypeScript interfaces are INCOMPLETE for validation. Always cross-reference with base schema.

### Validation Process

**Step 1: Check TypeScript Interface**
```bash
cat node_modules/@auditlogic/schema-<vendor>-<product>-ts/dist/index.d.ts
```

Look for:
- Required vs optional fields (`?`)
- Field types
- Enum definitions

**Step 2: Check Base Schema**
```bash
# Find the class/interface definition
cat node_modules/@auditlogic/schema-<vendor>-<product>/classes/MyClass.ts
# OR
cat node_modules/@auditlogic/schema-<vendor>-<product>/interfaces/MyInterface.ts
```

Look for:
- Field types (date vs datetime distinction!)
- `linkTo` definitions
- Extended interfaces
- Constraints and validations

**Step 3: Check Extended Interfaces**
If the interface extends another:
```typescript
export interface AwsIamUser extends AwsPrincipal {
  // ...
}
```

Check the parent interface (might be in a dependency):
```bash
# Check package.json for dependencies
cat node_modules/@auditlogic/schema-<vendor>-<product>/package.json

# Find parent interface
cat node_modules/@auditlogic/schema-<parent-package>/interfaces/AwsPrincipal.ts
```

### Main Validation Concerns

| Concern | How to Validate | Impact if Wrong |
|---------|----------------|-----------------|
| **Required fields** | Check for `?` in TS interface | Collection fails - object rejected |
| **Field types** | Check base schema (TS can be wrong for dates!) | Collection fails - type mismatch |
| **Enum values** | Check TS enum or string literal types | Collection fails - invalid enum |
| **Date format** | Check base schema: `date` vs `datetime` | Collection fails - format mismatch |
| **Link targets** | Check base schema `linkTo` | Links broken - data integrity issue |

---

## Field Mapping Strategies

### Semantic Matching Process

**Goal:** Match source fields to schema fields semantically, not just by name.

**Step 1: Identify Obvious Matches**
```typescript
// Module type
interface ModuleUser {
  userName: string;
  emailAddress: string;
  createdAt: Date;
}

// Schema type
interface SchemaUser {
  name: string;
  email: string;
  dateCreated: string;
}

// Mapping (obvious)
return {
  name: source.userName,        // userName → name
  email: source.emailAddress,   // emailAddress → email
  dateCreated: toDate(source.createdAt)  // createdAt → dateCreated (with conversion)
};
```

**Step 2: Handle Semantic Differences**
```typescript
// Source has separate fields
interface ModuleUser {
  firstName: string;
  lastName: string;
}

// Schema expects combined
interface SchemaUser {
  name: string;
}

// Mapping (semantic)
return {
  name: `${source.firstName} ${source.lastName}`.trim()
};
```

**Step 3: Handle Nested vs Flat**
```typescript
// Source is nested
interface ModuleResource {
  metadata: {
    created: Date;
    owner: string;
  }
}

// Schema is flat
interface SchemaResource {
  dateCreated: string;
  owner: string;
}

// Mapping (flatten)
return {
  dateCreated: toDate(source.metadata.created),
  owner: source.metadata.owner
};
```

**Step 4: Read Descriptions When Names Don't Match**

Check both module API spec and schema JSDoc:
```bash
# Module operation response (check your actual module scope)
cat node_modules/@zerobias-org/module-<vendor>/module-<vendor>.yml
# OR
cat node_modules/@auditlogic/module-<vendor>/module-<vendor>.yml
# Look at response schema descriptions

# Schema field descriptions (always @auditlogic)
cat node_modules/@auditlogic/schema-<vendor>-ts/dist/index.d.ts
# Check JSDoc comments
```

If descriptions indicate semantic equivalence, map even if names differ.

---

## Date vs DateTime Handling

### The Problem

**TypeScript generates BOTH as `Date`** but the schema expects different formats:
- `date` → String in format `YYYY-MM-DD`
- `datetime` → ISO 8601 string with time

### Detection

**Check base schema to distinguish:**
```bash
cat node_modules/@auditlogic/schema-<vendor>/classes/MyClass.ts
```

Look for field definitions:
```typescript
// This is a DATE (not datetime)
@Property({ type: 'date' })
dateCreated: string;

// This is a DATETIME
@Property({ type: 'datetime' })
lastModified: string;
```

### Conversion Patterns

**For datetime (ISO 8601):**
```typescript
function toDateTime(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

// Usage
dateLastModified: toDateTime(source.updatedAt)
```

**For date (YYYY-MM-DD):**

**WRONG (doesn't work due to TypeScript type checking):**
```typescript
// This fails TypeScript validation
dateCreated: source.createdAt?.toISOString().split('T')[0]
```

**CORRECT (using Object.assign workaround):**
```typescript
// Pattern found in existing collectors
function toDate(date: Date | undefined): any {
  if (!date) return undefined;
  return Object.assign(
    new Date(date.toISOString().split('T')[0]),
    date.toISOString().split('T')[0]
  );
}

// Usage
return {
  id: source.id,
  name: source.name,
  dateCreated: toDate(source.createdAt),
  // ... other fields
};
```

**Why Object.assign?** This workaround satisfies both:
- TypeScript type checker (expects Date)
- Runtime schema validator (expects string YYYY-MM-DD)

### Helper Function Template

```typescript
import { Date as SchemaDate } from '@auditlogic/schema-<vendor>-ts';

// For date fields
function toDate(date?: Date): SchemaDate | undefined {
  if (!date) return undefined;
  return Object.assign(
    new Date(date.toISOString().split('T')[0]),
    date.toISOString().split('T')[0]
  ) as SchemaDate;
}

// For datetime fields
function toDateTime(date?: Date): string | undefined {
  return date?.toISOString();
}
```

---

## Enum Mapping

### Finding Enum Definitions

**In TypeScript schema package:**
```bash
cat node_modules/@auditlogic/schema-<vendor>-<product>-ts/dist/index.d.ts
```

**Two formats:**

**1. String Literal Union:**
```typescript
export interface User {
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}
```

**2. Exported Enum:**
```typescript
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED'
}

export interface User {
  status: UserStatus;
}
```

### Mapping Strategies

**Case 1: Direct Match**
```typescript
// Source and schema have same values
sourceStatus: 'ACTIVE' | 'INACTIVE'
schemaStatus: 'ACTIVE' | 'INACTIVE'

// Mapping
return {
  status: source.status  // Direct assignment
};
```

**Case 2: Case Conversion**
```typescript
// Source is lowercase, schema is uppercase
sourceStatus: 'active' | 'inactive'
schemaStatus: 'ACTIVE' | 'INACTIVE'

// Mapping
return {
  status: source.status?.toUpperCase() as SchemaStatus
};
```

**Case 3: Semantic Mapping**
```typescript
// Source uses different terms
sourceStatus: 'enabled' | 'disabled'
schemaStatus: 'ACTIVE' | 'INACTIVE'

// Mapping (explicit map)
const statusMap: Record<string, SchemaStatus> = {
  'enabled': 'ACTIVE',
  'disabled': 'INACTIVE'
};

return {
  status: statusMap[source.status]
};
```

**Case 4: Boolean to Enum**
```typescript
// Source is boolean
sourceEnabled: boolean
schemaStatus: 'ACTIVE' | 'INACTIVE'

// Mapping
return {
  status: source.enabled ? 'ACTIVE' : 'INACTIVE'
};
```

**Case 5: Unmapped Value**
```typescript
// Source has value not in schema enum
const statusMap: Record<string, SchemaStatus> = {
  'enabled': 'ACTIVE',
  'disabled': 'INACTIVE'
};

const mappedStatus = statusMap[source.status];

if (!mappedStatus && source.status) {
  // Add warning - unexpected value encountered
  await batch.warn(`Unknown status value: ${source.status}`, source);
  return; // Skip this item
}

return {
  status: mappedStatus || 'INACTIVE'  // Default fallback
};
```

---

## ID Generation

### Priority Order

When generating IDs, use this priority:

1. **Use source ID if exists**: `source.id` or `source.identifier`
2. **Use natural key**: Unique business identifier (ARN, email, etc.)
3. **Use composite key**: Combination of fields that guarantee uniqueness
4. **Last resort**: Generate from hash (rare, avoid if possible)

### Patterns by Vendor

**AWS (ARN pattern):**
```typescript
// Source has ARN - use it
return {
  id: source.arn.toString(),  // ARN is unique and stable
  arn: source.arn,
  // ...
};
```

**Composite Key:**
```typescript
// No single unique field - combine multiple
return {
  id: `${source.accountId}:${source.region}:${source.resourceId}`,
  // ...
};
```

**Email/Username:**
```typescript
// Email is unique - use it
return {
  id: source.email,
  email: source.email,
  // ...
};
```

**Type + Name:**
```typescript
// Combination of type and name is unique
return {
  id: `${source.type}:${source.name}`,
  // ...
};
```

### ID Stability

**CRITICAL:** IDs must be **stable across collections**. Same entity = same ID every time.

**Bad (don't do this):**
```typescript
// Changes every collection!
id: UUID.generateV4()
```

**Bad (don't do this):**
```typescript
// Order-dependent!
id: `user-${index}`
```

**Good:**
```typescript
// Stable - derived from source data
id: source.email || source.username || `${source.firstName}-${source.lastName}`
```

### Uncertain Mappings - The TODO Pattern

**RULE:** When semantic mapping is unclear, add TODO comment and ask user at completion.

**Step 1: Add TODO comment in code**
```typescript
export function toResource(source: ModuleResource): SchemaResource {
  // TODO: Unable to determine semantic mapping for:
  // - source.obscureCode (string) - unclear which schema field this represents
  // - source.priorityLevel (number 1-10) - schema expects enum HIGH/MEDIUM/LOW

  return {
    id: source.id || `${source.type}:${source.name}`,
    name: source.name,
    description: source.description,
    // Map what IS clear
    createdDate: toDate(source.created),
    status: mapStatus(source.status),
    // Skip ambiguous fields for now
  };
}
```

**Step 2: Continue with other mappers**

Complete ALL clear mappings first.

**Step 3: At end of implementation, ask user**

After completing the collector:
```
Collector implementation complete. I need clarification on these field mappings:

1. **Resource.obscureCode** (string): What schema field should this map to?
   - Options I see: resourceCode, externalId, identifier

2. **Priority mapping** (number 1-10 → enum): How should I map?
   - 1-3 → LOW?
   - 4-7 → MEDIUM?
   - 8-10 → HIGH?

3. **NestedConfig** (complex object): Which subset/fields should be extracted?

Please provide guidance and I'll complete these mappings.
```

### When Source Has No Unique Identifier

**Think creatively** - what makes this entity unique?
```typescript
// Example: AWS IAM Policy without ID
// Use policy ARN which is unique
id: policy.arn.toString()

// Example: User without ID but has unique email
id: user.emailAddress

// Example: Resource with type + name uniqueness
id: `${resource.resourceType}/${resource.resourceName}`

// Example: Nested resource with parent relationship
id: `${parentId}/child/${resource.name}`
```

**Last resort - ask user:**
```typescript
// If no clear unique identifier exists
// Add comment and continue
// TODO: Verify ID generation - no clear unique identifier in source
// Using combination of: ${field1}, ${field2}
id: `${source.field1}-${source.field2}`
```

---

## Object Relationships & Links

### Understanding linkTo

Relationships between objects are defined in the **base schema package** (not TypeScript).

### Finding Link Definitions

**Step 1: Locate the interface file**
```bash
# Check both locations
ls node_modules/@auditlogic/schema-<vendor>/classes/
ls node_modules/@auditlogic/schema-<vendor>/interfaces/
```

**Step 2: Read the interface definition**
```bash
cat node_modules/@auditlogic/schema-<vendor>/classes/User.ts
```

**Step 3: Look for linkTo**
```typescript
export interface User {
  id: string;
  name: string;

  // Single relationship
  groups: {
    linkTo: 'Group',  // Links to Group class
    // No type specified - infer from property type
  }

  // Could also be
  manager: {
    linkTo: 'User',  // Self-referential
  }
}
```

**Step 4: Check property type for single vs multi**

In TypeScript interface:
```typescript
// Single relationship
manager: string;  // linkTo: 'User'

// Multi relationship
groups: string[];  // linkTo: 'Group'
```

### Link Property Structure

**Format:**
```typescript
propertyName: {
  linkTo: 'TargetClassName',
  // Sometimes with non-ID matching:
  linkTo: 'TargetClassName.propertyName'  // Match on specific property
}
```

**Examples:**
```typescript
// Link by ID (most common)
groups: {
  linkTo: 'Group'  // Matches Group.id
}

// Link by specific property
owner: {
  linkTo: 'User.email'  // Matches User.email (not User.id)
}
```

### Determining Link Property

**RULE:** Use the property specified in `linkTo`, otherwise use `id`.

**Example 1: Clear non-ID property**
```typescript
// Schema definition
owner: {
  linkTo: 'User.email'  // CLEAR: use email property
}

// Mapping
return {
  id: resource.id,
  owner: source.ownerEmail  // Use email as specified
};
```

**Example 2: No property specified**
```typescript
// Schema definition
owner: {
  linkTo: 'User'  // No property specified - defaults to id
}

// Mapping
return {
  id: resource.id,
  owner: source.ownerId  // Use ID
};
```

**Example 3: Ambiguous property**
```typescript
// Schema definition
assignedTo: {
  linkTo: 'User.identifier'  // "identifier" could be id, email, or username
}

// Check User schema to see what "identifier" field is
// Then use the appropriate source field
```

**Broken Links are OK:**
If the target entity doesn't exist yet or was deleted, the link will be null/broken. This is acceptable - don't fail the collection.

### Implementing Links

**Single Link:**
```typescript
// Source has manager email
// Schema expects manager: string (linkTo: 'User.email')

return {
  id: user.id,
  name: user.name,
  manager: source.managerEmail  // Will link to User with this email
};
```

**Multi Link:**
```typescript
// Source has array of group IDs
// Schema expects groups: string[] (linkTo: 'Group')

return {
  id: user.id,
  name: user.name,
  groups: source.groupIds.sort()  // Alphabetically sorted for consistency
};
```

### Link Ordering

**CRITICAL:** When populating array links, **sort alphabetically** for consistency.

```typescript
// Good
groups: source.groupIds.sort()

// Bad
groups: source.groupIds  // Unsorted - could cause unnecessary updates
```

**Why?** Prevents detecting false changes when array order differs but content is same.

### One-Sided Links

If both entities reference each other, **only populate ONE side**.

**Example:**
- User has `groups: string[]` (linkTo: 'Group')
- Group has `members: string[]` (linkTo: 'User')

**Choose ONE:**

**Option A: Single-link side (preferred)**
```typescript
// Populate User.groups (User has ONE manager, many groups)
// Leave Group.members empty - system will infer

return {
  // User
  id: user.id,
  groups: groupIds.sort()
};

return {
  // Group
  id: group.id,
  // members: OMIT - will be inferred from User.groups
};
```

**Option B: Clear logic**
If no clear "single link side", use the one that makes more sense semantically:
- Parent → Child links usually on child
- Ownership links usually on owned entity
- Membership links usually on member

**Rule:** Check existing collectors for this schema to see which side they use.

### Extended Interfaces & Links

Links can be defined in parent interfaces:

```typescript
// Parent interface
export interface AwsPrincipal {
  accessRules: {
    linkTo: 'AwsIamPolicy'
  }
}

// Child interface
export interface AwsIamUser extends AwsPrincipal {
  // Inherits accessRules link
  groups: {
    linkTo: 'AwsIamGroup'
  }
}
```

**Check the entire inheritance chain** when discovering links.

---

## Required Fields

### Always Required

**Per schema convention:**
- `id` - ALWAYS required
- `name` - ALWAYS required (unless schema explicitly marks optional)

**If source lacks these:**

**ID - Must generate:**
```typescript
// See ID Generation section above
id: source.id || source.arn || `${source.type}:${source.name}`
```

**Name - Must generate or derive:**
```typescript
// Option 1: Use another descriptive field
name: source.displayName || source.title || source.identifier

// Option 2: Combine fields
name: `${source.firstName} ${source.lastName}`

// Option 3: Generate from ID
name: source.name || source.id || 'Unknown'

// Option 4: Use formatted version
name: source.userName || `User ${source.id}`
```

### Other Required Fields

Check TypeScript interface for fields WITHOUT `?`:
```typescript
export interface MyResource {
  id: string;        // Required (no ?)
  name: string;      // Required (no ?)
  description?: string;  // Optional (has ?)
  tags?: Tag[];      // Optional (has ?)
}
```

**If source lacks required field and can't generate:**
```typescript
await batch.error(`Missing required field: description`, source);
return;  // Skip this item
```

---

## When Mapping Fails

### Scenarios

**1. Can't find semantic mapping:**
```typescript
// Source field: obscureCode: "XYZ123"
// No schema field seems related
// ??? What is this?
```

**2. Type incompatible:**
```typescript
// Source: priority: number (1-10)
// Schema: priority: "HIGH" | "MEDIUM" | "LOW"
// How to map?
```

**3. Complex transformation needed:**
```typescript
// Source: nested 3 levels deep with arrays
// Schema: flat structure
// Transformation unclear
```

### Response Pattern

**DO NOT block collection**. Instead:

**Step 1: Add TODO comment in code**
```typescript
export function toResource(source: ModuleResource): SchemaResource {
  // TODO: Unable to map source.obscureCode - unclear semantic meaning
  // TODO: Need guidance on priority number (1-10) to enum mapping

  return {
    id: source.id,
    name: source.name,
    // ... map what you can
  };
}
```

**Step 2: Continue with other mappers**

Complete all mappings you CAN do, skipping only truly ambiguous ones.

**Step 3: At end of implementation, ask user**

After implementing everything else:
```
I've completed the collector implementation with the following mapping questions:

1. Resource.obscureCode (string) - What schema field should this map to?
2. Priority conversion - How to map 1-10 numeric priority to HIGH/MEDIUM/LOW enum?
3. NestedConfig structure - Should this be flattened or which subset to extract?

Please provide guidance on these mappings and I'll complete them.
```

---

## Default Values

### For Optional Fields

When source doesn't have an optional field:

**Set to `undefined`** (or omit from object):
```typescript
return {
  id: source.id,
  name: source.name,
  description: source.description,  // Could be undefined - that's OK
  tags: source.tags,  // Could be undefined - that's OK
};
```

**Explicit undefined vs omitted:**
```typescript
// Both are acceptable:

// Option A: Explicit undefined
return {
  id: source.id,
  name: source.name,
  description: source.description || undefined,
  tags: source.tags || undefined
};

// Option B: Conditional inclusion (cleaner)
return {
  id: source.id,
  name: source.name,
  ...(source.description && { description: source.description }),
  ...(source.tags && { tags: source.tags })
};

// Option C: Simple passthrough (preferred)
return {
  id: source.id,
  name: source.name,
  description: source.description,  // undefined is fine
  tags: source.tags  // undefined is fine
};
```

**Prefer Option C** - simplest and clearest.

### For Empty Arrays

If schema expects `tags?: Tag[]` and source has no tags:

**Set to `undefined`**, not empty array:
```typescript
// Good
tags: source.tags  // undefined if source.tags doesn't exist

// Also good
tags: source.tags && source.tags.length > 0 ? source.tags.map(mapTag) : undefined

// Bad - unnecessary
tags: source.tags || []  // Adds empty array instead of undefined
```

### For Required Fields

If required field is missing from source - **skip the item**:
```typescript
if (!source.requiredField) {
  await batch.error('Missing required field: requiredField', source);
  return;  // Don't create object
}
```

---

## Batch Management Patterns

### Serial vs Parallel Collection

**Serial (Region by Region) - RECOMMENDED:**
```typescript
for (const region of regions) {
  const groupId = `${accountId}-${region}`;
  const batch = await this.initBatchForClass(Resource, groupId);

  // Collect for this region
  const resources = await this.module.listInRegion(region);
  await resources.forEach(async (r) => {
    await batch.add(toResource(r, region), r);
  }, undefined, this.previewCount);

  await batch.end();
}
```

**Why serial?**
- Prevents API rate limit issues
- Reduces memory usage
- Safer for module stability

**Parallel (for independent sources) - ADVANCED:**
```typescript
// Only if sources are completely independent
await Promise.all(
  tenants.map(async (tenant) => {
    const batch = await this.initBatchForClass(User, tenant.id);
    const users = await this.module.getUsersForTenant(tenant.id);

    await users.forEach(async (u) => {
      await batch.add(toUser(u), u);
    });

    await batch.end();
  })
);
```

**Use parallel only when:**
- Different API endpoints (no shared rate limit)
- Small datasets (memory not a concern)
- Truly independent (no dependencies between them)

### Multiple Batches for Same Class

**Yes, you can have multiple batches open simultaneously:**
```typescript
const userBatch = await this.initBatchForClass(User, groupId);
const groupBatch = await this.initBatchForClass(Group, groupId);

// Both open - OK
await userBatch.add(user1);
await groupBatch.add(group1);

// MUST end both
await userBatch.end();
await groupBatch.end();
```

### Batch Lifecycle Rules

**CRITICAL RULES:**

1. **Must call `batch.end()`** - Always, even if empty
2. **Never add after ending** - Will fail
3. **One batch per class per groupId** - Don't create duplicates
4. **End in reverse order of dependencies** - If users reference groups, end users first

**Pattern:**
```typescript
private async loadData() {
  // Create batches
  const groupBatch = await this.initBatchForClass(Group, groupId);
  const userBatch = await this.initBatchForClass(User, groupId);

  try {
    // Load groups first (users reference them)
    await this.loadGroups(groupBatch);
    await this.loadUsers(userBatch);  // May reference groups

  } finally {
    // End in reverse dependency order
    await userBatch.end();  // Users reference groups - end first
    await groupBatch.end();
  }
}
```

### Pagination Optimization

**Module default (50) is TOO SMALL for collectors:**
```typescript
// BAD - uses default of 50 items per page
const resources = await this.module.list();
// Will make MANY API calls for large datasets
```

**GOOD - optimize page size:**
```typescript
// Request maximum page size
const resources = await this.module.list(
  undefined,  // pathPrefix
  1,          // pageNumber
  1000        // pageSize - MUCH better!
);
```

**How to choose page size:**
- **Check module API spec** - look for maxPageSize
- **Start with 1000** - good default
- **Consider vendor limits:**
  - GitHub: 100 max per page, rate limit 5000/hour
  - AWS: 1000 max per page, generous limits
  - Azure: 100-1000 depending on API

**Memory vs API calls trade-off:**
- Larger pages = fewer API calls, more memory
- Smaller pages = more API calls, less memory
- For collectors, **favor fewer API calls** (use larger pages)

---

## Performance Optimization

### Memory Management

**Problem:** Large collections can consume excessive memory.

**Strategies:**

#### 1. Use for await Instead of forEach for Large Datasets

```typescript
// BAD - forEach loads ALL results into memory first
const resources = await this.module.listResources();
await resources.forEach(async (resource) => {
  await batch.add(toResource(resource), resource);
});
// If 100,000 resources, all loaded into memory!

// GOOD - for await processes one at a time
const resources = await this.module.listResources();
let count = 0;

for await (const resource of resources) {
  if (this.previewCount && count >= this.previewCount) break;

  try {
    await batch.add(toResource(resource), resource);
    count++;
  } catch (err) {
    await batch.error(`Failed to process: ${err.message}`, resource);
  }
}
```

**When to use for await:**
- Large datasets (>10,000 items)
- Memory-constrained environments
- When item processing is lightweight

#### 2. Batch Processing with Pagination

```typescript
// Process in chunks to control memory
const pageSize = 1000;
let pageNumber = 1;
let hasMore = true;

while (hasMore) {
  const resources = await this.module.list(undefined, pageNumber, pageSize);

  await resources.forEach(async (resource) => {
    await batch.add(toResource(resource), resource);
  });

  hasMore = resources.hasNext();
  pageNumber++;

  // Optional: Log progress
  this.logger.info(`Processed page ${pageNumber}, total items: ${pageNumber * pageSize}`);
}
```

#### 3. Limit Data Retention in Memory

```typescript
// BAD - Storing all data in arrays
private allUsers: User[] = [];
private allPolicies: Policy[] = [];

// GOOD - Process and release
private async loadUsers() {
  const batch = await this.initBatchForClass(User, groupId);
  const users = await this.module.getUsers();

  await users.forEach(async (user) => {
    const mapped = toUser(user);
    await batch.add(mapped, user);
    // User is processed and can be garbage collected
  });

  await batch.end();
}
```

**Only store in memory when:**
- Need to build relationships (collect IDs for linking)
- Must process all items before proceeding
- Dataset is small (<1000 items)

#### 4. Regional Processing (AWS pattern)

```typescript
// BAD - Collect all regions simultaneously
const batches = await Promise.all(
  regions.map(r => this.collectRegion(r))
);
// High memory usage with many regions

// GOOD - Process regions serially
for (const region of regions) {
  await this.collectRegion(region);
  // Previous region data released before next
}
```

### CPU/Processing Optimization

#### 1. Optimize Concurrency

```typescript
// Conservative (slow but safe)
await items.forEach(async (item) => {
  await process(item);
}, 1);  // Sequential

// Moderate (good balance)
await items.forEach(async (item) => {
  await process(item);
}, 5);  // 5 concurrent

// Aggressive (fast but risky)
await items.forEach(async (item) => {
  await process(item);
}, 10);  // 10 concurrent
```

**Guidelines:**
- Start with `undefined` (module default)
- If API has rate limits, use lower concurrency
- For nested loops, keep total ≤30
- Monitor for API errors, reduce if seen

#### 2. Minimize API Calls

```typescript
// BAD - Individual calls for each item's details
for (const user of users) {
  const details = await this.module.getUserDetails(user.id);  // N API calls
  const groups = await this.module.getUserGroups(user.id);    // N more calls
}

// GOOD - Batch calls or include in list operation
const usersWithDetails = await this.module.listUsersWithDetails();
// Single call or minimal calls

// GOOD - If must be separate, do in parallel batch
await users.forEach(async (user) => {
  const [details, groups] = await Promise.all([
    this.module.getUserDetails(user.id),
    this.module.getUserGroups(user.id)
  ]);
}, 5);  // Controlled concurrency
```

#### 3. Lazy Loading for Optional Data

```typescript
// Only fetch additional data when needed
await users.forEach(async (user) => {
  const mapped = toUser(user);

  // Only get tags if user has them
  if (user.hasCustomTags) {
    const tags = await this.module.getUserTags(user.id);
    mapped.tags = tags.map(toTag);
  }

  await batch.add(mapped, user);
});
```

### Pagination Parameter Optimization

**Key principle:** Fewer API calls = better performance

```typescript
// Default (BAD for collectors)
const resources = await this.module.list();
// pageSize = 50 → 20 API calls for 1000 items

// Optimized (GOOD)
const resources = await this.module.list(undefined, 1, 1000);
// pageSize = 1000 → 1 API call for 1000 items
```

**Optimization checklist:**
- [ ] Check module spec for maxPageSize
- [ ] Use 1000 as default
- [ ] Reduce if vendor limits are lower (GitHub: 100)
- [ ] Increase if vendor supports more
- [ ] Monitor API rate limit errors

---

## Incremental Collection Patterns

### Use Cases for Incremental Collection

**Full collection** (collect everything every time):
- Small datasets (<1000 items)
- Data changes frequently
- No clear "last modified" tracking
- Simpler to implement

**Incremental collection** (collect only changes):
- Large datasets (>10,000 items)
- Data changes slowly
- Clear "last modified" timestamp
- Reduces API calls and processing time

### Pattern 1: Timestamp-Based Incremental

**Requirements:**
- Source API supports filtering by modification date
- Schema has timestamp field

**Implementation:**

**Step 1: Add parameter for last run time**
```yaml
# parameters.yml
properties:
  since:
    type: string
    format: date-time
    description: Collect only items modified since this timestamp (ISO 8601)
    example: "2024-12-01T00:00:00Z"
```

**Step 2: Filter API calls**
```typescript
public async run(): Promise<void> {
  await this.init();

  const batch = await this.initBatchForClass(Resource, groupId);

  // Get last run timestamp from parameters or use beginning of time
  const since = this.context.parameters.since
    ? new Date(this.context.parameters.since)
    : new Date('2000-01-01');

  this.logger.info(`Collecting resources modified since ${since.toISOString()}`);

  // Filter by modification date
  const resources = await this.module.listModifiedSince(since);

  await resources.forEach(async (resource) => {
    await batch.add(toResource(resource), resource);
  }, undefined, this.previewCount);

  await batch.end();

  this.logger.info(`Collected ${resources.totalCount} modified resources`);
}
```

**Step 3: Pipeline configuration**
- Configure pipeline to pass `since` as last successful run timestamp
- Platform can provide this automatically

### Pattern 2: State-Based Incremental

**Maintain state file with last processed IDs/timestamps:**

```typescript
private lastRunState?: {
  timestamp: Date;
  processedIds: string[];
  cursor?: string;
};

private async loadState() {
  // Load state from previous run (platform provides this)
  if (this.context.previousRunState) {
    this.lastRunState = JSON.parse(this.context.previousRunState);
  }
}

private async saveState() {
  // Save state for next run
  const state = {
    timestamp: new Date(),
    processedIds: this.processedIds,
    cursor: this.nextCursor
  };

  await this.platform.saveState(JSON.stringify(state));
}

public async run(): Promise<void> {
  await this.init();
  await this.loadState();

  // Use state to determine where to continue
  const resources = this.lastRunState?.cursor
    ? await this.module.listFromCursor(this.lastRunState.cursor)
    : await this.module.list();

  // ... collect resources ...

  await this.saveState();
}
```

### Pattern 3: Cursor-Based Incremental

**For APIs that support pagination cursors:**

```typescript
public async run(): Promise<void> {
  await this.init();

  const batch = await this.initBatchForClass(Resource, groupId);

  let cursor = this.context.parameters.cursor || undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await this.module.listWithCursor(cursor);

    await page.items.forEach(async (resource) => {
      await batch.add(toResource(resource), resource);
    });

    cursor = page.nextCursor;
    hasMore = !!cursor;

    this.logger.info(`Processed page, next cursor: ${cursor || 'none'}`);
  }

  await batch.end();

  // Log final cursor for next run
  if (cursor) {
    this.logger.info(`Next run can start from cursor: ${cursor}`);
  }
}
```

### Pattern 4: Hybrid - Full + Incremental

**Best of both worlds:**

```typescript
private async runFullCollection(): Promise<void> {
  this.logger.info('Running FULL collection');
  const batch = await this.initBatchForClass(Resource, groupId);

  const resources = await this.module.listAll();
  await resources.forEach(async (r) => {
    await batch.add(toResource(r), r);
  }, undefined, this.previewCount);

  await batch.end();
}

private async runIncrementalCollection(since: Date): Promise<void> {
  this.logger.info(`Running INCREMENTAL collection since ${since.toISOString()}`);
  const batch = await this.initBatchForClass(Resource, groupId);

  const resources = await this.module.listModifiedSince(since);
  await resources.forEach(async (r) => {
    await batch.add(toResource(r), r);
  }, undefined, this.previewCount);

  await batch.end();
}

public async run(): Promise<void> {
  await this.init();

  // Determine if full or incremental
  const params = this.context.parameters;

  if (params.fullCollection || !params.since) {
    await this.runFullCollection();
  } else {
    await this.runIncrementalCollection(new Date(params.since));
  }
}
```

**When to use incremental:**
- User explicitly requests via parameters
- Dataset is very large (>100,000 items)
- API call cost is high
- Collection takes >30 minutes

**When to use full:**
- First run
- Data integrity concerns
- Deletions need to be detected
- Dataset is manageable (<10,000 items)

---

## Retry Logic & Resilience

### Why Retry Logic?

External APIs can have transient failures:
- Network timeouts
- Rate limiting (429 errors)
- Temporary service unavailability (503)
- Connection resets

**Don't fail entire collection** for temporary issues - retry!

### Pattern 1: Module-Level Retry (Preferred)

**Check if module has built-in retry:**
```typescript
// Many modules have retry built-in via axios configuration
// The module handles retries automatically
const resources = await this.module.list();
// No manual retry needed
```

**Most Auditmation modules** include retry logic already.

### Pattern 2: Operation-Level Retry

**For specific operations that need retry:**

```typescript
import { retry } from '@auditmation/types-core-js';

// Retry with exponential backoff
const resources = await retry(
  async () => await this.module.listResources(),
  {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2  // 1s, 2s, 4s delays
  }
);
```

### Pattern 3: Item-Level Retry

**For processing individual items:**

```typescript
private async processItemWithRetry(
  item: any,
  batch: Batch<SchemaClass>,
  maxRetries: number = 3
): Promise<void> {
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      // Fetch additional data for item
      const details = await this.module.getDetails(item.id);

      // Map and add
      const mapped = toSchemaClass(item, details);
      await batch.add(mapped, item);

      return; // Success - exit retry loop

    } catch (err) {
      attempts++;

      if (attempts >= maxRetries) {
        // Final failure - log as batch error
        await batch.error(
          `Failed after ${maxRetries} attempts: ${err.message}`,
          item
        );
        return;
      }

      // Transient error - retry with backoff
      const isTransient = this.isTransientError(err);
      if (isTransient) {
        const delayMs = 1000 * Math.pow(2, attempts - 1);
        this.logger.warn(
          `Transient error for item ${item.id}, retrying in ${delayMs}ms (attempt ${attempts}/${maxRetries})`
        );
        await this.sleep(delayMs);
      } else {
        // Non-transient error - don't retry
        await batch.error(`Non-transient error: ${err.message}`, item);
        return;
      }
    }
  }
}

private isTransientError(err: any): boolean {
  // HTTP status codes that indicate transient failures
  const transientCodes = [408, 429, 500, 502, 503, 504];

  if (err.response?.status) {
    return transientCodes.includes(err.response.status);
  }

  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Pattern 4: Rate Limit Handling

**Specific handling for 429 (Rate Limit) errors:**

```typescript
private async handleRateLimitedCall<T>(
  apiCall: () => Promise<T>,
  operationName: string
): Promise<T> {
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    try {
      return await apiCall();

    } catch (err) {
      if (err.response?.status === 429) {
        attempt++;

        // Check for Retry-After header
        const retryAfter = err.response?.headers['retry-after'];
        const delayMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : 60000 * Math.pow(2, attempt - 1); // Exponential backoff

        this.logger.warn(
          `Rate limited on ${operationName}, waiting ${delayMs}ms (attempt ${attempt}/${maxAttempts})`
        );

        await this.sleep(delayMs);
      } else {
        throw err; // Not rate limit - propagate error
      }
    }
  }

  throw new Error(`Rate limit retry exhausted for ${operationName} after ${maxAttempts} attempts`);
}

// Usage
private async loadResources() {
  const batch = await this.initBatchForClass(Resource, groupId);

  const resources = await this.handleRateLimitedCall(
    () => this.module.listResources(),
    'listResources'
  );

  await resources.forEach(async (r) => {
    await batch.add(toResource(r), r);
  });

  await batch.end();
}
```

### Pattern 5: Graceful Degradation

**Continue collection even if some operations fail:**

```typescript
public async run(): Promise<void> {
  await this.init();

  // Collect primary data (critical)
  try {
    await this.loadUsers();
  } catch (err) {
    // Critical failure - can't continue
    throw new Error(`Failed to load users: ${err.message}`);
  }

  // Collect secondary data (optional)
  try {
    await this.loadUserGroups();
  } catch (err) {
    // Log but continue
    this.logger.error(`Failed to load user groups: ${err.message}`);
    // Users collected, groups skipped - partial success
  }

  // Collect tertiary data (nice-to-have)
  try {
    await this.loadUserPreferences();
  } catch (err) {
    this.logger.warn(`Failed to load preferences: ${err.message}`);
    // Continue without preferences
  }
}
```

### Retry Decision Matrix

| Error Type | Retry? | Max Attempts | Backoff |
|------------|--------|--------------|---------|
| 429 (Rate Limit) | ✅ YES | 5 | Exponential or Retry-After header |
| 503 (Service Unavailable) | ✅ YES | 3 | Exponential (1s, 2s, 4s) |
| 502 (Bad Gateway) | ✅ YES | 3 | Exponential |
| 500 (Internal Server Error) | ⚠️ MAYBE | 2 | Linear (5s, 10s) |
| 408 (Request Timeout) | ✅ YES | 3 | Linear (2s, 4s, 6s) |
| 401 (Unauthorized) | ❌ NO | 0 | Fail immediately |
| 403 (Forbidden) | ❌ NO | 0 | Fail immediately |
| 404 (Not Found) | ❌ NO | 0 | Skip item, continue |
| 400 (Bad Request) | ❌ NO | 0 | Skip item, continue |
| Network errors (ECONNRESET) | ✅ YES | 3 | Exponential |

### Best Practices

**1. Log retry attempts:**
```typescript
this.logger.warn(
  `Retry ${attempt}/${maxAttempts} for ${operation}: ${err.message}`
);
```

**2. Use exponential backoff for server errors:**
```typescript
const delayMs = 1000 * Math.pow(2, attempt - 1);
// Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s
```

**3. Respect Retry-After headers:**
```typescript
const retryAfter = err.response?.headers['retry-after'];
if (retryAfter) {
  await this.sleep(parseInt(retryAfter) * 1000);
}
```

**4. Don't retry forever:**
- Max 3-5 attempts
- Total retry time should be <5 minutes
- After max attempts, fail gracefully with batch.error

**5. Differentiate transient vs permanent errors:**
```typescript
if (this.isTransientError(err)) {
  // Retry
} else {
  // Don't retry - fail fast
  await batch.error(err.message, item);
}
```

---

*Last Updated: 2024-12-16*

