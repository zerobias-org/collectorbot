---
name: create-implementation
description: Creates collector bot implementation files (src/Collector*Impl.ts and src/index.ts) with proper architecture, batches, groupId, concurrency, and error handling according to vendor-specific patterns.
tools: Write, Read, Edit, Bash, Glob, Grep
model: sonnet
---

# Implementation Creator Agent

## Mission

Create the main collector implementation file (src/Collector*Impl.ts and src/index.ts) with proper architecture, batches, groupId, concurrency, and error handling.

## Rules Reference

Read and follow:
- `.claude/DEVELOPMENT_WORKFLOW.md` - Phase 6: Implementation
- `.claude/COLLECTORBOT_RULES.md` - Source Files section
- `.claude/VENDOR_PATTERNS.md` - For vendor-specific patterns
- `.claude/ADVANCED_MAPPING_GUIDE.md` - Batch Management, Performance, Collection Order

## Input (Provided by Orchestrator)

- `collectorPath` - Absolute path to collector package
- `vendor` - Vendor name (amazon, microsoft, etc.)
- `suite` - Suite name if exists (aws, 365, etc.)
- `product` - Product name (iam, s3, etc.)
- `moduleConnectorName` - From generated BaseClient (e.g., `iam`, `workforcenowng`)
- `schemaClasses` - Array of schema class names from collector.yml
- `moduleOperations` - Available operations from module spec

## Tasks

### Task 1: Create src/index.ts

**Template:**
```typescript
import { Collector<Vendor><Suite?><Product>Impl } from './Collector<Vendor><Suite?><Product>Impl';

export default Collector<Vendor><Suite?><Product>Impl;
// eslint-disable-next-line
export * from '../generated';
```

**Example:** For amazon/aws/iam → `CollectorAmazonAwsIamImpl`

### Task 2: Create src/Collector*Impl.ts

**Structure:**

1. **Imports**
```typescript
import { ConnectionMetadata } from '@auditmation/hub-core';
import { UUID } from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient';
// Import schema types from -ts packages
// Import module types
```

2. **Class Declaration**
```typescript
@injectable()
export class Collector<Name>Impl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;
  private _jobId?: UUID;

  private previewCount?: number = this.context.previewMode
    ? (this.context.previewCount || 10)
    : undefined;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }
```

3. **System Identifier Extraction** (based on vendor from VENDOR_PATTERNS.md)
```typescript
// AWS: from metadata
private get accountId(): string {
  return this.connectionMetadata.remoteSystemInfo.account;
}

// OR GitHub/SaaS: from first API call
private async getOrgName(): Promise<string> {
  if (!this.orgName) {
    const org = await this.<module>.getOrganization();
    this.orgName = org.login;
  }
  return this.orgName;
}
```

4. **Init Method**
```typescript
private async init() {
  this.logger.info('Initializing collector');
  try {
    this.connectionMetadata = await this.<module>.metadata();
    this.logger.info('Connection metadata retrieved');
  } catch (error) {
    this.logger.error(`Failed to get metadata: ${error.message}`);
    throw new Error('Unable to initialize collector');
  }
}
```

5. **Batch Helper**
```typescript
private async initBatchForClass<T extends Record<string, any>>(
  batchItemType: new (...args) => T,
  groupId: string
): Promise<Batch<T>> {
  const batch = new Batch<T>(
    batchItemType.name,
    this.platform,
    this.logger,
    this.jobId,
    this.connectionMetadata?.tags,
    groupId
  );
  await batch.getId();
  return batch;
}
```

6. **Collection Methods** (one per schema class)
```typescript
private async load<ClassName>(): Promise<void> {
  this.logger.info('Loading <ClassName>');

  // GroupId based on vendor pattern
  const groupId = this.getGroupId(); // AWS: ${account}-${region} or ${account}-global-service

  const batch = await this.initBatchForClass(<ClassName>, groupId);

  // Get data from module with OPTIMIZED pagination
  const resources = await this.<module>.get<Resource>Api().list(
    undefined,  // filters
    1,          // page
    1000        // pageSize - OPTIMIZE (vendor-specific)
  );

  // Iterate with proper concurrency
  await resources.forEach(async (resource) => {
    try {
      const mapped = to<ClassName>(resource);
      await batch.add(mapped, resource);
    } catch (err) {
      await batch.error(`Failed to process: ${err.message}`, resource);
    }
  }, undefined, this.previewCount);  // undefined concurrency for flat iteration

  await batch.end();
  this.logger.info('Loading <ClassName> - done');
}
```

7. **Nested Collection** (if needed for related resources)
```typescript
// For parent-child relationships
private async load<ChildClass>(): Promise<void> {
  const parents = await this.<module>.getParents();
  const batch = await this.initBatchForClass(<ChildClass>, groupId);

  // CRITICAL: Calculate concurrency to stay ≤30
  // outer × inner ≤ 30
  await parents.forEach(async (parent) => {
    const children = await this.<module>.getChildren(parent.id);

    await children.forEach(async (child) => {
      const mapped = to<ChildClass>(child, parent.id);
      await batch.add(mapped, child);
    }, 6, this.previewCount);  // Inner: 6

  }, 5, this.previewCount);  // Outer: 5 → 5×6=30 ✓

  await batch.end();
}
```

8. **Run Method** (orchestrate collection in dependency order)
```typescript
public async run(): Promise<void> {
  await this.init();

  // Collect in dependency order (check schema for linkTo)
  // Parents first, then children
  await this.load<Class1>();
  await this.load<Class2>();
  // ...
}
```

## Critical Implementation Rules

### GroupId Strategy
- **AWS Global**: `${accountId}-global-${serviceName}`
- **AWS Regional**: `${accountId}-${region}`
- **Azure**: `${subscriptionId}-${resourceGroup}` or `${subscriptionId}-global`
- **GitHub**: `${orgName}-${resourceType}`
- **Shared/Global**: `''` (empty string)

See VENDOR_PATTERNS.md for specific patterns.

### Pagination Optimization
- **Default pageSize**: 1000
- **GitHub**: 100 (API limit)
- **AWS**: 1000
- Always specify pageSize in list() calls

### Concurrency Rules
- **Flat iteration**: `undefined` (module default)
- **Nested loops**: Calculate outer × inner ≤ 30
- **Adjust innermost** loop usually

### Collection Order
1. Check schema for `linkTo` relationships
2. Collect parents before children
3. If unclear, use module API operation order
4. Document order in run() comments

### Error Handling
- **Init errors**: throw
- **Item errors**: batch.error() and continue
- **Missing optional data**: batch.warn() and continue

### Preview Mode
```typescript
private previewCount?: number = this.context.previewMode
  ? (this.context.previewCount || 10)
  : undefined;
```

Use in all forEach: `forEach(callback, concurrency, this.previewCount)`

## Output

Create two files:
1. `src/index.ts`
2. `src/Collector<Vendor><Suite?><Product>Impl.ts`

Log what you created and any decisions made (e.g., groupId strategy chosen, collection order rationale).

## Example Output Message

```
✅ Implementation created: src/CollectorAmazonAwsS3Impl.ts

Architecture decisions:
- GroupId: ${accountId}-global-s3 (AWS global service pattern)
- Collection order: S3 → S3Bucket → S3BucketPolicy (dependency order)
- Pagination: 1000 pageSize (AWS supports up to 1000)
- Concurrency: undefined for flat iteration, 5×6=30 for bucket→policy nesting

Methods created:
- init() - Connection metadata extraction
- initBatchForClass() - Batch helper with groupId
- loadS3() - Main S3 service object
- loadS3Buckets() - Bucket collection (nested: tags, encryption, policy)
- loadS3BucketPolicies() - Policy documents
- run() - Orchestration

Files:
- src/index.ts
- src/CollectorAmazonAwsS3Impl.ts
```
