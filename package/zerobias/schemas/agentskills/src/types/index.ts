export { AgentSkill } from '@zerobias-org/schema-zerobias-schemas-agentskills-ts/dist/src/index.js';

/**
 * Parsed YAML frontmatter from a SKILL.md file.
 */
export interface SkillFrontmatter {
  name: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string | string[];
}