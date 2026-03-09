export { McpServer, McpTool } from '@zerobias-org/schema-zerobias-schemas-mcpservers-ts/dist/src/index.js';

export interface McpServerEntry {
  name: string;
  description: string;
  vendor: string;
  sourceRepo: string;
  category: string;
  license?: string;
  transportTypes?: string;
  authType?: string;
  isOfficial: boolean;
  packageName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  tools: McpToolEntry[];
  /** Internal: relative directory path for tool discovery */
  _serverDir?: string | null;
}

export interface McpToolEntry {
  name: string;
  description: string;
  serverName: string;
  inputSchema?: string;
  category?: string;
  isDestructive?: boolean;
  requiresAuth?: boolean;
}

export interface SourceResult {
  servers: McpServerEntry[];
  errors: string[];
}
