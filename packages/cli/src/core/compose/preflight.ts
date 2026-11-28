import { estimateTokens, readSkillDocument } from '../normalize/document.js';
import { routingTerms } from '../routing/lexical.js';
import type { NormalizedSkill } from '../types.js';

export type ComposeWarningCode = 'TOKEN_BUDGET' | 'DESCRIPTION_OVERLAP' | 'CONTRADICTORY_INSTRUCTIONS' | 'ALLOWED_TOOLS_CONFLICT';

export interface ComposePreflight {
  estimatedTokens: number;
  warnings: { code: ComposeWarningCode; message: string }[];
}

export function stackInstructions(skills: NormalizedSkill[]): string {
  return skills.map(({ instructions }) => instructions.trim()).join('\n\n---\n\n');
}

type Directive = 'require' | 'forbid';

function directives(body: string): Map<string, Set<Directive>> {
  const byAction = new Map<string, Set<Directive>>();
  const prose = body.replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[^\n]*$/gm, '');
  // Only compare explicitly opposed directives that name the same action.
  const pattern = /^(?:[-*+]\s+|\d+\.\s+)?(?:you\s+)?(?:(must\s+not|never|do\s+not)|must|always)\s+(.+?)\s*[.!]?$/i;
  for (const line of prose.split('\n')) {
    const text = line.trim().replace(/\*\*|__/g, '');
    const match = pattern.exec(text);
    if (!match) continue;
    const action = match[2]!.replace(/`/g, '').replace(/\s+/g, ' ').toLowerCase();
    const direction = match[1] ? 'forbid' : 'require';
    const existing = byAction.get(action) ?? new Set<Directive>();
    existing.add(direction);
    byAction.set(action, existing);
  }
  return byAction;
}

function descriptionSimilarity(left: Set<string>, right: Set<string>): number {
  const shared = [...left].filter((term) => right.has(term)).length;
  return shared / (left.size + right.size - shared || 1);
}

export function analyzeComposition(target: NormalizedSkill, stack: NormalizedSkill[]): ComposePreflight {
  const skills = [...stack, target];
  const estimatedTokens = estimateTokens(stackInstructions(skills));
  const warnings: ComposePreflight['warnings'] = [];
  if (estimatedTokens > 3_000) {
    warnings.push({ code: 'TOKEN_BUDGET', message: `Combined instructions are estimated at ${estimatedTokens} tokens, above the 3,000-token budget.` });
  }

  const profiles = skills.map((skill) => {
    const { fields, body } = readSkillDocument(skill.instructions);
    return {
      name: skill.name,
      description: new Set(routingTerms(fields.description ?? '')),
      tools: new Set(fields['allowed-tools']?.match(/[^\s,[\]()]+(?:\([^)]*\))?/g)),
      directives: directives(body)
    };
  });
  for (const [index, left] of profiles.entries()) {
    for (const right of profiles.slice(index + 1)) {
      const pair = `“${left.name}” and “${right.name}”`;
      const similarity = descriptionSimilarity(left.description, right.description);
      if (similarity >= 0.5) {
        warnings.push({ code: 'DESCRIPTION_OVERLAP', message: `${pair} share routing terms (Jaccard similarity ${similarity.toFixed(2)}).` });
      }
      const contradictions = [...left.directives].filter(([action, directions]) => {
        const opposing = right.directives.get(action);
        return (directions.has('require') && opposing?.has('forbid')) || (directions.has('forbid') && opposing?.has('require'));
      });
      if (contradictions.length > 0) {
        const actions = contradictions.slice(0, 3).map(([action]) => `“${action.slice(0, 100)}”`);
        warnings.push({ code: 'CONTRADICTORY_INSTRUCTIONS', message: `${pair} give opposing instructions for ${actions.join(', ')}.` });
      }
      if (left.tools.size && right.tools.size && (left.tools.size !== right.tools.size || [...left.tools].some((tool) => !right.tools.has(tool)))) {
        warnings.push({ code: 'ALLOWED_TOOLS_CONFLICT', message: `${pair} declare different allowed-tools lists. Check the tool permissions available when both skills are active.` });
      }
    }
  }

  return { estimatedTokens, warnings };
}
