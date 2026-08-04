# @zerobias-org/collectorbot-microsoft-azure-azureresourcegraph

Scheduled collector that inventories Azure resources and resource containers
through the Azure Resource Graph query API (api-version `2024-04-01`), via
`@zerobias-org/module-microsoft-azure-azureresourcegraph`.

## What it populates

From `@zerobias-org/schema-microsoft-azure-azureresourcegraph`:

| Class | Source |
|-------|--------|
| `AzureResourceGraph` | One row per tenant — the inventory application (`azure-resource-graph:<tenantId>`) |
| `AzureResourceGraphResource` | Each row of the Resource Graph `Resources` table |
| `AzureResourceGraphResourceType` | Each distinct resource type observed during the run |

From `@zerobias-org/schema-microsoft-azure` (suite):

| Class | Source |
|-------|--------|
| `AzureSubscription` | `ResourceContainers` rows of type `microsoft.resources/subscriptions` |
| `AzureResourceGroup` | `ResourceContainers` rows of type `microsoft.resources/subscriptions/resourcegroups` |

Management group containers (`microsoft.management/managementgroups`) are
returned by the query but skipped — the suite schema has no management-group
class yet.

## Authentication and authorization

The module connects with Azure AD (Entra ID) client credentials
(`directoryId` + `clientId`/`clientSecret`), exchanged for a token with the
Azure Resource Manager audience (scope `https://management.azure.com/.default`).

The service principal needs the **Azure RBAC Reader** role at subscription or
management-group scope. Resource Graph enforces read access per object: rows
the credential cannot read are omitted from results, and the API returns 403
only when nothing is readable at all.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriptions` | `uuid[]` (optional) | Scope collection to these subscription IDs. Tenant-wide when omitted. |
| `skipResourceTypes` | `string[]` (optional) | ARM resource types to skip (case-insensitive), e.g. `microsoft.compute/virtualmachines/extensions`. |

## Test

E2E test lives in `test/e2e/` and only runs when `RUN_E2E=true` is set, against
a real connection.
