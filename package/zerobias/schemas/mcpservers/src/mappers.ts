/**
 * Maps raw MCP server/tool data to AuditgraphDB batch item payloads.
 */

import { v5 as uuidv5 } from 'uuid';
import { McpServer, McpTool } from '@zerobias-org/schema-zerobias-schemas-mcpservers-ts/dist/src/index.js';
import { McpServerEntry, McpToolEntry } from './types/index.js';

const MCP_NAMESPACE = '8b36b97d-9856-523b-910d-e98c717fc42d';

/**
 * Generate a deterministic UUID from a server name + vendor.
 */
export function serverObjectId(server: McpServerEntry): string {
  return uuidv5(`mcpserver:${server.vendor}:${server.name}`, MCP_NAMESPACE);
}

/**
 * Generate a deterministic UUID from a tool name + server name.
 */
export function toolObjectId(tool: McpToolEntry): string {
  return uuidv5(`mcptool:${tool.serverName}:${tool.name}`, MCP_NAMESPACE);
}

/**
 * Map an McpServerEntry to an AuditgraphDB batch item payload.
 */
export function mapServer(server: McpServerEntry): Partial<McpServer> & { id: string; className: string } {
  return {
    id: serverObjectId(server),
    className: 'McpServer',
    name: server.name,
    description: server.description,
    vendor: server.vendor,
    sourceRepo: server.sourceRepo,
    transportTypes: server.transportTypes,
    category: server.category,
    license: server.license,
    serverVersion: server.serverVersion,
    protocolVersion: server.protocolVersion,
    authType: server.authType,
    toolCount: server.tools.length,
    resourceCount: 0,
    promptCount: 0,
    isOfficial: server.isOfficial,
    packageName: server.packageName,
  };
}

/**
 * Map an McpToolEntry to an AuditgraphDB batch item payload.
 */
export function mapTool(tool: McpToolEntry): Partial<McpTool> & { id: string; className: string } {
  return {
    id: toolObjectId(tool),
    className: 'McpTool',
    name: tool.name,
    description: tool.description,
    serverName: tool.serverName,
    inputSchema: tool.inputSchema,
    category: tool.category,
    isDestructive: tool.isDestructive,
    requiresAuth: tool.requiresAuth,
  };
}
