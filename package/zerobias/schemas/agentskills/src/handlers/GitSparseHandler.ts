import { execFile } from 'node:child_process';
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import { AgentSkill, SkillFrontmatter } from '../types/index.js';
import { parseFrontmatter, parseFrontmatterLoose, toAgentSkill } from '../mappers.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;

// Prevent git from prompting for credentials (hangs in non-interactive environments)
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };

/**
 * Collect SKILL.md files from a GitHub repository using git sparse-checkout.
 * No authentication required for public repos. ~10x faster than GitHub API approach.
 *
 * Strategy:
 *   1. git clone --filter=blob:none --no-checkout --depth=1 <url> <tmpdir>
 *   2. git sparse-checkout set --no-cone '** /SKILL.md'  (fetches only SKILL.md blobs)
 *   3. git checkout
 *   4. Walk the filesystem to find all SKILL.md files
 *   5. Parse frontmatter + body, map to AgentSkill objects
 *   6. Clean up tmpdir
 */
export class GitSparseHandler {
  /**
   * Collect all SKILL.md files from a single repo.
   */
  async collectSkills(
    owner: string,
    repo: string,
    limit?: number
  ): Promise<{ skills: AgentSkill[]; errors: string[] }> {
    const skills: AgentSkill[] = [];
    const errors: string[] = [];
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    const tmpDir = await mkdtemp(join(tmpdir(), `zb-skills-${owner}-${repo}-`));

    try {
      // 1. Clone with blob filter (downloads only tree objects, no file content yet)
      await execFileAsync(
        'git',
        ['clone', '--filter=blob:none', '--no-checkout', '--depth=1', repoUrl, tmpDir],
        { timeout: GIT_TIMEOUT_MS, env: GIT_ENV }
      );

      // 2. Configure sparse-checkout to only fetch SKILL.md files
      await execFileAsync('git', ['sparse-checkout', 'set', '--no-cone', '**/SKILL.md'], {
        cwd: tmpDir,
        timeout: GIT_TIMEOUT_MS,
        env: GIT_ENV,
      });

      // 3. Checkout (fetches only the SKILL.md blobs)
      await execFileAsync('git', ['checkout'], {
        cwd: tmpDir,
        timeout: GIT_TIMEOUT_MS,
        env: GIT_ENV,
      });

      // 4. Find all SKILL.md files on disk
      const skillPaths = await findFiles(tmpDir, 'SKILL.md');

      const paths = limit ? skillPaths.slice(0, limit) : skillPaths;

      // 5. Read and parse each file
      
      for (const absPath of paths) {
        const relativePath = absPath.slice(tmpDir.length + 1);
        try {
          const content = await readFile(absPath, 'utf8');
          const { frontmatter: fmRaw, body } = parseFrontmatter(content);

          if (!fmRaw) {
            errors.push(`No frontmatter found in ${relativePath}`);
            continue;
          }

          let fm: SkillFrontmatter;
          try {
            fm = parseYaml(fmRaw, { schema: 'failsafe' });
          } catch {
            const loose = parseFrontmatterLoose(fmRaw);
            if (!loose) {
              errors.push(`Unparseable frontmatter in ${relativePath}`);
              continue;
            }
            fm = loose;
          }

          if (!fm.name) {
            errors.push(`No name in frontmatter for ${relativePath}`);
            continue;
          }

          skills.push(toAgentSkill(fm, body, owner, repo, relativePath));
        } catch (error) {
          errors.push(`Error processing ${relativePath}: ${error.message}`);
        }
      }
    } finally {
      // 6. Clean up temp directory
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    return { skills, errors };
  }
}

/**
 * Recursively find files with a given name under a directory.
 */
async function findFiles(dir: string, fileName: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.git') {
      results.push(...(await findFiles(fullPath, fileName)));
    } else if (entry.isFile() && entry.name === fileName) {
      results.push(fullPath);
    }
  }

  return results;
}
