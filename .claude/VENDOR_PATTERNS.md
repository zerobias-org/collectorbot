# Vendor-Specific Architectural Patterns

This document provides reference patterns for common vendor platforms to accelerate collector development.

**Note:** These are patterns observed in existing collectors, not strict rules. Always verify with actual module/schema for your specific case.

---

## Amazon Web Services (AWS)

### System Identifier
```typescript
// From connection metadata
private get accountId(): string {
  if (!this.connectionMetadata?.remoteSystemInfo) {
    throw new Error('AWS metadata missing account information');
  }
  return this.connectionMetadata.remoteSystemInfo.account;
}
```

### GroupId Patterns

**Global Services (IAM, Organizations, S3):**
```typescript
groupId = `${this.accountId}-global-iam`;
groupId = `${this.accountId}-global-s3`;
```

**Regional Services (EC2, RDS, Lambda):**
```typescript
groupId = `${this.accountId}-${region}`;
// e.g., "123456789012-us-east-1"
```

### ID Patterns

**ARN-based (most AWS resources):**
```typescript
id: resource.arn.toString()
// e.g., "arn:aws:iam::123456789012:user/alice"
```

**Composite for resources without ARN:**
```typescript
id: `${accountId}:${region}:${resourceType}:${resourceId}`
```

### Common Parameters

```yaml
# parameters.yml
properties:
  region:
    type: string
    description: AWS region to collect from
    example: us-east-1
    default: us-east-1
  skipServiceTypes:
    type: array
    description: Service types to skip during collection
    items:
      type: string
    example: ["s3", "lambda"]
```

### Pagination

**Optimization:**
- Default: 50 (too small)
- Recommended: 1000
- AWS APIs usually support up to 1000 items per page

```typescript
const resources = await this.ec2.searchInstances(
  undefined,  // filters
  1,          // page
  1000        // pageSize
);
```

### Metadata Structure

```typescript
interface AWSRemoteSystemInfo {
  account: string;        // AWS Account ID
  arn: string;           // User/Role ARN
  userId: string;        // IAM User/Role ID
  name: string;          // User/Role name
  email?: string;        // Email if available
  joinedMethod: string;  // How account was created
  joined: string;        // When account created
  status: string;        // Account status
}
```

### Collection Order Example

```typescript
public async run(): Promise<void> {
  await this.init();

  // 1. Account-level resources (no dependencies)
  await this.loadAccount();

  // 2. IAM (referenced by everything)
  await this.loadRoles();
  await this.loadPolicies();

  // 3. Infrastructure
  await this.loadVPCs();
  await this.loadSubnets();
  await this.loadInstances();
}
```

---

## Microsoft Azure

### System Identifier

```typescript
// Extract from first API call or metadata
private async getSubscriptionId(): Promise<string> {
  if (!this.subscriptionId) {
    const subscription = await this.azure.getSubscription();
    this.subscriptionId = subscription.subscriptionId;
  }
  return this.subscriptionId;
}
```

### GroupId Patterns

**Subscription-level:**
```typescript
groupId = `${subscriptionId}-global`;
```

**Resource Group level:**
```typescript
groupId = `${subscriptionId}-${resourceGroupName}`;
```

**Regional:**
```typescript
groupId = `${subscriptionId}-${location}`;
```

### ID Patterns

**Resource ID (most Azure resources):**
```typescript
id: resource.id  // Azure provides full resource IDs
// e.g., "/subscriptions/{sub}/resourceGroups/{rg}/providers/{provider}/{type}/{name}"
```

### Common Parameters

```yaml
properties:
  subscriptionId:
    type: string
    description: Azure subscription ID
    format: uuid
  resourceGroups:
    type: array
    description: Resource groups to collect (empty = all)
    items:
      type: string
```

---

## Google Cloud Platform (GCP)

### System Identifier

```typescript
// Extract from API or parameters
private async getProjectId(): Promise<string> {
  if (!this.projectId) {
    const project = await this.gcp.getProject();
    this.projectId = project.projectId;
  }
  return this.projectId;
}
```

### GroupId Patterns

**Project-level:**
```typescript
groupId = `${projectId}-global`;
```

**Zone-level:**
```typescript
groupId = `${projectId}-${zone}`;
```

### ID Patterns

**Resource name (GCP pattern):**
```typescript
id: resource.name  // GCP uses unique resource names
// e.g., "projects/my-project/zones/us-central1-a/instances/my-instance"
```

### Common Parameters

```yaml
properties:
  projectId:
    type: string
    description: GCP project ID
  zones:
    type: array
    description: Zones to collect from
    items:
      type: string
    example: ["us-central1-a", "us-east1-b"]
```

---

## GitHub

### System Identifier

```typescript
// Extract organization from first call
private async getOrganization(): Promise<string> {
  if (!this.orgName) {
    // May need to call getOrganization or extract from auth
    const user = await this.github.getAuthenticatedUser();
    this.orgName = user.login;  // or from parameters
  }
  return this.orgName;
}
```

### GroupId Patterns

**Organization-level:**
```typescript
groupId = `${orgName}-repos`;
groupId = `${orgName}-users`;
```

**Repository-level (if collecting repo-specific data):**
```typescript
groupId = `${orgName}-${repoName}-issues`;
```

### ID Patterns

**URL-based or node_id:**
```typescript
id: resource.node_id  // GitHub's stable identifier
// OR
id: resource.html_url  // Unique URL
```

### Common Parameters

```yaml
properties:
  organizations:
    type: array
    description: GitHub organizations to collect from
    items:
      type: string
    example: ["myorg", "anotherorg"]
  enterprise:
    type: string
    description: GitHub Enterprise account name
```

### Pagination

**GitHub specifics:**
- Max page size: 100 (hard limit)
- Rate limit: 5000 requests/hour for authenticated
- **Must respect rate limits - use lower concurrency**

```typescript
const repos = await this.github.listRepositories(
  org,
  1,    // page
  100   // pageSize - GitHub maximum
);

// Use lower concurrency due to rate limits
await repos.forEach(async (repo) => {
  // Process
}, 3);  // Only 3 concurrent - respect rate limits
```

---

## Microsoft 365 / Entra ID

### System Identifier

```typescript
// From tenant ID in metadata or first call
private async getTenantId(): Promise<string> {
  if (!this.tenantId) {
    const org = await this.entra.getOrganization();
    this.tenantId = org.id;
  }
  return this.tenantId;
}
```

### GroupId Patterns

**Tenant-level:**
```typescript
groupId = `${tenantId}-users`;
groupId = `${tenantId}-groups`;
```

### ID Patterns

**Object ID (Microsoft Graph):**
```typescript
id: resource.id  // Microsoft provides GUIDs
```

### Common Parameters

```yaml
properties:
  skipUserTypes:
    type: array
    description: User types to skip (e.g., Guest, External)
    items:
      type: string
```

---

## Generic SaaS / Multi-Tenant

### System Identifier

```typescript
// Usually from auth response or account endpoint
private async getTenantId(): Promise<string> {
  if (!this.tenantId) {
    const account = await this.module.getCurrentAccount();
    this.tenantId = account.id || account.tenantId || account.accountId;
  }
  return this.tenantId;
}
```

### GroupId Patterns

**Per-tenant:**
```typescript
groupId = `${tenantId}-${resourceType}`;
```

### ID Patterns

**Composite with tenant:**
```typescript
id: `${tenantId}:${resourceType}:${resourceId}`
```

---

## Shared/Reference Data Collectors

### System Identifier

**No system identifier needed** - data is global/shared.

### GroupId Patterns

**Global shared data:**
```typescript
groupId = '';  // Empty string - applies to all systems
// OR
groupId = 'global';  // Explicit global scope
```

### ID Patterns

**Standard identifiers:**
```typescript
// Use standard code/identifier from the data itself
id: standard.code  // e.g., "CVE-2024-1234", "NIST-800-53"
```

### Examples

- AWS Service Catalog (shared service definitions)
- NIST CVE database
- Standard compliance frameworks
- Product/service reference lists

---

## Summary: Quick Decision Tree

**Determining GroupId:**
```
Has account/subscription concept?
├─ Yes, regional data?
│  ├─ Yes → ${account}-${region}
│  └─ No → ${account}-global-${service}
└─ No account concept?
   ├─ Has org/tenant?
   │  └─ Yes → ${org}-${resourceType}
   └─ Shared data?
      └─ Yes → '' or 'global'
```

**Determining ID:**
```
Has unique natural ID?
├─ ARN? → Use ARN
├─ Resource ID? → Use resource ID
├─ Email/Username? → Use it
└─ No single field?
   └─ Composite: ${field1}:${field2}:${field3}
```

**Determining Pagination:**
```
Vendor API limit?
├─ GitHub → 100 max, use low concurrency (3)
├─ AWS → 1000 max, default concurrency OK
├─ Azure → 100-1000, default OK
└─ Unknown → Start with 1000, default concurrency
```

---

*Last Updated: 2024-12-16*
