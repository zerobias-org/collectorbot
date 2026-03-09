/**
 * Fetches and parses MCP server listings from GitHub repository README files.
 * Discovers tools by fetching per-server README files and parsing tool sections.
 *
 * Supports:
 * - modelcontextprotocol/servers (official registry)
 * - awslabs/mcp (AWS MCP servers)
 * - Other repos with standardized MCP server README listings
 */

import { McpServerEntry, McpToolEntry, SourceResult } from '../types/index.js';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';

interface RepoConfig {
  owner: string;
  repo: string;
  vendor: string;
  isOfficial: boolean;
  category?: string;
}

const KNOWN_REPOS: Record<string, RepoConfig> = {
  'modelcontextprotocol/servers': {
    owner: 'modelcontextprotocol',
    repo: 'servers',
    vendor: 'Anthropic',
    isOfficial: true,
    category: 'reference',
  },
  'awslabs/mcp': {
    owner: 'awslabs',
    repo: 'mcp',
    vendor: 'Amazon',
    isOfficial: true,
    category: 'cloud',
  },
};

export class GitHubReadmeHandler {
  private concurrency = 10;

  /**
   * Collect MCP server entries from a GitHub repository README.
   */
  async collectFromRepo(repoStr: string, collectTools = true): Promise<SourceResult> {
    const servers: McpServerEntry[] = [];
    const errors: string[] = [];

    const config = KNOWN_REPOS[repoStr];
    const [owner, repo] = repoStr.split('/');

    try {
      const readmeUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/main/README.md`;
      const response = await fetch(readmeUrl);

      if (!response.ok) {
        errors.push(`Failed to fetch README from ${repoStr}: ${response.status}`);
        return { servers, errors };
      }

      const content = await response.text();
      const effectiveConfig = config || {
        owner,
        repo,
        vendor: owner,
        isOfficial: false,
      };
      const parsed = this.parseReadme(content, effectiveConfig);

      servers.push(...parsed.servers);
      errors.push(...parsed.errors);

      // Discover tools from per-server READMEs
      if (collectTools) {
        await this.discoverTools(servers, effectiveConfig, errors);
      }
    } catch (error) {
      errors.push(`Error processing ${repoStr}: ${(error as Error).message}`);
    }

    return { servers, errors };
  }

  /**
   * Parse a README.md file to extract MCP server entries.
   * Looks for markdown table rows and list items with server descriptions.
   */
  private parseReadme(content: string, config: RepoConfig): SourceResult {
    const servers: McpServerEntry[] = [];
    const errors: string[] = [];

    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      // Track section headers
      if (line.startsWith('#')) {
        currentSection = line.replace(/^#+\s*/, '').trim().toLowerCase();
        continue;
      }

      // Parse table rows: | [Name](url) | description |
      const tableMatch = line.match(
        /\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|/
      );
      if (tableMatch) {
        const [, name, url, description] = tableMatch;
        const server = this.createServerEntry(
          name.trim(),
          description.trim(),
          url.trim(),
          config,
          currentSection
        );
        if (server) servers.push(server);
        continue;
      }

      // Parse list items: - **[Name](url)** - description
      const linkedListMatch = line.match(
        /^[-*]\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*[-–—]\s*(.+)/
      );
      if (linkedListMatch) {
        const [, name, url, description] = linkedListMatch;
        const server = this.createServerEntry(
          name.trim(),
          description.trim(),
          url.trim(),
          config,
          currentSection
        );
        if (server) servers.push(server);
        continue;
      }

      // Parse list items: - **Name** - description (no link)
      const listMatch = line.match(
        /^[-*]\s+\*\*([^*]+)\*\*\s*[-–—]\s*(.+)/
      );
      if (listMatch) {
        const [, name, description] = listMatch;
        const server = this.createServerEntry(
          name.trim(),
          description.trim(),
          `https://github.com/${config.owner}/${config.repo}`,
          config,
          currentSection
        );
        if (server) servers.push(server);
      }
    }

    return { servers, errors };
  }

  /**
   * Fetch per-server READMEs and extract tool definitions.
   */
  private async discoverTools(
    servers: McpServerEntry[],
    config: RepoConfig,
    errors: string[]
  ): Promise<void> {
    const executing = new Set<Promise<void>>();

    for (const server of servers) {
      const p = this.fetchServerTools(server, config, errors)
        .then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= this.concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
  }

  private async fetchServerTools(
    server: McpServerEntry,
    config: RepoConfig,
    errors: string[]
  ): Promise<void> {
    const serverDir = (server as any)._serverDir || this.extractServerDir(server.sourceRepo, config);
    if (!serverDir) return;

    const readmeUrl = `${GITHUB_RAW_BASE}/${config.owner}/${config.repo}/main/${serverDir}/README.md`;

    try {
      const response = await fetch(readmeUrl);
      if (!response.ok) return; // Many servers won't have READMEs

      const content = await response.text();
      const tools = this.parseToolsFromReadme(content, server.name);
      server.tools = tools;
    } catch {
      // Silently skip — tool discovery is best-effort
    }
  }

  /**
   * Extract the directory path from a server's source URL.
   * e.g. "src/filesystem" from "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem"
   * or "src/filesystem" from a relative "src/filesystem" link
   */
  private extractServerDir(sourceUrl: string, config: RepoConfig): string | null {
    // Relative path like "src/server-name"
    if (sourceUrl.startsWith('src/')) {
      return sourceUrl;
    }

    // Full GitHub URL
    const repoBase = `https://github.com/${config.owner}/${config.repo}`;
    if (sourceUrl.startsWith(repoBase)) {
      // Extract path after /tree/main/ or /blob/main/
      const match = sourceUrl.match(/(?:tree|blob)\/[^/]+\/(.+)/);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Parse tool definitions from a server's README.
   * Supports two patterns:
   * 1. Bullet list: - **tool_name** followed by description sub-bullet
   * 2. H3 heading: ### tool_name followed by description paragraph
   */
  private parseToolsFromReadme(content: string, serverName: string): McpToolEntry[] {
    const toolsSection = this.extractSection(content, 'tools');
    if (!toolsSection) return [];

    // Try bullet list pattern first (modelcontextprotocol style)
    const bulletTools = this.parseBulletTools(toolsSection, serverName);
    if (bulletTools.length > 0) return bulletTools;

    // Try heading pattern (awslabs style)
    const headingTools = this.parseHeadingTools(toolsSection, serverName);
    if (headingTools.length > 0) return headingTools;

    return [];
  }

  /**
   * Extract a markdown section by heading name.
   * Returns content from the heading to the next heading of equal/higher level.
   */
  private extractSection(content: string, sectionName: string): string | null {
    const lines = content.split('\n');
    let capturing = false;
    let captureLevel = 0;
    const captured: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim().toLowerCase();

        if (capturing) {
          // Stop at same or higher level heading
          if (level <= captureLevel) break;
        }

        if (title.includes(sectionName.toLowerCase())) {
          capturing = true;
          captureLevel = level;
          continue;
        }
      }

      if (capturing) {
        captured.push(line);
      }
    }

    return captured.length > 0 ? captured.join('\n') : null;
  }

  /**
   * Parse bullet-list style tools:
   * - **tool_name**
   *   - Description text
   */
  private parseBulletTools(section: string, serverName: string): McpToolEntry[] {
    const tools: McpToolEntry[] = [];
    const lines = section.split('\n');

    let currentTool: string | null = null;
    let currentDesc: string | null = null;

    for (const line of lines) {
      // Match: - **tool_name** or - `tool_name`
      const toolMatch = line.match(/^[-*]\s+\*\*`?([a-zA-Z_][a-zA-Z0-9_]*)`?\*\*/);
      if (toolMatch) {
        // Save previous tool
        if (currentTool) {
          tools.push(this.createToolEntry(currentTool, currentDesc, serverName));
        }
        currentTool = toolMatch[1];
        currentDesc = null;

        // Check for inline description: - **tool_name** - description
        const inlineDesc = line.match(/\*\*\s*[-–—:]\s*(.+)/);
        if (inlineDesc) {
          currentDesc = inlineDesc[1].trim();
        }
        continue;
      }

      // Match: - `tool_name` — description (backtick style without bold)
      const backtickMatch = line.match(/^[-*]\s+`([a-zA-Z_][a-zA-Z0-9_]*)`\s*[-–—:]\s*(.+)/);
      if (backtickMatch) {
        if (currentTool) {
          tools.push(this.createToolEntry(currentTool, currentDesc, serverName));
        }
        currentTool = backtickMatch[1];
        currentDesc = backtickMatch[2].trim();
        continue;
      }

      // Capture first sub-bullet as description if we don't have one yet
      if (currentTool && !currentDesc) {
        const descMatch = line.match(/^\s+[-*]\s+([^`].+)/);
        if (descMatch && !descMatch[1].toLowerCase().startsWith('input')) {
          currentDesc = descMatch[1].trim();
        }
      }
    }

    // Don't forget last tool
    if (currentTool) {
      tools.push(this.createToolEntry(currentTool, currentDesc, serverName));
    }

    return tools;
  }

  /**
   * Parse heading-style tools:
   * ### tool_name
   *
   * Description paragraph.
   */
  private parseHeadingTools(section: string, serverName: string): McpToolEntry[] {
    const tools: McpToolEntry[] = [];
    const lines = section.split('\n');

    let currentTool: string | null = null;
    let currentDesc: string | null = null;
    let lookingForDesc = false;

    for (const line of lines) {
      // Match: ### tool_name or ### tool_name (scope)
      const headingMatch = line.match(/^#{3,4}\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?(?:\s*\(.*\))?\s*$/);
      if (headingMatch) {
        if (currentTool) {
          tools.push(this.createToolEntry(currentTool, currentDesc, serverName));
        }
        currentTool = headingMatch[1];
        currentDesc = null;
        lookingForDesc = true;
        continue;
      }

      // Capture first non-empty paragraph as description
      if (lookingForDesc && currentTool) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('```') && !trimmed.startsWith('#')) {
          currentDesc = trimmed;
          lookingForDesc = false;
        }
      }
    }

    if (currentTool) {
      tools.push(this.createToolEntry(currentTool, currentDesc, serverName));
    }

    return tools;
  }

  private createToolEntry(name: string, description: string | null, serverName: string): McpToolEntry {
    return {
      name,
      description: description || name,
      serverName,
      category: this.inferToolCategory(name, description || ''),
    };
  }

  private createServerEntry(
    name: string,
    description: string,
    sourceUrl: string,
    config: RepoConfig,
    section: string
  ): McpServerEntry | null {
    // Skip header/separator rows
    if (name.startsWith('-') || name.toLowerCase() === 'name') return null;

    const category = this.inferCategory(name, description, section, config.category);

    // Preserve the relative path for tool discovery (e.g. "src/filesystem")
    const _serverDir = sourceUrl.startsWith('http') ? null : sourceUrl;
    const fullUrl = sourceUrl.startsWith('http') ? sourceUrl : `https://github.com/${config.owner}/${config.repo}`;

    return {
      name,
      description: description.replace(/\s*\|$/, '').trim(),
      vendor: config.vendor,
      sourceRepo: fullUrl,
      category,
      isOfficial: config.isOfficial,
      transportTypes: 'stdio',
      tools: [],
      _serverDir,
    };
  }

  private inferToolCategory(name: string, description: string): string {
    const text = `${name} ${description}`.toLowerCase();
    if (text.includes('read') || text.includes('get') || text.includes('list') || text.includes('search') || text.includes('describe')) return 'read';
    if (text.includes('write') || text.includes('create') || text.includes('put') || text.includes('update') || text.includes('delete')) return 'write';
    if (text.includes('query') || text.includes('execute') || text.includes('run')) return 'query';
    return 'general';
  }

  private inferCategory(name: string, description: string, section: string, defaultCategory?: string): string {
    const text = `${name} ${description} ${section}`.toLowerCase();

    if (text.includes('database') || text.includes('sql') || text.includes('dynamo') || text.includes('redis')) return 'database';
    if (text.includes('cloud') || text.includes('aws') || text.includes('azure') || text.includes('gcp')) return 'cloud';
    if (text.includes('git') || text.includes('code') || text.includes('developer')) return 'devtools';
    if (text.includes('ai') || text.includes('ml') || text.includes('bedrock') || text.includes('llm')) return 'ai-ml';
    if (text.includes('container') || text.includes('kubernetes') || text.includes('docker') || text.includes('ecs') || text.includes('eks')) return 'containers';
    if (text.includes('serverless') || text.includes('lambda') || text.includes('function')) return 'serverless';
    if (text.includes('messaging') || text.includes('queue') || text.includes('sns') || text.includes('sqs') || text.includes('slack')) return 'messaging';
    if (text.includes('security') || text.includes('iam') || text.includes('auth')) return 'security';
    if (text.includes('monitor') || text.includes('observ') || text.includes('log') || text.includes('cloudwatch')) return 'observability';
    if (text.includes('file') || text.includes('storage') || text.includes('s3') || text.includes('blob')) return 'storage';
    if (text.includes('search') || text.includes('analytics')) return 'analytics';

    return defaultCategory || 'general';
  }
}
