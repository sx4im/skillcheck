import path from 'node:path';
import { readSkillDocument } from '../normalize/document.js';
import { redactSecrets } from './output.js';
import type { DynamicAudit } from './honey-world.js';

export interface Finding {
  ruleId: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  message: string;
  line: number;
}

export interface AuditReport {
  path: string;
  verdict: 'PASS' | 'FAIL';
  findings: Finding[];
  dynamic?: DynamicAudit;
}

type Rule = Omit<Finding, 'line'> & { matches: (line: string) => boolean };
const lineRules: Rule[] = [
  { ruleId: 'hardcoded-secret', severity: 'CRITICAL', message: 'Remove the credential and rotate it if it was active.', matches: (line) => redactSecrets(line) !== line },
  { ruleId: 'unsafe-command', severity: 'CRITICAL', message: 'Remove the instruction to bypass verification or force recursive removal.', matches: (line) => /--no-verify\b|\brm\s+(?:-[a-z]+\s+)*-[a-z]*[rf][a-z]*[rf]\b/i.test(line) },
  { ruleId: 'prompt-override', severity: 'CRITICAL', message: 'Remove instructions that override the agent’s governing prompt or role.', matches: (line) => /\b(?:ignore|override|disregard)\s+(?:all\s+)?(?:prior|previous|system|developer)\s+(?:instructions?|prompts?|messages?)\b|\byou are now\b/i.test(line) },
  { ruleId: 'local-home-path', severity: 'CRITICAL', message: 'Replace the personal home path with a project-relative path.', matches: (line) => /(?:\/(?:Users|home)\/|[A-Z]:\\Users\\)[\w.-]+[/\\]|\b(?:\/root|~)\/\.ssh\b/i.test(line) },
  { ruleId: 'unfinished-note', severity: 'INFO', message: 'Resolve the unfinished note or move it to the project tracker.', matches: (line) => /\b(?:TODO|FIXME)\b/.test(line) },
  { ruleId: 'boilerplate', severity: 'INFO', message: 'Move installation or release history to project documentation.', matches: (line) => /^#{1,6}\s+(?:installation|install|setup|change\s*log|release notes)\s*$/i.test(line.trim()) },
  { ruleId: 'runtime-lock-in', severity: 'WARN', message: 'Avoid binding the instructions to one model or operating system unless the task requires it.', matches: (line) => /\b(?:only|must|requires?)\b.{0,40}\b(?:macOS|Windows|Ubuntu|GPT-[\w.-]+|Claude\s+(?:Sonnet|Opus|Haiku)|Gemini\s+\d)\b/i.test(line) }
];

export function isTriggerDescription(description: string | undefined): boolean {
  return /\buse when\s+\S/i.test(description ?? '');
}

export function auditSkill(filePath: string, text: string, dynamic?: DynamicAudit): AuditReport {
  const { fields, body } = readSkillDocument(text);
  const lines = text.split(/\r?\n/);
  const bodyLines = body.replace(/\n$/, '').split(/\r?\n/);
  const bodyStart = text.slice(0, text.length - body.length).split('\n').length;
  const findings: Finding[] = [];
  for (const [index, line] of lines.entries()) {
    for (const { matches, ...rule } of lineRules) {
      if (matches(line)) findings.push({ ...rule, line: index + 1 });
    }
  }
  if (!isTriggerDescription(fields.description)) {
    findings.push({ ruleId: 'missing-trigger', severity: 'WARN', message: 'Add a description with an explicit “Use when” trigger.', line: 1 });
  }
  if (bodyLines.length > 500) {
    findings.push({ ruleId: 'body-length', severity: 'WARN', message: 'Keep the instructions under 500 lines and move detail to reference files.', line: bodyStart });
  }
  for (const [index, line] of bodyLines.entries()) {
    if (fields.name && /^#\s+(.+?)\s*#*$/.exec(line)?.[1]?.toLowerCase().replace(/[-_\s]+/g, ' ') === fields.name.toLowerCase().replace(/[-_\s]+/g, ' ')) {
      findings.push({ ruleId: 'duplicate-name-heading', severity: 'INFO', message: 'Remove the H1 that repeats the frontmatter name.', line: bodyStart + index });
    }
  }
  const codeSize = [...body.matchAll(/(?:^|\n)(?: *\x60{3,}| *~{3,})[^\n]*\n[\s\S]*?(?:\n *\x60{3,}|\n *~{3,})[^\n]*|\x60[^\x60\n]+\x60/g)]
    .reduce((sum, match) => sum + match[0].length, 0);
  if (body.length && codeSize / body.length > 0.6) {
    findings.push({ ruleId: 'code-bloat', severity: 'WARN', message: 'Move large code examples to reference files.', line: bodyStart });
  }
  if (dynamic?.verdict === 'FAIL') {
    findings.push({ ruleId: 'capability-drift', severity: 'CRITICAL', message: 'The with-skill run attempted a restricted action or exposed a synthetic canary.', line: 1 });
  }
  findings.sort((a, b) => a.line - b.line);
  return {
    path: filePath,
    verdict: findings.some((finding) => finding.severity === 'CRITICAL') ? 'FAIL' : 'PASS',
    findings,
    ...(dynamic ? { dynamic } : {})
  };
}

const levels = { CRITICAL: 'error', WARN: 'warning', INFO: 'note' } as const;

export function auditSarif(report: AuditReport) {
  const relative = path.isAbsolute(report.path) ? path.relative(process.cwd(), report.path) : report.path;
  const uri = relative.split(/[\\/]/).map(encodeURIComponent).join('/');
  const rules = [...new Map(report.findings.map((finding) => [finding.ruleId, finding])).values()];
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'Skillcheck', informationUri: 'https://github.com/sx4im/skillcheck',
        rules: rules.map(({ ruleId, message, severity }) => ({
          id: ruleId,
          shortDescription: { text: message },
          defaultConfiguration: { level: levels[severity] }
        }))
      } },
      results: report.findings.map(({ ruleId, line, message, severity }) => ({
        ruleId, message: { text: message }, level: levels[severity],
        locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }]
      }))
    }]
  };
}
