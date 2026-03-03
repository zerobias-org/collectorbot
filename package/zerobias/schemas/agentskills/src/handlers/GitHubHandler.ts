import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { parse as parseYaml } from 'yaml';
import { AgentSkill, SkillFrontmatter } from '../types/index.js';
import { parseFrontmatter, parseFrontmatterLoose, toAgentSkill } from '../mappers.js';

const ThrottledOctokit = Octokit.plugin(throttling);

export interface GitHubHandlerOptions {
  token?: string;
}

/**
 * Handles GitHub API interactions for discovering and fetching SKILL.md files.
 * Uses Octokit throttling plugin to automatically retry on rate limits.
 */
export class GitHubHandler {
  private octokit: InstanceType<typeof ThrottledOctokit>;

  constructor(options: GitHubHandlerOptions = {}) {
    this.octokit = new ThrottledOctokit({
      auth: options.token || undefined,
      throttle: {
        onRateLimit: (retryAfter, options_, octokit, retryCount) => {
          octokit.log.warn(`Rate limit hit for ${options_.method} ${options_.url} — retrying after ${retryAfter}s (attempt ${retryCount + 1})`);
          return retryCount < 2 && retryAfter < 60;
        },
        onSecondaryRateLimit: (retryAfter, options_, octokit, retryCount) => {
          octokit.log.warn(`Secondary rate limit for ${options_.method} ${options_.url} — retrying after ${retryAfter}s`);
          return retryCount < 1 && retryAfter < 60;
        },
      },
    });
  }

  /**
   * Find all SKILL.md files in a repository using the Git Trees API (recursive).
   */
  async findSkillFiles(owner: string, repo: string): Promise<string[]> {
    const { data } = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: 'HEAD',
      recursive: 'true',
    });

    return data.tree
      .filter((entry) => entry.type === 'blob' && entry.path?.endsWith('/SKILL.md'))
      .map((entry) => entry.path!);
  }

  /**
   * Get the raw content of a file from a repository via the Contents API.
   */
  async getFileContent(owner: string, repo: string, path: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({ owner, repo, path });

    if ('content' in data && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }

    throw new Error(`Unexpected response format for ${path}`);
  }

  /**
   * Fetch and parse all SKILL.md files from a repository into AgentSkill objects.
   * Returns skills and any errors encountered per file.
   */
  async collectSkills(owner: string, repo: string, limit?: number): Promise<{ skills: AgentSkill[]; errors: string[] }> {
    const skills: AgentSkill[] = [];
    const errors: string[] = [];

    const allPaths = await this.findSkillFiles(owner, repo);
    const paths = limit ? allPaths.slice(0, limit) : allPaths;

    for (const filePath of paths) {
      try {
        const content = await this.getFileContent(owner, repo, filePath);
        const { frontmatter: fmRaw, body } = parseFrontmatter(content);

        if (!fmRaw) {
          errors.push(`No frontmatter found in ${filePath}`);
          continue;
        }

        let fm: SkillFrontmatter;
        try {
          fm = parseYaml(fmRaw, { schema: 'failsafe' });
        } catch {
          const loose = parseFrontmatterLoose(fmRaw);
          if (!loose) {
            errors.push(`Unparseable frontmatter in ${filePath}`);
            continue;
          }
          fm = loose;
        }

        if (!fm.name) {
          errors.push(`No name in frontmatter for ${filePath}`);
          continue;
        }

        skills.push(toAgentSkill(fm, body, owner, repo, filePath));
      } catch (error) {
        errors.push(`Error processing ${filePath}: ${error.message}`);
      }
    }

    return { skills, errors };
  }
}
