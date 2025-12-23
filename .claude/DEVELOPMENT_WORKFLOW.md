# Collector Bot Development Workflow

This document defines the step-by-step workflow for developing a new collector bot from scratch.

## Prerequisites

Before starting, ensure you understand:
- [COLLECTORBOT_RULES.md](./COLLECTORBOT_RULES.md) - All file structure and validation rules
- The vendor/product you're collecting from
- What data needs to be collected

---

## Phase 1: Planning & Discovery

### Step 1.1: Verify Dependencies Exist

Collector bots depend on Hub modules and Schema packages. **CRITICAL:** Check these exist before proceeding.

**Naming Pattern (zerobias-org repository):**
- Collector: `@zerobias-org/collectorbot-<vendor>-<suite?>-<product>`
- Module: `@zerobias-org/module-<vendor>-<suite?>-<product>` (fallback: `@auditlogic/module-*`)
- Product: `@zerobias-org/product-<vendor>-<suite?>-<product>`
- Schema: `@auditlogic/schema-<vendor>-<suite?>-<product>` (centralized)

**Check if Module Exists:**
```bash
# Prefer zerobias-org, fallback to auditlogic
npm view @zerobias-org/module-<vendor>-<suite?>-<product>
# OR
npm view @auditlogic/module-<vendor>-<suite?>-<product>

# Or check module bundle
npm view @zerobias-org/module-bundle --json | jq '.dependencies'
npm view @auditlogic/module-bundle --json | jq '.dependencies'
```

**Check if Schema Exists:**
```bash
# Schema is always @auditlogic
npm view @auditlogic/schema-<vendor>-<suite?>-<product>

# Or check schema bundle
npm view @auditlogic/schema-bundle --json | jq '.dependencies'
```

**Check if Product Exists:**
```bash
# Product is always @zerobias-org in this repo
npm view @zerobias-org/product-<vendor>-<suite?>-<product>

# Or check product bundle
npm view @zerobias-org/product-bundle --json | jq '.dependencies'
```

**If Module or Schema Missing:**
- **STOP** and inform the user
- These must be created first (different workflow)
- Cannot proceed with collector development

### Step 1.2: Determine Collector Type

**Standard Collector:**
- Connects to a Hub module (module handles authentication)
- Most common type
- Example: `package/amazon/aws/iam/`

**Shared Collector:**
- No Hub module connection
- Accepts credentials in `parameters.yml`
- Creates its own module connection internally
- Used for shared/reference data (e.g., service catalogs, standards)
- Example: `package/amazon/aws/accounts-shared/`

---

## Phase 2: Project Setup

### Step 2.1: Create Directory Structure

Determine the correct path based on vendor structure:
- With suite: `package/<vendor>/<suite>/<product>/`
- Without suite: `package/<vendor>/<product>/`

```bash
# Example with suite (AWS)
mkdir -p package/amazon/aws/s3
cd package/amazon/aws/s3

# Example without suite (ADP)
mkdir -p package/adp/workforcenowng
cd package/adp/workforcenowng
```

### Step 2.2: Create Required Symlinks

**CRITICAL:** Always symlink, never copy `.npmrc` and `.nvmrc`

```bash
# For 4-level depth (package/vendor/suite/product)
ln -s ../../../../.npmrc .npmrc
ln -s ../../../../.nvmrc .nvmrc

# For 3-level depth (package/vendor/product)
ln -s ../../../.npmrc .npmrc
ln -s ../../../.nvmrc .nvmrc

# Verify
ls -la .npmrc .nvmrc
# Should show: .npmrc -> ../../../../.npmrc
```

### Step 2.3: Copy Template Configuration Files

Find a similar reference collector:
- **Simple collector**: `package/adp/workforcenowng/`
- **Complex collector**: `package/amazon/aws/iam/`
- **Shared collector**: `package/amazon/aws/accounts-shared/`

```bash
# Copy configuration templates
cp <reference-collector>/.eslintrc .
cp <reference-collector>/.mocharc.json .
cp <reference-collector>/tsconfig.json .
cp <reference-collector>/.gitignore .
```

---

## Phase 3: Configuration Files

### Step 3.1: Create package.json

**Template:**
```json
{
  "name": "@zerobias-org/collectorbot-<vendor>-<suite?>-<product>",
  "version": "0.0.0",
  "description": "<Product Name> collectorbot",
  "license": "UNLICENSED",
  "author": "ctamas@zerobias.com",
  "main": "dist/src/index.js",
  "directories": {
    "src": "src"
  },
  "files": [
    "dist",
    "pnpm-lock.yaml",
    "*.yml",
    "*.md"
  ],
  "scripts": {
    "build": "npm run generate && npm run transpile",
    "clean": "rm -rf generated && rm -rf dist",
    "generate": "npm run generate:models && npm run generate:hub-client",
    "generate:hub-client": "node node_modules/@auditmation/hub-client-codegen/dist/index.js",
    "generate:models": "hub-generator generate -g hub-module -i ./parameters.yml -o generated/ --global-property models,supportingFiles=index.ts && rm ./generated/api/index.ts",
    "lint": "eslint src/",
    "lint:fix": "eslint --fix src/",
    "test": "",
    "test:integration": "mocha --exit --inline-diffs --reporter=list test/integration/**/*.ts",
    "transpile": "tsc"
  },
  "repository": {
    "type": "git",
    "url": "git@github.com:zerobias-org/collectorbot.git",
    "directory": "package/<vendor>/<suite?>/<product>"
  },
  "dependencies": {
    "@zerobias-org/module-<vendor>-<suite?>-<product>": "^<version>",
    "@zerobias-org/product-<vendor>-<suite?>-<product>": "latest",
    "@auditlogic/schema-<vendor>-<suite?>-<product>": "^<version>",
    "@auditlogic/schema-<vendor>-<suite?>-<product>-ts": "^<version>",
    "@auditmation/hub-client": "^8.8.39",
    "@auditmation/hub-core": "^4.4.40",
    "@auditmation/hydra-schema-resource": "^4.0.6",
    "@auditmation/module-auditmation-auditmation-platform": "^4.1.6",
    "@auditmation/types-core-js": "^4.9.8",
    "@auditmation/util-collector-utils": "^4.3.4",
    "inversify": "^6.0.2",
    "reflect-metadata": "^0.1.13"
  },
  "devDependencies": {
    "@auditmation/eslint-config": "^1.1.17",
    "@auditmation/hub-client-codegen": "^2.0.8",
    "@auditmation/hub-secrets-manager": "^2.0.16",
    "@auditmation/util-codegen": "^5.5.19",
    "@types/chai": "^4.3.11",
    "@types/mocha": "^10.0.6",
    "@types/node": "^20.10.4",
    "chai": "^4.3.10",
    "mocha": "^10.2.0",
    "ts-node": "^10.9.2",
    "typescript": "4.9.5"
  },
  "auditmation": {
    "package": "<vendor>.<suite?>.<product>.collectorbot",
    "dataloader-version": "0.5.4",
    "import-artifact": "collectorbot"
  }
}
```

**Important (zerobias-org specific):**
- Use `^` for module and schema dependencies
- Use `latest` for product package
- Use exact version `4.9.5` for TypeScript
- Include both base schema and `-ts` schema packages
- **Module**: Prefer `@zerobias-org/module-*`, fallback to `@auditlogic/module-*`
- **Product**: Always use `@zerobias-org/product-*` and include directly (not transitive in this repo)
- **Schema**: Always use `@auditlogic/schema-*` (centralized)
- **Vendor packages**: Not used in zerobias-org collectors

### Step 3.2: Get Module and Product UUIDs

**Module UUID:**
```bash
# Install module (prefer zerobias-org, fallback to auditlogic)
npm install @zerobias-org/module-<vendor>-<suite?>-<product>
# OR
npm install @auditlogic/module-<vendor>-<suite?>-<product>

# Get module ID
cat node_modules/@zerobias-org/module-*/package.json | grep module-id
# OR
cat node_modules/@auditlogic/module-*/package.json | grep module-id
```

**Product UUID:**
```bash
# Install product package directly in zerobias-org repo
npm install @zerobias-org/product-<vendor>-<suite?>-<product>

# Get product UUID
cat node_modules/@zerobias-org/product-<vendor>-<suite?>-<product>/index.yml | grep "^id:"
```

### Step 3.3: Create hub.yml

**For Standard Collectors (with module connection):**

Create `hub.yml` (skip `operations` section - not needed):

```yaml
modules:
  '@zerobias-org/module-<vendor>-<suite?>-<product>':
    id: <uuid-from-module-package-json-module-id-field>
    name: module-<vendor>-<suite?>-<product>
    module: <ModuleClassName>  # Will find after code generation
    version: <module-version>
products:
  <vendor>.<suite?>.<product>:
    id: <product-uuid-from-product-package-index-yml>
    name: <Product Display Name>
```

**Note:** If using `@auditlogic/module-*` as fallback, use that scope in hub.yml instead.

**Notes:**
- Skip `operations` section - not needed
- `permissions` is optional (documentation only)
- Module class name: Leave placeholder initially, will get from generated code after `npm run generate`

**For Shared Collectors (no module connection):**
```yaml
modules: {}
products: {}
```

**IMPORTANT - Multiple Modules:**
If you need data from multiple modules (e.g., IAM + STS + Organizations), **actively warn the user** that the UI does not currently support collectors with multiple connection profiles. This is a known limitation.

### Step 3.4: Create collector.yml

**RULE:** Collect ALL schema classes that have corresponding data available from the module.

**Multiple Schema Packages:**
Only include multiple schema packages when collecting data that is:
- Used/shared by multiple systems
- Requires schema modeling at suite level
- Example: AWS account data linked across multiple AWS service schemas

**Most collectors** only need ONE schema package (the product-specific one).

**Process:**

**Step 1: List all schema classes**
```bash
npm install @auditlogic/schema-<vendor>-<product>-ts
ls node_modules/@auditlogic/schema-<vendor>-<product>-ts/dist/
cat node_modules/@auditlogic/schema-<vendor>-<product>-ts/dist/index.d.ts
```

**Step 2: Match module operations to schema classes**
```bash
cat node_modules/@auditlogic/module-<vendor>-<product>/module-<vendor>-<product>.yml
```

Map each operation's return type to corresponding schema class(es).

**Step 3: Include ALL matched classes**

If module returns User data and schema has:
- `User` (base class)
- `AdminUser` (extends User)
- `ServiceUser` (extends User)

**Include ALL three** in collector.yml - collect everything possible.

```yaml
classes:
    - "@auditlogic/schema-<vendor>-<product>":
        - User
        - AdminUser
        - ServiceUser
        - Policy
        - PolicyStatement
        # Include ALL classes with corresponding module data
```

**Goal:** Maximize data collection - populate as many schema classes as the module can provide data for.

**If a schema class has no corresponding module data:**
- Remove it from `collector.yml`
- Only include classes you can actually populate

### Step 3.5: Create parameters.yml

**RULE:** Ask the user what parameters they want for this collector.

**When to have parameters:**
- Large systems where user wants to collect subset (e.g., specific regions, organizations)
- Shared collectors that need credentials
- Filtering options (skip certain resource types)
- Any configuration that varies per collection run

**When to skip parameters:**
- Simple collectors that collect everything
- No filtering needed
- Connection profile provides all needed info

**Ask user:** "What parameters should this collector accept (if any)?"

**Minimal Template (no parameters):**
```yaml
openapi: 3.0.3
info:
  description: Stub to use for codegen of parameters for a hub client
  version: ""
  title: '@auditmation/hub-client-codegen'
paths:
  /foo:
    get:
      tags:
        - foo
      operationId: getFoo
      responses:
        '204':
          description: Foo
components:
  schemas:
    Parameters:
      type: object
```

**With Parameters (example):**
```yaml
openapi: 3.0.3
info:
  description: Stub to use for codegen of parameters for a hub client
  version: ""
  title: '@auditmation/hub-client-codegen'
paths:
  /foo:
    get:
      tags:
        - foo
      operationId: getFoo
      responses:
        '204':
          description: Foo
components:
  schemas:
    Parameters:
      type: object
      required:
        - region
      properties:
        region:
          type: string
          description: AWS region to collect from
          example: us-east-1
        skipResources:
          type: array
          description: Resource types to skip
          items:
            type: string
```

---

## Phase 4: Code Generation

### Step 4.1: Install Dependencies

```bash
npm install
```

This will:
- Install all dependencies
- Create `node_modules/`
- Create `npm-shrinkwrap.json`

### Step 4.2: Generate Code

```bash
npm run generate
```

This generates:
- `generated/BaseClient.ts` - Abstract base with module connectors
- `generated/types.ts` - DI symbols
- `generated/inversify.config.ts` - DI container
- `generated/model/Parameters.ts` - Parameters class (if defined)
- `generated/index.ts` - Re-exports

### Step 4.3: Verify Generated Files

**Check BaseClient.ts:**
```bash
cat generated/BaseClient.ts
```
Should show:
- Module connector properties (e.g., `this.iam`)
- Proper imports from module packages
- Constructor with injected dependencies

**Get Module Class Name and Property Name:**
Look at the BaseClient constructor parameters:
```typescript
constructor(
  @inject(TYPES.HubClientContext) context: HubClientContext,
  @inject(TYPES.iam) iam: IamConnector,  // <- "Iam" is module class, "iam" is property
  @inject(TYPES.workforcenowng) workforcenowng: WorkforceNowNgConnector,
```

- **Module class name**: `Iam`, `WorkforceNowNg` (for hub.yml `module` field)
- **Property name**: `iam`, `workforcenowng` (lowercase, use in code as `this.iam`)

**Update hub.yml** with the correct module class name if needed.

**Note:** Property names are lowercase, auto-generated from the module field in hub.yml.

**Check types.ts:**
```bash
cat generated/types.ts
```
Should show DI symbols for each module.

---

## Phase 5: Module & Schema Exploration

### Step 5.1: Explore Module Operations

View the module's OpenAPI specification:
```bash
cat node_modules/@auditlogic/module-<vendor>-<product>/module-<vendor>-<product>.yml
```

**What to look for:**
- Available operations (`operationId`)
- Operation paths and methods
- Request parameters
- Response schemas
- Required permissions (`security` section)
- Pagination support

**Example Analysis:**
```yaml
paths:
  /users:
    get:
      operationId: listUsers
      x-method-name: list
      parameters:
        - $ref: '#/components/parameters/pageNumberParam'
        - $ref: '#/components/parameters/pageSizeParam'
```

This tells you:
- Operation: `listUsers`
- Method name: `list` (call via `this.module.getUserApi().list()`)
- Supports pagination

### Step 5.2: Explore Schema Types

```bash
# View available TypeScript interfaces
cat node_modules/@auditlogic/schema-<vendor>-<product>-ts/dist/index.d.ts
```

**What to look for:**
- Interface definitions
- Required vs optional properties
- Property types
- JSDoc descriptions
- Enum values

**Example:**
```typescript
export interface AwsIamUser {
  id: string;
  name: string;
  arn?: Arn;
  tags?: Tag[];
  groups?: string[];
}
```

### Step 5.3: Plan Collection Strategy

**Consider:**
1. **Data Source Scope:**
   - Is data global or regional?
   - Multiple tenants/accounts?
   - Multiple independent lists of same class?

2. **Pagination Strategy:**
   - How much data? (affects memory usage)
   - API rate limits?
   - Use `forEach` (parallel) or `for await` (sequential)?

3. **GroupId Strategy:**
   - What defines a "complete set" of this data?
   - Example: `${accountId}-${region}` for regional resources
   - Example: `${accountId}-global-iam` for global resources

4. **Relationships:**
   - Do objects link to each other?
   - Need to collect parent objects first?

5. **Preview Mode:**
   - How to limit data for testing?
   - Per-batch or per-source limits?

---

## Phase 6: Implementation

### Step 6.1: Create src/index.ts

```typescript
import { Collector<Vendor><Suite?><Product>Impl } from './Collector<Vendor><Suite?><Product>Impl';

export default Collector<Vendor><Suite?><Product>Impl;
// eslint-disable-next-line
export * from '../generated';
```

**Naming Convention:**
- CamelCase with vendor, suite (if exists), and product
- Examples:
  - `CollectorAmazonAwsIamImpl`
  - `CollectorAdpWorkforcenowngImpl`
  - `CollectorMicrosoftEntraImpl`

### Step 6.2: Create src/Collector*Impl.ts

**Standard Collector Template:**

```typescript
import { ConnectionMetadata } from '@auditmation/hub-core';
import { UUID } from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient';
import { toSchemaClass } from './Mappers';

@injectable()
export class Collector<Name>Impl extends BaseClient {
  private connectionMetadata?: ConnectionMetadata;
  private _jobId?: UUID;

  // Preview mode support
  private previewCount?: number = this.context.previewMode
    ? (this.context.previewCount || 10)
    : undefined;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  private async init() {
    this.logger.info('Initializing collector');
    try {
      // Get connection metadata from module
      // Note: Not all modules return metadata (e.g., AWS does with account info)
      this.connectionMetadata = await this.<module>.metadata();
      this.logger.info('Connection metadata retrieved');
    } catch (error) {
      this.logger.error(`Failed to get metadata: ${error.message}`);
      throw new Error('Unable to initialize collector');
    }
  }

  private async initBatchForClass<T extends Record<string, any>>(
    batchItemType: new (...args) => T,
    groupId: string
  ): Promise<Batch<T>> {
    const batch = new Batch<T>(
      batchItemType.name,
      this.platform,
      this.logger,
      this.jobId,
      this.connectionMetadata?.tags,  // Tags tie connection to batch
      groupId
    );
    await batch.getId();
    return batch;
  }

  private async loadResources(): Promise<void> {
    this.logger.info('Loading resources');

    // Determine groupId based on scope
    const groupId = `${accountId}-${region}`; // Adjust as needed

    const batch = await this.initBatchForClass(ResourceClass, groupId);

    // Get resources from module (OPTIMIZE pagination!)
    // Default pageSize is 50 - TOO SMALL for collectors
    const resources = await this.<module>.getResourceApi().list(
      undefined,  // pathPrefix
      1,          // pageNumber
      1000        // pageSize - optimize! Default 50 is inefficient
    );

    // Iterate with pagination
    // Concurrency: undefined (module default) is usually fine
    // BUT: Ensure nested requests don't exceed 30 concurrent total
    await resources.forEach(async (resource) => {
      try {
        // Transform using mapper
        const mapped = toSchemaClass(resource);

        // Add to batch
        // Second parameter is original data for historical re-mapping
        await batch.add(mapped, resource);
      } catch (err) {
        await batch.error(
          `Failed to process resource ${resource.id}: ${err.message}`,
          resource
        );
      }
    }, undefined, this.previewCount);

    await batch.end();
    this.logger.info('Resources loaded');
  }

  public async run(): Promise<void> {
    await this.init();
    await this.loadResources();
    // Add more collection methods as needed
  }
}
```

**Key Patterns:**

1. **Preview Mode:**
```typescript
private previewCount?: number = this.context.previewMode
  ? (this.context.previewCount || 10)
  : undefined;
```

2. **Error Handling:**
```typescript
// Throw for initialization errors
try {
  await this.init();
} catch (error) {
  throw new Error(`Failed to initialize: ${error.message}`);
}

// Use batch.error for item-level errors
try {
  await batch.add(mapped, resource);
} catch (err) {
  await batch.error(`Failed to process item: ${err.message}`, item);
}
```

3. **Pagination - forEach (parallel processing):**
```typescript
await resources.forEach(async (resource) => {
  // Process resource
}, undefined, this.previewCount);
```

4. **Pagination - for await (sequential, memory-efficient):**
```typescript
for await (const resource of resources) {
  // Process one at a time
  if (this.previewCount && count >= this.previewCount) break;
}
```

5. **Module Pagination Optimization:**
```typescript
// Request maximum page size to minimize API calls
const resources = await this.module.getResourceApi().list(
  undefined,  // path prefix
  1,          // page number
  1000        // page size - optimize based on API limits
);
```

### Step 6.3: Create src/Mappers.ts

**Purpose:** Transform module data types to schema types

```typescript
import * as moduleTypes from '@auditlogic/module-<vendor>-<product>';
import * as schemaTypes from '@auditlogic/schema-<vendor>-<product>-ts';

export function toSchemaClass(
  source: moduleTypes.SourceType,
  additionalContext?: any
): schemaTypes.SchemaClass {
  return {
    id: source.id || generateId(source),
    name: source.name,
    description: source.description,
    // Map all required fields
    // Handle optional fields with ?.
    tags: source.tags?.map(t => ({ key: t.key, value: t.value })),
    // Convert dates
    dateCreated: source.createdDate?.toISOString().split('T')[0],
    // Handle nested objects
    metadata: source.metadata ? toMetadata(source.metadata) : undefined,
  };
}

// Helper functions
function generateId(source: any): string {
  return `${source.type}:${source.identifier}`;
}

function toMetadata(meta: moduleTypes.Metadata): schemaTypes.Metadata {
  // Transform nested structures
  return { /* ... */ };
}
```

**Best Practices:**
- One mapper function per schema class
- Pure functions (no side effects)
- Handle optional fields with `?.`
- **CRITICAL:** Check base schema for date vs datetime (see ADVANCED_MAPPING_GUIDE.md)
- **CRITICAL:** Map enums semantically - read descriptions when names don't match
- Use helper functions for complex transformations
- Sort link arrays alphabetically for consistency
- Generate stable IDs from source data (never random)

**For complex mapping scenarios, see:** [ADVANCED_MAPPING_GUIDE.md](./ADVANCED_MAPPING_GUIDE.md)

### Step 6.4: Create Integration Test

**Copy test structure from similar collector** and adjust the class name and parameters.

```typescript
// test/integration/Collector<Name>IT.ts
import 'reflect-metadata';

import { TestUtils } from '@auditmation/hub-client';
import { expect } from 'chai';
import { container } from '../../generated';

describe('Collector<Name>IT', function () {
  let client;

  it('Should collect data from <Product>', async () => {
    client = await TestUtils.getClient(container);
    try {
      // If collector has parameters, pass them here
      // e.g., await client.run({ region: 'us-east-1' });
      await client.run();
    } catch (e) {
      console.log(e);
    }
    expect(client).to.not.be.null;
  });
});
```

**Notes:**
- Tests use built-in environment variables (like target IDs) handled by `TestUtils.getClient()`
- Just copy from similar collector and adjust parameters for `run()` method
- No need to manually set up connection - the container handles it

---

## Phase 7: Build & Verify

### Step 7.1: Build

```bash
npm run build
```

Expected output:
- `dist/` directory created
- No TypeScript errors

### Step 7.2: Lint

```bash
npm run lint
```

Fix any linting errors:
```bash
npm run lint:fix
```

### Step 7.3: Generate Shrinkwrap

```bash
npm shrinkwrap
```

This creates/updates `npm-shrinkwrap.json`.

---

## Phase 8: Documentation

### Step 8.1: Create README.md

```markdown
# @zerobias-org/collectorbot-<vendor>-<suite?>-<product>

## Description

Collector bot for <Product Name>. Collects <what data> from <vendor> <product>.

## Data Collected

- **SchemaClass1**: Description of what this class contains
- **SchemaClass2**: Description of what this class contains

## Required Permissions

- `permission:action` - Description
- `permission:action` - Description

## Configuration

No additional configuration required / Accepts the following parameters:

- `parameterName` (required): Description

## GroupId Strategy

This collector uses the following groupId pattern:
- `${accountId}-${region}` for regional resources
- Ensures proper data isolation per account/region

## Development

```bash
npm install
npm run build
npm run lint
npm run test:integration
```
```

### Step 8.2: Create USERGUIDE.md

**CRITICAL:** USERGUIDE is customer-facing and renders in the platform UI on the parameter configuration page.

**Rules:**
- **ONLY document parameters** - nothing else
- Explain what each parameter is
- Explain how to find values (e.g., where to find GitHub org name, AWS region names)
- Provide complete example JSON with realistic values
- Professional tone - this is for end customers
- **Do not mention AI-generation** or development details

**Template for collectors WITH parameters:**

```markdown
# <Product Name> Collector - Parameters Guide

This collector requires the following parameters:

## Parameters

### `parameterName` (required)

**Description:** What this parameter controls

**How to find:** Step-by-step instructions on where users find this value

**Example:** `example-value`

### `optionalParameter` (optional)

**Description:** What this parameter controls

**Default:** `default-value` (if omitted)

**Example:** `example-value`

## Example Configuration

Complete parameter configuration example:

\`\`\`json
{
  "parameterName": "my-value",
  "optionalParameter": "custom-value"
}
\`\`\`

## Common Values

### Regions

For AWS regions, use one of:
- `us-east-1` - US East (N. Virginia)
- `us-west-2` - US West (Oregon)
- `eu-west-1` - EU (Ireland)

[See full list](https://docs.aws.amazon.com/general/latest/gr/rande.html)

### Organizations

To find your GitHub organization name:
1. Log into GitHub
2. Click your profile picture → "Your organizations"
3. Organization name is shown in the URL: `github.com/orgs/<org-name>`
```

**For collectors WITHOUT parameters:**

**Omit USERGUIDE.md** or create minimal:
```markdown
# <Product Name> Collector

This collector requires no additional parameters. Simply configure the connection profile and run.
```

---

## Phase 9: Commit

### Step 9.1: Verify Collector is Complete

**Definition of Done:**
- [ ] All schema classes from `collector.yml` are implemented
- [ ] All classes have mappers in `src/Mappers.ts`
- [ ] All classes are collected in `run()` method
- [ ] No uncertain mappings left (or documented with TODO + user consulted)
- [ ] Build succeeds: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] No manual edits to `generated/` or `dist/`

**Required files checklist:**
- [ ] `.npmrc` and `.nvmrc` (symlinks!)
- [ ] `.eslintrc`
- [ ] `.mocharc.json`
- [ ] `.gitignore`
- [ ] `tsconfig.json`
- [ ] `package.json`
- [ ] `npm-shrinkwrap.json`
- [ ] `collector.yml`
- [ ] `hub.yml`
- [ ] `parameters.yml`
- [ ] `src/index.ts`
- [ ] `src/Collector*Impl.ts`
- [ ] `src/Mappers.ts`
- [ ] `test/integration/Collector*IT.ts`
- [ ] `README.md`
- [ ] `USERGUIDE.md` (if has parameters)
- [ ] `generated/` (auto-generated, verify exists)
- [ ] `dist/` (build output, verify exists)
- [ ] `CHANGELOG.md` (auto-generated by Lerna - do NOT create manually)

### Step 9.2: Commit with Conventional Commit

```bash
git add .
git commit -m "feat(<vendor>-<product>): initial collector implementation

- Collects <list of data>
- Supports <features>
- Implements groupId strategy: <description>"
```

**Commit Message Format:**
- Type: `feat` for new collector
- Scope: Just `<product>` (e.g., `s3`, `iam`, `entra`)
- Description: Brief summary
- Body: Details about what's collected

**Examples:**
```bash
git commit -m "feat(iam): initial AWS IAM collector"
git commit -m "fix(s3): handle buckets without policies"
git commit -m "feat(entra): add Microsoft Entra ID collector"
```

**Version Management:**
- Lerna runs on **PR push** and on **merge**
- Automatically bumps versions based on conventional commits
- Publishes to npm via GitHub Actions
- No manual version management needed

---

## Phase 10: Testing & Iteration

### Step 10.1: Draft Mode / Preview Run

**How Preview Mode Works:**
- User's first run is always in "draft mode" (preview mode enabled)
- Must look good before creating the pipeline
- Limited to `previewCount` items per batch/source
- Validates connection, permissions, and data mapping

**Process:**
1. User configures connection in platform
2. User runs collector in draft/preview mode
3. Verify preview data looks correct
4. Check logs for errors/warnings
5. User can then create pipeline for full collection

**If Errors Occur:**
- Batch errors make the pipeline/run show as **red**
- Error messages visible in logs
- Failed batches highlighted in UI
- Fix issues and re-run in preview mode

### Step 10.2: Iterate Based on Feedback

Common adjustments:
- Add missing fields to mappers
- Adjust groupId strategy
- Handle edge cases
- Add more schema classes
- Optimize pagination parameters

---

## Common Patterns & Tips

### Pattern: System Identifier Extraction

**RULE:** For vendors without metadata (AWS has account, others don't):
- Extract system identifier from first API call when possible
- GroupId parent is just the identifier - resource type handled by class
- If global/no identifier makes sense, groupId can be empty string

```typescript
// AWS: Has metadata with account
private get accountId(): string {
  return this.connectionMetadata.remoteSystemInfo.account;
}
groupId = `${this.accountId}-${region}`;

// GitHub: Extract from first API call
private async getOrganization(): string {
  if (!this.orgName) {
    const org = await this.module.getOrganization();
    this.orgName = org.login;
  }
  return this.orgName;
}
groupId = `${await this.getOrganization()}-repos`;

// SaaS: Get tenant from auth/metadata
private async getTenantId(): string {
  const user = await this.module.getCurrentUser();
  return user.tenantId;
}
groupId = `${await this.getTenantId()}-users`;

// Global data (no natural identifier)
groupId = '';  // Empty string is valid for global shared data
```

### Pattern: Multiple Batches for Same Class

```typescript
// Different regions = different groupIds
for (const region of regions) {
  const groupId = `${accountId}-${region}`;
  const batch = await this.initBatchForClass(Resource, groupId);

  const resources = await this.module.listInRegion(region);
  await resources.forEach(async (r) => {
    await batch.add(toResource(r, region), r);
  }, undefined, this.previewCount);

  await batch.end();
}
```

### Pattern: Parent-Child Relationships with Concurrency Control

```typescript
// Collect parents first
const parentBatch = await this.initBatchForClass(Parent, groupId);
const parents = await this.module.getParents();
await parents.forEach(async (parent) => {
  await parentBatch.add(toParent(parent), parent);
}, undefined, this.previewCount);
await parentBatch.end();

// Then collect children with parent IDs
const childBatch = await this.initBatchForClass(Child, groupId);

// CRITICAL: Control nested concurrency to stay under 30 total concurrent requests
// If we have many parents and each parent has many children:
// - Outer forEach: concurrency 5 (5 parents in parallel)
// - Inner forEach: concurrency 6 (6 children per parent)
// Total max concurrent: 5 * 6 = 30 ✓

await parents.forEach(async (parent) => {
  const children = await this.module.getChildren(parent.id);

  // Inner loop concurrency calculated to keep total ≤ 30
  await children.forEach(async (child) => {
    await childBatch.add(toChild(child, parent.id), child);
  }, 6, this.previewCount);  // 6 concurrent children

}, 5, this.previewCount);  // 5 concurrent parents = max 30 total

await childBatch.end();
```

**Concurrency Calculation:**
- Default `undefined` usually fine for flat iteration
- For nested loops: `outerConcurrency * innerConcurrency ≤ 30`
- Adjust the MOST APPROPRIATE level (usually inner loop)
- Common patterns: 5×6=30, 10×3=30, 6×5=30

### Pattern: Memory-Efficient Collection

```typescript
// For large datasets, use for await instead of forEach
const resources = await this.module.getResources();
let count = 0;

for await (const resource of resources) {
  if (this.previewCount && count >= this.previewCount) break;

  try {
    await batch.add(toResource(resource), resource);
    count++;
  } catch (err) {
    await batch.error(`Failed: ${err.message}`, resource);
  }
}
```

### Tip: Optimize Module API Calls

```typescript
// Bad: Uses default (50) - TOO SMALL for collectors
const resources = await this.module.list();

// Good: Request maximum page size (default to 1000)
const resources = await this.module.list(
  undefined,  // filters
  1,          // page
  1000        // maxPageSize - start with 1000, adjust if vendor has limits
);

// Check module spec or vendor docs for max page size
// GitHub: 100 max
// AWS: 1000 max
// Most others: 1000 is safe default
```

**Concurrency Rules:**
- Flat (single-level) iteration: `undefined` concurrency is fine
- Nested (2+ levels): Calculate to keep total ≤ 30 concurrent requests
- Example: 5 outer × 6 inner = 30 total ✓
- Lower the MOST APPROPRIATE level (usually innermost)

**See [VENDOR_PATTERNS.md](./VENDOR_PATTERNS.md) for vendor-specific limits.**

### Tip: Handle Missing Optional Data

```typescript
// Don't fail on missing optional data
await resources.forEach(async (resource) => {
  if (!resource.requiredField) {
    await batch.error('Missing required field', resource);
    return;
  }

  if (!resource.optionalField) {
    await batch.warn('Missing optional field', resource);
    // Continue processing
  }

  // Second parameter preserves original data for historical re-mapping
  await batch.add(toResource(resource), resource);
});
```

**Understanding Batch Errors:**
- `batch.error()` logs the error but continues collection
- Failed items make the batch/pipeline show as **red** in UI
- Error messages visible in logs
- Users can see which specific items failed and why

---

## Shared Collector Specifics

Shared collectors handle their own module connections instead of using injected connectors.

### Key Differences:

1. **hub.yml:**
```yaml
modules: {}
products: {}
```

2. **parameters.yml includes connection credentials:**
```yaml
components:
  schemas:
    Parameters:
      type: object
      required:
        - accessKeyId
        - secretKey
      properties:
        accessKeyId:
          type: string
        secretKey:
          type: string
          format: password
```

3. **Collector creates connection internally:**
```typescript
import { newModule } from '@auditlogic/module-<vendor>-<product>';
import { ConnectionProfile } from '@auditlogic/module-<vendor>-<product>';

@injectable()
export class CollectorSharedImpl extends BaseClient {
  private module?: ModuleConnector;

  private async init() {
    // Create module connection from parameters
    const params = this.context.parameters;

    this.module = newModule();
    await this.module.connect(ConnectionProfile.newInstance({
      accessKeyId: params.accessKeyId,
      secretKey: params.secretKey,
      // ... other connection params
    }));
  }

  public async run(): Promise<void> {
    await this.init();

    // Use this.module just like standard collectors
    const data = await this.module.getData();

    // Don't forget to disconnect
    await this.module.disconnect();
  }
}
```

**Finding ConnectionProfile Structure:**
```bash
# After installing module
cat node_modules/@auditlogic/module-<vendor>-<product>/generated/models/ConnectionProfile.ts
```

This shows the exact structure needed for connection.

**Example ConnectionProfile:**
```typescript
export interface ConnectionProfile {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  sessionToken?: string;
}
```

**Mapping parameters to ConnectionProfile:**
```typescript
// parameters.yml defines what users provide
// Transform to ConnectionProfile structure

import { ConnectionProfile } from '@auditlogic/module-<vendor>-<product>';

const profile = ConnectionProfile.newInstance({
  // Map from this.context.parameters to ConnectionProfile fields
  accessKeyId: this.context.parameters.awsAccessKeyId,
  secretAccessKey: this.context.parameters.awsSecretKey,
  region: this.context.parameters.region
});
```

**Reference Examples:**
- `package/amazon/aws/accounts-shared/`
- `package/amazon/aws/ec2-shared/`

---

## Troubleshooting

### Build fails with "Cannot find module"
- Run `npm install`
- Check all dependencies in `package.json`
- Verify module and schema packages exist in npm

### Generate fails
- Check `hub.yml` has valid module references
- Check `parameters.yml` is valid OpenAPI 3.0.3
- Run `npm run clean` and try again

### Lint errors in generated code
- Add `/* eslint-disable */` comment to generated files
- Don't edit generated files - they'll be overwritten

### TypeScript errors with schema types
- Verify you're importing from `-ts` package
- Check schema package is installed
- Run `npm install` to update types

### Batch isn't removing old data
- Check groupId is consistent across runs
- Verify you're calling `batch.end()`
- Check batch initialization uses correct groupId

### Preview mode not working
- Verify `previewCount` is set correctly
- Check you're passing it to `forEach()` or checking in loop
- Remember: limit per batch/source, not total

---

## Modifying Existing Collectors

### Common Modification Scenarios

| Task | Risk Level | Key Concerns |
|------|-----------|--------------|
| Add new schema class | 🟢 Low | Update collector.yml, add mapper, add to run() |
| Add new field to mapping | 🟢 Low | Update mapper function |
| Fix mapping bug | 🟢 Low | Verify no groupId changes |
| Add/modify parameters | 🟡 Medium | Update parameters.yml, regenerate, update implementation |
| Update module version | 🟡 Medium | Check for breaking changes in module |
| Change groupId | 🔴 **DANGEROUS** | Will delete existing data! |
| Remove schema class | 🔴 **DANGEROUS** | Data will be orphaned |

### Modification Workflow

#### Adding a New Schema Class

**Step 1: Update collector.yml**
```yaml
classes:
    - "@auditlogic/schema-<vendor>-<product>":
        - ExistingClass1
        - ExistingClass2
        - NewClass  # Add here
```

**Step 2: Add schema dependency if from new package**
```bash
npm install @auditlogic/schema-<new-package> @auditlogic/schema-<new-package>-ts
npm shrinkwrap
```

**Step 3: Create mapper**
```typescript
// src/Mappers.ts
export function toNewClass(source: ModuleType): SchemaNewClass {
  return {
    id: source.id,
    name: source.name,
    // ... map fields
  };
}
```

**Step 4: Add collection logic**
```typescript
// src/Collector*Impl.ts
private async loadNewClass(): Promise<void> {
  const batch = await this.initBatchForClass(NewClass, groupId);
  const items = await this.<module>.getNewClassApi().list();

  await items.forEach(async (item) => {
    await batch.add(toNewClass(item), item);
  }, undefined, this.previewCount);

  await batch.end();
}

public async run(): Promise<void> {
  await this.init();
  await this.loadExistingClass1();
  await this.loadExistingClass2();
  await this.loadNewClass();  // Add here
}
```

**Step 5: Test, lint, commit**
```bash
npm run build
npm run lint
git commit -m "feat(<product>): add <NewClass> collection"
```

#### Adding/Modifying Parameters

**Step 1: Update parameters.yml**
```yaml
components:
  schemas:
    Parameters:
      type: object
      properties:
        existingParam:
          type: string
        newParam:  # Add new parameter
          type: string
          description: Description of new parameter
```

**Step 2: Regenerate code**
```bash
npm run generate
```

This updates `generated/model/Parameters.ts`.

**Step 3: Use parameter in collector**
```typescript
public async run(): Promise<void> {
  const params = this.context.parameters;

  // Access new parameter
  const newParamValue = params.newParam;

  // Use in collection logic
}
```

**Step 4: Update USERGUIDE.md**
Document the new parameter for users.

**Step 5: Test and commit**
```bash
npm run build
git commit -m "feat(<product>): add <newParam> parameter"
```

#### Fixing Mapping Bugs

**Step 1: Identify the issue**
- Read error logs
- Check which field is causing validation failure
- Check schema requirements

**Step 2: Fix mapper**
```typescript
// Before (bug)
export function toUser(source: ModuleUser): SchemaUser {
  return {
    id: source.id,
    name: source.name,
    status: source.isActive ? 'ACTIVE' : 'INACTIVE'  // Wrong enum value!
  };
}

// After (fixed)
export function toUser(source: ModuleUser): SchemaUser {
  return {
    id: source.id,
    name: source.name,
    status: source.isActive ? 'Active' : 'Inactive'  // Correct enum value
  };
}
```

**Step 3: Verify no groupId changes**

**CRITICAL:** Ensure you're not changing groupId logic - this would cause data deletion!

**Step 4: Test and commit**
```bash
npm run build
npm run lint
git commit -m "fix(<product>): correct user status enum mapping"
```

#### Updating Module Version

**Step 1: Update package.json**
```json
{
  "dependencies": {
    "@auditlogic/module-<vendor>-<product>": "^<new-version>"
  }
}
```

**Step 2: Install and regenerate**
```bash
npm install
npm run generate
npm shrinkwrap
```

**Step 3: Check for breaking changes**
- Review module CHANGELOG if available
- Attempt build - TypeScript will catch API changes
- Fix any compilation errors from module API changes

**Step 4: Test and commit**
```bash
npm run build
git commit -m "chore(deps): update module-<vendor>-<product> to <version>"
```

#### ⚠️ DANGEROUS: Changing GroupId

**STOP and think carefully!** Changing groupId will **DELETE existing data**.

**Safe change (data scoped differently):**
```typescript
// Before: Global groupId
groupId = `${accountId}-global`;

// After: Regional groupId (data is actually regional)
groupId = `${accountId}-${region}`;
// This is OK if data truly should be regional
```

**Unsafe change (arbitrary groupId change):**
```typescript
// Before
groupId = `${accountId}-users`;

// After
groupId = `${accountId}-all-users`;
// This will DELETE all existing users! Only change if intentional
```

**If you must change groupId:**
1. Document WHY in commit message
2. Warn user about data deletion
3. Consider if migration/backfill needed
4. Use conventional commit with BREAKING CHANGE

---

## When to Run npm run generate

**CRITICAL:** Code must be regenerated when certain files change.

**Run `npm run generate` after:**

| Changed File | What Gets Regenerated | Why |
|--------------|----------------------|-----|
| `hub.yml` | `generated/BaseClient.ts`, `generated/inversify.config.ts`, `generated/types.ts` | Module connectors change |
| `parameters.yml` | `generated/model/Parameters.ts` | Parameter interface changes |
| Module dependency version | All generated files | Module API might have changed |

**Workflow:**
```bash
# Changed hub.yml or parameters.yml
npm run generate

# Changed dependencies in package.json
npm install
npm run generate  # Always regenerate after dependency changes
npm shrinkwrap

# Build to verify
npm run build
```

**DO NOT EDIT generated/ or dist/ directories** - they will be overwritten!

---

## Quick Reference Commands

```bash
# Setup new collector
npm install
npm run generate
npm run build

# Development
npm run lint
npm run lint:fix
npm run transpile:watch

# After modifying parameters.yml or hub.yml
npm run generate
npm run build

# After modifying dependencies
npm install
npm run generate
npm shrinkwrap
npm run build

# Testing
npm run test:integration

# Release
git commit -m "feat(<product>): <description>"
```

---

*Last Updated: 2024-12-16*

