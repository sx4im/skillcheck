import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthError, IoError, SecurityGateError, ValidationError } from '../errors.js';
import { findWorkspaceRoot, findWorkspaceSkills } from '../discovery.js';
import { normalizeSkill } from '../core/normalize/index.js';
import { readBoundedFile } from '../core/normalize/files.js';
import { sanitizeTerminal, singleLine, stringifySafe } from '../core/security/output.js';
import { escapeMarkdown } from '../ui/markdown-text.js';
import { MAX_CONCURRENCY, MAX_TASKS, MAX_TRIALS, assertKnownOptions, findInputArgument, readNumberOption, readOption, readOptionalNumberOption } from './args.js';
import { commandUsage, type BuiltinCommand } from './command-help.js';

const inputOptions = ['--max-file-bytes'];
const inputFlags = ['--allow-external-symlinks'];

function loadSkill(input: string, argv: string[]) {
  return normalizeSkill(input, {
    workspaceRoot: findWorkspaceRoot(),
    maxBytes: readOptionalNumberOption(argv, '--max-file-bytes'),
    allowExternalSymlinks: argv.includes('--allow-external-symlinks')
  });
}

function parsePath(command: BuiltinCommand, argv: string[], values: string[] = [], flags: string[] = []): string {
  const { path: input, index } = findInputArgument(argv, 3);
  if (!input) throw new ValidationError('Usage: skillcheck ' + commandUsage[command]);
  assertKnownOptions(argv, 3, [...inputOptions, ...values], [...inputFlags, ...flags], index);
  return input;
}

async function activeModel() {
  const { loadProviderConfig } = await import('../env.js');
  const { createLlmClient } = await import('../providers/providers.js');
  const config = loadProviderConfig();
  return { config, client: createLlmClient(config, { defaultHeaders: { 'x-skillcheck-run': randomUUID() } }) };
}

async function emit(text: string, output?: string): Promise<void> {
  if (output) {
    try {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, text + (text.endsWith('\n') ? '' : '\n'), { mode: 0o600 });
    } catch (cause) {
      throw new IoError('Could not write output: ' + output, { cause });
    }
    return;
  }
  process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'));
}

async function listSkills(input: string, argv: string[]) {
  const info = await stat(input).catch((cause: unknown) => { throw new ValidationError('Cannot read skill collection: ' + input, { cause }); });
  if (!info.isDirectory()) return [await loadSkill(input, argv)];
  // Normalize the collection root before discovering files. A caller may
  // explicitly select a directory outside cwd, but a symlink cannot broaden it.
  const { canonicalSkillPath, isInside } = await import('../core/normalize/files.js');
  const absolute = path.resolve(input);
  const workspace = findWorkspaceRoot();
  const root = isInside(workspace, absolute) ? workspace : path.dirname(absolute);
  const directory = await canonicalSkillPath(absolute, root, argv.includes('--allow-external-symlinks'));
  const discovered = await findWorkspaceSkills(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  const topLevel = entries.filter((entry) => entry.isFile() && /\.(?:md|mdc)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
  const files = [...new Set([...discovered.map((skill) => skill.path), ...topLevel])].sort();
  if (files.length > 100) throw new ValidationError('Skill collection is limited to 100 files.');
  return Promise.all(files.map((file) => loadSkill(file, argv)));
}

async function compose(argv: string[]): Promise<number> {
  const input = parsePath('compose', argv, ['--with', '--tasks', '--trials', '--concurrency', '--output'], ['--compare-isolated', '--json', '--markdown']);
  const withPaths = readOption(argv, '--with')?.split(',').map((item) => item.trim()).filter(Boolean);
  if (!withPaths?.length) throw new ValidationError('Compose requires --with <path1,path2|dir>.');
  const json = argv.includes('--json');
  const markdown = argv.includes('--markdown');
  if (json && markdown) throw new ValidationError('Choose one of --json and --markdown.');
  const tasks = readNumberOption(argv, '--tasks', 5, MAX_TASKS);
  const trials = readNumberOption(argv, '--trials', 3, MAX_TRIALS);
  const concurrency = readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY);
  const { analyzeComposition, composeSkills } = await import('../core/compose/index.js');
  const target = await loadSkill(input, argv);
  const stack = (await Promise.all(withPaths.map((file) => listSkills(file, argv)))).flat();
  if (!stack.length || stack.length > 100) throw new ValidationError('Compose requires a stack of 1 to 100 skills.');
  const preflight = analyzeComposition(target, stack);
  for (const { message } of preflight.warnings) console.error('Warning: ' + singleLine(message));
  const { config, client } = await activeModel();
  const report = await composeSkills({ target, stack, tasks, trials, concurrency, models: config, compareIsolated: argv.includes('--compare-isolated') }, client);
  const stats = report.effectPp.toFixed(1) + ' pp (95% CI ' + report.ciPp.map((n) => n.toFixed(1)).join(' to ') + ')';
  const rates = Object.entries(report.passRates).map(([arm, rate]) => arm + ' ' + (100 * rate).toFixed(1) + '%').join(', ');
  const isolated = report.isolatedEffect
    ? '\nTreatment compared with isolated: ' + report.isolatedEffect.effectPp.toFixed(1) + ' pp (95% CI ' +
      report.isolatedEffect.ciPp.map((n) => n.toFixed(1)).join(' to ') + ')'
    : '';
  const text = markdown
    ? '# Skillcheck compose · ' + escapeMarkdown(report.target) + '\n\n**' + report.verdict + '** · ' + stats + '\n\n' +
      'Stack: ' + report.stack.map(escapeMarkdown).join(', ') + '\n\n' + rates + isolated +
      (report.preflight.warnings.length ? '\n\n' + report.preflight.warnings.map(({ message }) => '- ' + escapeMarkdown(message)).join('\n') : '')
    : report.verdict + ' ' + singleLine(report.target) + ' · ' + stats + '\n' + rates + isolated;
  await emit(json ? stringifySafe(report) : text, readOption(argv, '--output'));
  return report.verdict === 'CONFLICTS_HARMS' ? 3 : 0;
}

async function route(argv: string[]): Promise<number> {
  const input = parsePath('route', argv, ['--against', '--queries', '--concurrency', '--output'], ['--json']);
  const queries = readNumberOption(argv, '--queries', 12, MAX_TASKS);
  const concurrency = readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY);
  const { evaluateRouting, validateRoutingSkill } = await import('../core/routing/index.js');
  const target = await loadSkill(input, argv);
  const issues = validateRoutingSkill(target);
  if (issues.length) throw new ValidationError(issues.join('\n'));
  const againstPath = readOption(argv, '--against');
  const against = againstPath ? await listSkills(againstPath, argv) : [];
  const { config, client } = await activeModel();
  const report = await evaluateRouting({ target, against, queries, concurrency, models: config }, client);
  const stats = [report.verdict + ' ' + singleLine(report.target) + ' · ' + report.queryCount + ' queries'];
  for (const [name, result] of Object.entries({ BM25: report.bm25, LLM: report.llm })) {
    stats.push(name + ' ' + [['Hit@1', result.hitAt1], ['Precision', result.precision], ['False-trigger rate', result.falseTriggerRate],
      ['Interference', result.interference], ['Accuracy', result.accuracy]]
      .map(([label, rate]) => label + ' ' + (Number(rate) * 100).toFixed(1) + '%').join(' · '));
  }
  if (report.descriptionDiff) stats.push(sanitizeTerminal(report.descriptionDiff));
  await emit(argv.includes('--json') ? stringifySafe(report) : stats.join('\n'), readOption(argv, '--output'));
  return report.verdict === 'FAIL' ? 3 : 0;
}

async function audit(argv: string[]): Promise<number> {
  const input = parsePath('audit', argv, ['--tasks', '--format', '--output'], ['--dynamic']);
  const format = readOption(argv, '--format') ?? 'terminal';
  if (format !== 'terminal' && format !== 'json' && format !== 'sarif') throw new ValidationError('Use --format terminal, json, or sarif.');
  const tasks = readNumberOption(argv, '--tasks', 3, MAX_TASKS);
  const skill = await loadSkill(input, argv);
  const { auditSkill, auditSarif } = await import('../core/security/audit.js');
  let report = auditSkill(skill.sourcePath, skill.instructions);
  if (argv.includes('--dynamic') && report.verdict === 'PASS') {
    const { simulateAudit } = await import('../core/security/honey-world.js');
    const { config, client } = await activeModel();
    report = auditSkill(skill.sourcePath, skill.instructions, await simulateAudit(skill.instructions, skill.domain, tasks, config.runnerModel, client));
  }
  const lines = [report.verdict + ' ' + singleLine(path.relative(process.cwd(), report.path))];
  for (const finding of report.findings) lines.push(finding.severity + ' ' + finding.ruleId + ' line ' + finding.line + ' · ' + finding.message);
  if (report.dynamic) lines.push('Simulated restricted events · baseline ' + report.dynamic.baselineRestricted + ' · with skill ' + report.dynamic.withSkillRestricted);
  await emit(format === 'terminal' ? lines.join('\n') : stringifySafe(format === 'sarif' ? auditSarif(report) : report), readOption(argv, '--output'));
  return report.verdict === 'FAIL' ? 4 : 0;
}

async function fix(argv: string[]): Promise<number> {
  const input = parsePath('fix', argv, [], ['--dry-run', '--write', '--recheck']);
  const write = argv.includes('--write');
  if (write && argv.includes('--dry-run')) throw new ValidationError('Choose one of --dry-run and --write.');
  const skill = await loadSkill(input, argv);
  const { auditSkill } = await import('../core/security/audit.js');
  const { repairSkill } = await import('../core/repair/index.js');
  if (auditSkill(skill.sourcePath, skill.instructions).verdict === 'FAIL') {
    throw new SecurityGateError('Repair refused. Resolve the critical findings from skillcheck audit manually.');
  }
  const provider = await activeModel().catch((error: unknown) => {
    if (error instanceof AuthError) return undefined;
    throw error;
  });
  const result = await repairSkill(skill.instructions, skill.sourcePath, provider && { client: provider.client, model: provider.config.generatorModel });
  if (write && result.diff) {
    const temporary = skill.sourcePath + '.' + randomUUID() + '.tmp';
    try {
      const existing = await stat(skill.sourcePath);
      await writeFile(temporary, result.text, { flag: 'wx', mode: existing.mode & 0o777 });
      const current = await readBoundedFile(skill.sourcePath, readOptionalNumberOption(argv, '--max-file-bytes'));
      if (current !== skill.instructions) throw new IoError('Skill changed during repair. Run fix again.');
      await rename(temporary, skill.sourcePath);
    } catch (cause) {
      if (cause instanceof IoError) throw cause;
      throw new IoError('Could not apply the skill repair.', { cause });
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  await emit(result.diff ? sanitizeTerminal(result.diff) : 'No changes.');
  if (argv.includes('--recheck')) console.error(result.report.verdict + ' · ' + result.report.findings.length + ' audit findings');
  return 0;
}

export async function runCommand(command: BuiltinCommand, argv: string[]): Promise<number> {
  switch (command) {
    case 'compose': return compose(argv);
    case 'route': return route(argv);
    case 'audit': return audit(argv);
    case 'fix': return fix(argv);
    case 'doctor': {
      assertKnownOptions(argv, 3, [], ['--ping']);
      const { runDoctor } = await import('./doctor.js');
      return runDoctor(argv.includes('--ping'));
    }
  }
}
