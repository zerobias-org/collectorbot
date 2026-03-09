/**
 * MCP Servers Collector - discovers MCP server definitions from GitHub
 * repositories and loads them into AuditgraphDB as McpServer and McpTool objects.
 *
 * Default sources:
 * - modelcontextprotocol/servers (official MCP registry)
 * - awslabs/mcp (AWS MCP servers)
 *
 * Additional sources can be provided via parameters.
 */

import { UUID } from '@zerobias-org/types-core-js';
import { BatchManager, splitArrayBySize } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { Parameters } from '../generated/model/index.js';

import { GitHubReadmeHandler } from './handlers/index.js';
import { mapServer, mapTool } from './mappers.js';

import { LoggerEngine } from '@zerobias-org/logger';

const LOGGER_NAME = 'McpServersCollector';
const DEFAULT_CONCURRENCY = 5;

const DEFAULT_SOURCES = [
  'modelcontextprotocol/servers',
  'awslabs/mcp',
];

@injectable()
export class CollectorZerbiasMcpserversImpl extends BaseClient {
  override logger: LoggerEngine = LoggerEngine.root().get(LOGGER_NAME);

  private batchManager!: BatchManager;

  private _jobId?: UUID;

  private get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  private get previewCount(): number | undefined {
    return this.context.previewMode ? this.context.previewCount : undefined;
  }

  private static validateParameters(parameters?: Parameters): Parameters {
    if (!parameters) {
      return {};
    }

    if (parameters.sources) {
      for (const source of parameters.sources) {
        const parts = String(source).split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw new Error(`Invalid source format: "${source}". Expected "owner/repo".`);
        }
      }
    }

    return parameters;
  }

  private resolveSources(parameters: Parameters): string[] {
    const extras = (parameters.sources || []).map(String);
    const all = [...DEFAULT_SOURCES, ...extras];

    const seen = new Set<string>();
    return all.filter((s) => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  public async run(parameters?: Parameters): Promise<any> {
    const validatedParams = CollectorZerbiasMcpserversImpl.validateParameters(parameters);
    this.batchManager = new BatchManager(this.platform, this.logger, this.jobId);

    const sources = this.resolveSources(validatedParams);
    const concurrency = validatedParams.concurrency && validatedParams.concurrency > 0
      ? validatedParams.concurrency
      : DEFAULT_CONCURRENCY;

    const collectTools = validatedParams.collectTools !== false;

    this.logger.info(`Collecting MCP servers from ${sources.length} sources (concurrency: ${concurrency}, collectTools: ${collectTools})`);

    const handler = new GitHubReadmeHandler();
    const serverBatch = await this.batchManager.initBatch('McpServer', 'mcp-registry');
    const toolBatch = collectTools
      ? await this.batchManager.initBatch('McpTool', 'mcp-registry')
      : null;

    let completed = 0;
    let totalServers = 0;
    let totalTools = 0;

    const processSource = async (sourceStr: string) => {
      const progress = `[${++completed}/${sources.length}]`;

      try {
        const { servers, errors } = await handler.collectFromRepo(sourceStr, collectTools);

        this.logger.info(`${progress} Found ${servers.length} servers in ${sourceStr}`);

        for (const error of errors) {
          this.logger.warn(`${sourceStr}: ${error}`);
        }

        // Apply serverLimit if set
        let serversToProcess = servers;
        if (validatedParams.serverLimit && validatedParams.serverLimit > 0) {
          serversToProcess = servers.slice(0, validatedParams.serverLimit);
        }

        if (serversToProcess.length > 0) {
          const serverPayloads = serversToProcess.map(mapServer);
          const { chunks, largeItems } = splitArrayBySize(serverPayloads);

          for (const chunk of chunks) {
            await serverBatch.addItems(chunk.map((payload) => ({ payload })));
          }
          for (const item of largeItems) {
            await serverBatch.add(item);
          }
          totalServers += serversToProcess.length;

          // Collect tools if enabled
          if (toolBatch && collectTools) {
            for (const server of serversToProcess) {
              if (server.tools.length > 0) {
                const toolPayloads = server.tools.map(mapTool);
                const toolChunks = splitArrayBySize(toolPayloads);

                for (const chunk of toolChunks.chunks) {
                  await toolBatch.addItems(chunk.map((payload) => ({ payload })));
                }
                for (const item of toolChunks.largeItems) {
                  await toolBatch.add(item);
                }
                totalTools += server.tools.length;
              }
            }
          }
        }
      } catch (error) {
        this.logger.error(`${progress} Error collecting from ${sourceStr}: ${(error as Error).message}`, error);
      }
    };

    // Process sources with bounded concurrency
    const executing = new Set<Promise<void>>();
    for (const sourceStr of sources) {
      const p = processSource(sourceStr).then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    await serverBatch.end();
    if (toolBatch) await toolBatch.end();

    this.logger.info(`Collection complete. ${totalServers} servers, ${totalTools} tools. ${this.batchManager.getSummary()}`);
  }
}
