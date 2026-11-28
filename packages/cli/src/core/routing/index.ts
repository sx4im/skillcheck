import type { LlmClient } from '../../providers/types.js';
import { ValidationError } from '../../errors.js';
import { readSkillDocument, replaceSkillDescription } from '../normalize/document.js';
import { seededShuffle } from '../pipeline/hash.js';
import { asyncPool } from '../pipeline/run.js';
import { unifiedDiff } from '../repair/unified-diff.js';
import type { NormalizedSkill } from '../types.js';
import { buildBm25 } from './lexical.js';
import {
  generateRoutingQueries, hasRoutingTrigger, selectRoutingCandidate, suggestRoutingDescription, validDescriptionLength,
  type RoutingCandidate, type RoutingQuery
} from './model.js';

export interface RouteOptions {
  target: NormalizedSkill;
  against: NormalizedSkill[];
  queries: number;
  concurrency?: number;
  models: { generatorModel: string; runnerModel: string };
}

export interface RoutingMetrics {
  hitAt1: number;
  precision: number;
  falseTriggerRate: number;
  interference: number;
  accuracy: number;
}

export interface RouteReport {
  target: string;
  verdict: 'PASS' | 'FAIL';
  issues: string[];
  queryCount: number;
  bm25: RoutingMetrics;
  llm: RoutingMetrics;
  descriptionDiff?: string;
}

interface Outcome {
  query: RoutingQuery;
  selected: boolean;
  selectedInIsolation: boolean;
}

function validName(name: string): boolean {
  return name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function metadataIssues(fields: Record<string, string>): string[] {
  const issues: string[] = [];
  if (!validName(fields.name ?? '')) {
    issues.push('YAML frontmatter name must contain 1–64 lowercase letters, digits, and single hyphens between words.');
  }
  if (!validDescriptionLength(fields.description ?? '')) {
    issues.push('YAML frontmatter description must contain 30–1024 characters.');
  }
  if (fields.description && !hasRoutingTrigger(fields.description)) {
    issues.push('YAML frontmatter description must include an explicit “Use when…” trigger.');
  }
  return issues;
}

export function validateRoutingSkill(skill: NormalizedSkill): string[] {
  return metadataIssues(readSkillDocument(skill.instructions).fields);
}

function routingMetrics(results: Outcome[]): RoutingMetrics {
  const positive = results.filter(({ query }) => query.expected);
  const negative = results.filter(({ query }) => !query.expected);
  const hits = positive.filter(({ selected }) => selected).length;
  const falseTriggers = negative.filter(({ selected }) => selected).length;
  // A miss is interference only if the target would have been selected alone.
  const lostHits = positive.filter(({ selected, selectedInIsolation }) => !selected && selectedInIsolation).length;
  return {
    hitAt1: hits / positive.length,
    precision: hits / (hits + falseTriggers || 1),
    falseTriggerRate: falseTriggers / negative.length,
    interference: lostHits / positive.length,
    accuracy: (hits + negative.length - falseTriggers) / results.length
  };
}

export async function evaluateRouting(options: RouteOptions, client: LlmClient): Promise<RouteReport> {
  const { target, against, models, concurrency = 4 } = options;
  const { fields, body } = readSkillDocument(target.instructions);
  const issues = metadataIssues(fields);
  if (issues.length > 0) throw new ValidationError(issues.join(' '));
  if (!Number.isSafeInteger(options.queries) || options.queries < 2) {
    throw new ValidationError('Route requires at least two queries to test positive and negative cases.');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new ValidationError('Route concurrency must be a positive integer.');
  const byPath = new Map(against.map((skill) => [skill.sourcePath, skill]));
  byPath.delete(target.sourcePath);
  const targetProfile = { name: fields.name, description: fields.description };
  const profiles = [targetProfile];
  for (const sourcePath of [...byPath.keys()].sort()) {
    const skill = byPath.get(sourcePath)!;
    const { fields: competitor } = readSkillDocument(skill.instructions);
    if (!validName(competitor.name ?? '') || !validDescriptionLength(competitor.description ?? '')) {
      issues.push(`Skipped “${skill.name}” because its frontmatter name or description is invalid.`);
      continue;
    }
    profiles.push({ name: competitor.name, description: competitor.description });
  }
  const ordered = seededShuffle(profiles, target.versionHash);
  const catalog: RoutingCandidate[] = ordered.map((profile, index) => ({ ...profile, id: `skill-${index}` }));
  const targetEntry = catalog[ordered.indexOf(targetProfile)]!;
  const competitors = catalog.filter((candidate) => candidate !== targetEntry);
  const alone = [targetEntry];
  const bm25 = buildBm25(catalog);
  const bm25Alone = buildBm25(alone);
  const queries = await generateRoutingQueries(body, competitors, options.queries, models.generatorModel, client);
  const lexicalResults = queries.map((query) => ({
    query,
    selected: bm25(query.text) === targetEntry.id,
    selectedInIsolation: bm25Alone(query.text) === targetEntry.id
  }));
  const selectorResults = await asyncPool(queries, concurrency, async (query) => {
    const selected = await selectRoutingCandidate(query.text, catalog, models.runnerModel, client) === targetEntry.id;
    const selectedInIsolation = query.expected && !selected && competitors.length > 0 &&
      await selectRoutingCandidate(query.text, alone, models.runnerModel, client) === targetEntry.id;
    return { query, selected, selectedInIsolation };
  });
  const lexical = routingMetrics(lexicalResults);
  const selector = routingMetrics(selectorResults);
  const needsRevision = [lexical, selector].some(({ accuracy, interference }) => accuracy < 0.8 || interference > 0);
  let descriptionDiff: string | undefined;
  if (needsRevision) {
    const mistakes = new Set([...lexicalResults, ...selectorResults]
      .filter(({ query, selected }) => query.expected !== selected).map(({ query }) => query));
    // Preserve counterexamples from both classes, including cases each router handled correctly.
    const ranked = [...mistakes, ...queries.filter((query) => !mistakes.has(query))];
    const examples = [
      ...ranked.filter(({ expected }) => expected).slice(0, 6),
      ...ranked.filter(({ expected }) => !expected).slice(0, 6)
    ];
    const suggested = await suggestRoutingDescription(targetEntry, body, examples, competitors, models.generatorModel, client);
    descriptionDiff = unifiedDiff(target.instructions, replaceSkillDescription(target.instructions, suggested), target.sourcePath);
  }
  return {
    target: targetEntry.name, issues, queryCount: queries.length,
    verdict: needsRevision ? 'FAIL' : 'PASS', bm25: lexical, llm: selector,
    ...(descriptionDiff !== undefined && { descriptionDiff })
  };
}
