export type SkillFormat = 'SKILL.md' | 'AGENTS.md' | '.cursorrules' | 'CLAUDE.md';
export type CriterionType = 'rubric';

export interface NormalizedSkill {
  name: string;
  sourcePath: string;
  format: SkillFormat;
  instructions: string;
  domain: string;
  assets: string[];
  versionHash: string;
}

export interface GeneratedTask {
  id: string;
  prompt: string;
  criterionType: CriterionType;
  criterion: string;
}

export interface TrialOutput {
  taskId: string;
  trial: number;
  arm: 'with_skill' | 'no_skill';
  output: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  transcriptHash: string;
}

export interface GradedOutput extends TrialOutput {
  score: number;
  reason: string;
  pass: boolean;
}

export interface TaskBreakdown {
  id: string;
  prompt: string;
  criterion_type: CriterionType;
  criterion: string;
  arm_a_pass_rate: number;
  arm_b_pass_rate: number;
}
