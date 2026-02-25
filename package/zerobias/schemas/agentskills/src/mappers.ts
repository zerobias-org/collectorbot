import { AgentSkill, SkillFrontmatter } from './types';

/**
 * Parse SKILL.md content into frontmatter and body.
 * Frontmatter is delimited by --- markers at the start of the file.
 */
export function parseFrontmatter(content: string): { frontmatter: string; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: '', body: content };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: '', body: content };
  }

  const frontmatter = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(Math.max(0, endIndex + 3)).trim();
  return { frontmatter, body };
}

/**
 * Map parsed SKILL.md frontmatter and body to an AgentSkill schema object.
 */
export function toAgentSkill(
  fm: SkillFrontmatter,
  bodyContent: string,
  owner: string,
  repo: string,
  filePath: string
): AgentSkill {
  const repoUrl = `https://github.com/${owner}/${repo}`;

  return {
    id: `${owner}/${repo}:${filePath}`,
    name: fm.name,
    description: fm.description,
    license: fm.license,
    compatibility: fm.compatibility,
    author: fm.metadata?.author,
    skillVersion: fm.metadata?.version,
    sourceRepo: repoUrl,
    sourcePath: filePath,
    allowedTools: Array.isArray(fm['allowed-tools']) ? fm['allowed-tools'].join(' ') : fm['allowed-tools'],
    bodyContent,
  };
}
