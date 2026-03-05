import { URL } from '@zerobias-org/types-core-js';
import { AgentSkill, SkillFrontmatter } from './types/index.js';

/**
 * Regex-based fallback for extracting frontmatter key-value pairs
 * when the YAML parser fails on malformed content (e.g. unquoted commas, stray quotes).
 */
export function parseFrontmatterLoose(raw: string): SkillFrontmatter | undefined {
  const result: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (match) {
      const key = match[1].trim();
      // Strip surrounding quotes and trailing commas from values
      const value = match[2].replaceAll(/^["']|["'],?\s*$/g, '').trim();
      if (value) result[key] = value;
    }
  }

  if (!result.name) return undefined;

  return {
    name: result.name,
    description: result.description,
    license: result.license,
    compatibility: result.compatibility,
    'allowed-tools': result['allowed-tools'],
    metadata: result.author || result.version
      ? { ...(result.author && { author: result.author }), ...(result.version && { version: result.version }) }
      : undefined,
  };
}

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
// Characters forbidden in batch item IDs
const INVALID_ID_CHARS = /[\s,{}[\]()]/g;

export function toAgentSkill(
  fm: SkillFrontmatter,
  bodyContent: string,
  owner: string,
  repo: string,
  filePath: string
): AgentSkill {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const externalId = `${owner}/${repo}:${filePath}`.replaceAll(INVALID_ID_CHARS, '_');

  return {
    id: externalId,
    externalId,
    name: String(fm.name),
    description: fm.description != null ? String(fm.description) : undefined,
    url: new URL(`${repoUrl}/blob/HEAD/${filePath}`),
    license: fm.license != null ? String(fm.license) : undefined,
    compatibility: fm.compatibility != null ? String(fm.compatibility) : undefined,
    author: fm.metadata?.author,
    skillVersion: fm.metadata?.version,
    sourceRepo: repoUrl,
    sourcePath: filePath,
    allowedTools: Array.isArray(fm['allowed-tools']) ? fm['allowed-tools'].join(' ') : fm['allowed-tools'],
    bodyContent,
  };
}
