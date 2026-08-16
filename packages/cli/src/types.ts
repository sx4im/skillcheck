export type SkillFormat = 'SKILL.md' | 'AGENTS.md' | '.cursorrules' | 'CLAUDE.md' | 'markdown';
export type CriterionType = 'rubric' | 'deterministic';

// Progress reporting for a long eval run, so the CLI can show real phases
// (generating tasks, running trials N/M, grading N/M) instead of a fake bar.
export type ProgressPhase = 'generating' | 'running' | 'grading' | 'scoring';
export interface ProgressUpdate {
  phase: ProgressPhase;
  completed?: number;
  total?: number;
}
export type ProgressReporter = (update: ProgressUpdate) => void;

export interface NormalizedSkill {
  name: string;
  sourcePath: string;
  format: SkillFormat;
  instructions: string;
  domain: string;
  assets: string[];
  versionHash: string;
  toolDependent: boolean;
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
  with_skill_pass_rate: number;
  no_skill_pass_rate: number;
}
