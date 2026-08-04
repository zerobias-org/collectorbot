import type { Resource, ResourceContainer } from '@zerobias-org/module-microsoft-azure-azureresourcegraph';
import {
  AzureResourceGraph,
  AzureResourceGraphResource,
  AzureResourceGraphResourceType
} from '@zerobias-org/schema-microsoft-azure-azureresourcegraph-ts/dist/index.js';
import {
  AzureResourceGroup,
  AzureSubscription,
  AzureSubscriptionState
} from '@zerobias-org/schema-microsoft-azure-ts/dist/index.js';

function toSafeId(id: string): string {
  return id.replace(/[[\]$]+/g, '_');
}

/**
 * ARM IDs are case-insensitive (the resource-group segment in particular comes
 * back with inconsistent casing between the Resources and ResourceContainers
 * tables), so every derived object ID is lowercased for join stability.
 */
function normalizeArmId(id?: string): string {
  return (id ?? '').toLowerCase();
}

/** Stable ID for an AzureResourceGroup row: subscription GUID + lowercased name. */
export function toResourceGroupId(subscriptionId?: string, resourceGroup?: string): string | undefined {
  if (!subscriptionId || !resourceGroup) {
    return undefined;
  }
  return `rg:${subscriptionId}/${resourceGroup.toLowerCase()}`;
}

/** Stable ID for an AzureResourceGraphResourceType row: the lowercased ARM type. */
export function toResourceTypeId(type?: string): string | undefined {
  return type ? type.toLowerCase() : undefined;
}

function extractTags(tags?: Record<string, string>): { key: string; value?: string }[] {
  return Object.entries(tags ?? {}).map(([key, value]) => ({ key, value }));
}

export function toResourceGraph(appId: string, tenantId: string): AzureResourceGraph {
  return {
    id: appId,
    name: `Azure Resource Graph for ${tenantId}`,
    description: `Azure Resource Graph inventory for tenant ${tenantId}`,
  } as AzureResourceGraph;
}

export function toResourceGraphResource(appId: string, resource: Resource): AzureResourceGraphResource {
  const armId = normalizeArmId(`${resource.id}`);
  return {
    id: toSafeId(`i:${armId}`),
    app: appId,
    name: `${resource.name ?? armId}`,
    description: `${resource.type} resource in ${resource.location ?? 'unknown region'}`,
    region: resource.location || undefined,
    tag: extractTags(resource.tags as Record<string, string> | undefined),
    resourceType: toResourceTypeId(resource.type ? `${resource.type}` : undefined),
    subscription: resource.subscriptionId ? `${resource.subscriptionId}` : undefined,
    // NOTE: property name carries the suite-schema typo (AzureInventoryItem
    // declares `resoruceGroup`) — intentional, must match the schema.
    resoruceGroup: toResourceGroupId(
      resource.subscriptionId ? `${resource.subscriptionId}` : undefined,
      resource.resourceGroup ? `${resource.resourceGroup}` : undefined
    ),
  } as AzureResourceGraphResource;
}

export function toResourceGraphResourceType(type: string): AzureResourceGraphResourceType {
  return {
    id: toResourceTypeId(type),
    name: type,
    description: `Azure resource type ${type}`,
  } as AzureResourceGraphResourceType;
}

function toSubscriptionState(state?: string): any {
  switch ((state ?? '').toLowerCase()) {
    case 'enabled': return AzureSubscriptionState.ENABLED;
    case 'disabled': return AzureSubscriptionState.DISABLED;
    case 'deleted': return AzureSubscriptionState.DELETED;
    case 'pastdue': return AzureSubscriptionState.PASTDUE;
    case 'warned': return AzureSubscriptionState.WARNED;
    default: return undefined;
  }
}

export function toSubscription(container: ResourceContainer): AzureSubscription {
  const properties = (container.properties ?? {}) as Record<string, any>;
  return {
    id: `${container.subscriptionId}`,
    name: `${container.name ?? container.subscriptionId}`,
    description: `Azure subscription ${container.name ?? container.subscriptionId}`,
    state: toSubscriptionState(properties.state ? `${properties.state}` : undefined),
    tenant: container.tenantId ? `${container.tenantId}` : undefined,
  } as AzureSubscription;
}

export function toResourceGroup(container: ResourceContainer): AzureResourceGroup {
  return {
    id: toResourceGroupId(
      container.subscriptionId ? `${container.subscriptionId}` : undefined,
      container.name ? `${container.name}` : undefined
    ),
    name: `${container.name}`,
    description: `Azure resource group ${container.name}`,
    subscription: container.subscriptionId ? `${container.subscriptionId}` : undefined,
  } as AzureResourceGroup;
}
