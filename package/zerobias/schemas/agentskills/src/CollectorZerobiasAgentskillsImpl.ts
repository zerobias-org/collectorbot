/**
 * Agent Skills Collector - discovers SKILL.md files from GitHub repositories
 * and loads them into AuditgraphDB as AgentSkill objects.
 */

import { UUID } from '@zerobias-org/types-core-js';
import { BatchManager } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { BaseClient } from '../generated/BaseClient';
import { Parameters } from '../generated/model';

import { GitHubHandler, discoverRepos } from './handlers';

import { LoggerEngine } from '@zerobias-org/logger';

const LOGGER_NAME = 'AgentSkillsCollector';

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

    this.logger.info(`Collecting skills from ${repos.length} repositories`);

    const handler = new GitHubHandler({ token: validatedParameters.githubToken });
    const batch = await this.batchManager.initBatch('AgentSkill', 'skills.sh');

    for (let index = 0; index < repos.length; index++) {
      const [owner, repo] = String(repos[index]).split('/');
      const repoId = `${owner}/${repo}`;
      const progress = `[${index + 1}/${repos.length}]`;

      this.logger.info(`${progress} Scanning ${repoId}...`);

      try {
        const { skills, errors } = await handler.collectSkills(owner, repo, this.previewCount);

        this.logger.info(`${progress} Found ${skills.length} skills in ${repoId}`);

        for (const error of errors) {
          this.logger.warn(`${progress} ${repoId}: ${error}`);
        }

        for (const skill of skills) {
          await batch.add(skill);
        }
      } catch (error) {
        this.logger.error(`${progress} Error collecting from ${repoId}: ${error.message}`, error);
      }
    }

    await batch.end();

    this.logger.info(`Collection complete. ${this.batchManager.getSummary()}`);
  }
}
