---
name: create-mappings
description: Creates src/Mappers.ts with semantically correct field mappings, proper date/datetime handling (Object.assign workaround), enum mapping, and stable ID generation. Use after implementation is created.
tools: Write, Read, Edit, Bash, Glob, Grep
model: sonnet
---

# Mapping Creator Agent

## Mission

Create src/Mappers.ts with semantically correct field mappings, proper date/enum handling, and stable IDs.

## Rules Reference

Read and follow:
- `.claude/ADVANCED_MAPPING_GUIDE.md` - ALL sections (Field Mapping, Dates, Enums, IDs, Links, Required Fields)
- `.claude/DEVELOPMENT_WORKFLOW.md` - Step 6.3: Create src/Mappers.ts
- `.claude/VENDOR_PATTERNS.md` - For vendor-specific ID patterns

## Input (Provided by Orchestrator)

- `collectorPath` - Absolute path to collector package
- `schemaClasses` - Array of schema class names from collector.yml
- `modulePackage` - Module package name
- `schemaPackages` - Schema package names (with -ts)
- `vendor` - For ID pattern guidance

## Tasks

### Task 1: Explore Type Definitions

**Step 1.1: Read module types**
```bash
cat node_modules/@auditlogic/module-*/dist/index.d.ts
```

Find interfaces/types returned by operations.

**Step 1.2: Read schema TypeScript types**
```bash
cat node_modules/@auditlogic/schema-*-ts/dist/index.d.ts
```

Understand required fields, optional fields, enums.

**Step 1.3: Read base schema for date vs datetime**
```bash
cat node_modules/@auditlogic/schema-*/classes/*.ts
cat node_modules/@auditlogic/schema-*/interfaces/*.ts
```

Look for `@Property({ type: 'date' })` vs `@Property({ type: 'datetime' })`.

Also check for `linkTo` definitions.

---

### Task 2: Create Mapper Functions

For EACH schema class, create a mapper function:

**Template:**
```typescript
export function to<SchemaClass>(
  source: ModuleSourceType,
  ...additionalContext
): SchemaClass {
  return {
    id: generateStableId(source),      // Required, stable
    name: source.name || generateName(source),  // Required
    // Map all other fields semantically
    description: source.description,
    tags: source.tags?.map(t => ({ key: t.key, value: t.value })),
    dateCreated: toDate(source.created),  // Use correct date conversion
    status: mapStatus(source.status),      // Enum mapping
    // Link arrays sorted
    groups: source.groupIds?.sort(),
  };
}
```

### Task 3: Semantic Field Matching

**Process:**
1. List all module fields
2. List all schema fields
3. Match by name similarity
4. If names don't match, check descriptions
5. Map semantically (userName → name, emailAddress → email)

**For unclear mappings:**
```typescript
// TODO: Unable to map source.obscureField - unclear semantic meaning
// Options: field1, field2, field3?
```

Add TODO comment and continue with other mappings.

### Task 4: Date Conversion Helpers

**CRITICAL:** Check base schema to determine date vs datetime!

```typescript
// For DATE fields (YYYY-MM-DD)
function toDate(date?: Date): any {
  if (!date) return undefined;
  return Object.assign(
    new Date(date.toISOString().split('T')[0]),
    date.toISOString().split('T')[0]
  );
}

// For DATETIME fields (ISO 8601)
function toDateTime(date?: Date): string | undefined {
  return date?.toISOString();
}
```

### Task 5: Enum Mapping

**Steps:**
1. Find enum fields in schema
2. Get enum values from schema-ts package
3. Map source values to schema enum

**Patterns:**
```typescript
// Case conversion
status: source.status?.toUpperCase() as SchemaStatus

// Semantic mapping
const statusMap: Record<string, SchemaStatus> = {
  'enabled': 'Active',
  'disabled': 'Inactive'
};
status: statusMap[source.status]

// Boolean to enum
status: source.isActive ? 'Active' : 'Inactive'
```

Handle unmapped values:
```typescript
const mapped = statusMap[source.status];
if (!mapped && source.status) {
  // Log warning - will be caught by batch.warn in implementation
  // Return undefined or default
}
```

### Task 6: ID Generation

**Priority order:**
1. Use source.id if exists
2. Use natural key (ARN for AWS, resource ID for Azure/GCP)
3. Use composite key: `${type}:${identifier}`
4. Generate from unique fields

**By vendor (from VENDOR_PATTERNS.md):**
- **AWS**: `source.arn.toString()`
- **Azure**: `source.id` (full resource ID)
- **GitHub**: `source.node_id` or `source.html_url`
- **Generic**: `source.id` or `${source.type}:${source.name}`

**NEVER use:**
- `UUID.generateV4()` - Not stable!
- `${index}` - Not stable!

### Task 7: Link Arrays

For array fields that are links:
```typescript
groups: source.groupIds?.sort()  // Alphabetically sorted
```

Check schema base for linkTo definition to know if it's by ID or other property.

### Task 8: Required Fields

**ALWAYS provide:**
- `id` - Stable identifier
- `name` - Human-readable name

If source lacks name:
```typescript
name: source.displayName || source.title || source.id || 'Unknown'
```

### Task 9: Type Conversions

**Common patterns:**
```typescript
// String array to single
name: [source.firstName, source.lastName].filter(Boolean).join(' ')

// Nested to flat
owner: source.metadata?.owner

// Single to array
tags: source.tag ? [source.tag] : undefined
```

## Output

Create `src/Mappers.ts` with:
- Import statements (module types, schema types)
- Helper functions (toDate, toDateTime, etc.)
- One mapper function per schema class
- All required fields mapped
- Enums handled correctly
- Dates handled correctly (Object.assign for date)
- IDs stable and unique
- Link arrays sorted
- TODO comments for uncertain mappings

## Example Output

```typescript
import * as moduleTypes from '@auditlogic/module-amazon-aws-s3';
import * as schemaTypes from '@auditlogic/schema-amazon-aws-s3-ts';
import { Arn } from '@org/types-amazon-js';

// Helper: Date conversion (YYYY-MM-DD)
function toDate(date?: Date): any {
  if (!date) return undefined;
  return Object.assign(
    new Date(date.toISOString().split('T')[0]),
    date.toISOString().split('T')[0]
  );
}

// Mapper: S3 service
export function toS3(
  account: string,
  region: string
): schemaTypes.S3 {
  return {
    id: `s3:${account}:${region}`,
    name: `AWS S3 in ${region}`,
    account,
    region,
    arn: new Arn(`arn:aws:s3:${region}:${account}:service`),
  };
}

// Mapper: S3 Bucket
export function toS3Bucket(
  bucket: moduleTypes.Bucket,
  account: string
): schemaTypes.S3Bucket {
  return {
    id: bucket.name,  // Bucket names are globally unique
    name: bucket.name,
    arn: new Arn(`arn:aws:s3:::${bucket.name}`),
    account,
    dateCreated: toDate(bucket.creationDate),
    region: bucket.region,
    encrypted: bucket.encryption?.rules?.length > 0,
    tags: bucket.tags?.map(t => ({ key: t.key, value: t.value })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// TODO: Unable to map bucket.obscureField - unclear semantic meaning
```

Log what you created and any uncertain mappings that need user input.
