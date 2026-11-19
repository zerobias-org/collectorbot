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
- `moduleConnectorName` - The module property on the generated BaseClient: last segment of the package name (e.g. `azureresourcegraph`, `access`)
- `schemaClasses` - Array of schema class names from collector.yml
- `moduleOperations` - Available operations from module spec
- `mode` - `tenant` (default) or `shared`
- Shared mode only: `moduleFactory` (e.g. `newCmvp`), `hasConnectionProfile`, `credentialParameters` (names, may be empty), `groupId` (fixed global value)

## Tasks

### Task 1: Create src/index.ts

**Template:**
```typescript
import { Collector<Vendor><Suite?><Product>Impl } from './Collector<Vendor><Suite?><Product>Impl.js';

export default Collector<Vendor><Suite?><Product>Impl;
export * from '../generated/index.js';
```

**Example:** For amazon/aws/iam → `CollectorAmazonAwsIamImpl`

### Task 2: Create src/Collector*Impl.ts

**Structure:**

1. **Imports**
```typescript
import { ConnectionMetadata, UUID } from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
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
      await batch.add(mapped);
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
      await batch.add(mapped);
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

### Task 3 (shared mode only): module as an in-process SDK

In shared mode the source module is NOT in `hub.yml` and NOT on `BaseClient`. Replace items 3, 4, 6, 7 and 8 above with this shape:

```typescript
import { newCmvp } from '@zerobias-org/module-nist-cmvp';   // module factory, plain npm dependency
import { Parameters } from '../generated/model/index.js';

@injectable()
export class CollectorNistCmvpImpl extends BaseClient {
  private readonly groupId = 'nist-cmvp';                   // one fixed global groupId
  private api = newCmvp();                                  // in-process, no Hub, no targetId
  private parameters?: Parameters;

  public async run(parameters: Parameters): Promise<void> {
    this.parameters = parameters;
    // Only if the module has a connection profile; credentials come from parameters
    // (read-only, public-data scoped, set in the pipeline YAML `params:`):
    // await this.api.connect({ apiKey: this.parameters.apiKey });
    await this.loadCertificates();
  }

  private async loadCertificates(): Promise<void> {
    const batch = await this.initBatchForClass(CmvpCertificate, this.groupId);
    const pageSize = this.previewCount ?? this.parameters?.pageSize ?? 500;
    // Explicit page loop. NEVER PagedResults.forEach / `for await` here: without a
    // Hub baseUrl they silently stop after the first page (silent data loss).
    // If the module downloads the whole listing on every list() call, use one large page.
    for (let pageNumber = 1; ; pageNumber += 1) {
      const page = await this.api.getCertificateApi().list(pageNumber, pageSize);
      for (const item of page.items) {                      // check the client's .d.ts for the page shape
        try {
          await batch.add(toCmvpCertificate(item));   // rawData must be Record<string, object>; omit it
        } catch (err) {
          await batch.error(`Failed to process: ${err.message}`, item);
        }
      }
      // Stop at the last page: requesting past pageCount throws
      // "Requested page N but only M pages exist" (exact multiple of pageSize).
      const lastPage = page.pageCount !== undefined && pageNumber >= page.pageCount;
      if (this.previewCount || lastPage || page.items.length < pageSize) break;
    }
    await batch.end();
  }
}
```

Rules:
- No `this.<module>.metadata()` (there is no connection): pass `undefined` tags to `Batch`.
- `connect(...)` only when the module has a connection profile; its arguments come from collector parameters, never hard-coded.
- Bound concurrency yourself (`PromisePool` / `p-limit`, ≤30 in flight) if detail calls fan out per item.
- Platform SDKs (`this.platform`, other `@zerobias-com/*-sdk` clients) are still injected by codegen and used normally.

## Critical Implementation Rules

### GroupId Strategy
- **AWS Global**: `${accountId}-global-${serviceName}`
- **AWS Regional**: `${accountId}-${region}`
- **Azure**: `${subscriptionId}-${resourceGroup}` or `${subscriptionId}-global`
- **GitHub**: `${orgName}-${resourceType}`
- **Shared/Global**: one fixed value per collector (e.g. `'nist-cmvp'`) or `''` (empty string)

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

Use in all forEach: `forEach(callback, concurrency, this.previewCount)`. Shared mode: use `previewCount` as the page size and stop after the first page.

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
