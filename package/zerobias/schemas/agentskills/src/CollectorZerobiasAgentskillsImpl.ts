/**
 * Agent Skills Collector - discovers SKILL.md files from GitHub repositories
 * and loads them into AuditgraphDB as AgentSkill objects.
 *
 * Uses git sparse-checkout (no auth required) to fetch only SKILL.md files
 * from each repository, running repos in parallel for speed.
 */

import { UUID } from '@zerobias-org/types-core-js';
import { BatchManager, splitArrayBySize } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient.js';
import { Parameters } from '../generated/model/index.js';

import { GitSparseHandler, discoverRepos } from './handlers/index.js';

import { LoggerEngine } from '@zerobias-org/logger';

const LOGGER_NAME = 'AgentSkillsCollector';
const DEFAULT_CONCURRENCY = 10;

@injectable()
export class CollectorZerobiasAgentskillsImpl extends BaseClient {
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
      throw new Error('Missing parameters');
    }

    if (parameters.repositories) {
      for (const repo of parameters.repositories) {
        const parts = String(repo).split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw new Error(`Invalid repository format: "${repo}". Expected "owner/repo".`);
        }
      }
    }

    return parameters;
  }

  /**
   * Discover repos from skills.sh and merge with any extra repos from parameters.
   */
  private async resolveRepositories(parameters: Parameters): Promise<string[]> {
    const discovered = await discoverRepos();
    this.logger.info(`Discovered ${discovered.length} repos from skills.sh`);

    const extras = (parameters.repositories || []).map(String);
    const all = [...discovered, ...extras];

    const seen = new Set<string>();
    return all.filter((r) => {
      const key = r.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  public async run(parameters?: Parameters): Promise<any> {
    const validatedParameters = CollectorZerobiasAgentskillsImpl.validateParameters(parameters);
    this.batchManager = new BatchManager(this.platform, this.logger, this.jobId);

    let repos = await this.resolveRepositories(validatedParameters);

    if (validatedParameters.repoLimit && validatedParameters.repoLimit > 0) {
      this.logger.info(`Limiting to ${validatedParameters.repoLimit} of ${repos.length} repositories`);
      repos = repos.slice(0, validatedParameters.repoLimit);
    }

    const concurrency = validatedParameters.concurrency && validatedParameters.concurrency > 0
      ? validatedParameters.concurrency
      : DEFAULT_CONCURRENCY;

    this.logger.info(`Collecting skills from ${repos.length} repositories (concurrency: ${concurrency})`);

    const handler = new GitSparseHandler();
    const batch = await this.batchManager.initBatch('AgentSkill', 'skills.sh');

    let completed = 0;

    // Process repos in parallel with bounded concurrency using a simple pool
    const processRepo = async (repoStr: string) => {
      const [owner, repo] = String(repoStr).split('/');
      const repoId = `${owner}/${repo}`;
      const progress = `[${++completed}/${repos.length}]`;

      try {
        const { skills, errors } = await handler.collectSkills(owner, repo, this.previewCount);

        this.logger.info(`${progress} Found ${skills.length} skills in ${repoId}`);

        for (const error of errors) {
          this.logger.warn(`${repoId}: ${error}`);
        }

        if (skills.length > 0) {
          const { chunks, largeItems } = splitArrayBySize(skills);

          for (const chunk of chunks) {
            await batch.addItems(chunk.map((skill) => ({ payload: skill })));
          }

          for (const item of largeItems) {
            await batch.add(item);
          }
        }
      } catch (error) {
        this.logger.error(`${progress} Error collecting from ${repoId}: ${error.message}`, error);
      }
    };

    // Simple concurrency pool
    const executing = new Set<Promise<void>>();
    for (const repoStr of repos) {
      const p = processRepo(repoStr).then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    await batch.end();

    this.logger.info(`Collection complete. ${this.batchManager.getSummary()}`);
  }
}
