/**
 * AgentSkill interface matching the AgentSkill schema class.
 * Defined inline since no -ts TypeScript package exists for this schema.
 */
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  license?: string;
  compatibility?: string;
  author?: string;
  skillVersion?: string;
  sourceRepo?: string;
  sourcePath?: string;
  allowedTools?: string;
  bodyContent?: string;
}

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