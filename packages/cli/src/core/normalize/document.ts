import { isMap, isScalar, parseDocument } from 'yaml';
import { ValidationError } from '../../errors.js';

const textFields = new Set(['name', 'description', 'domain', 'when_to_use', 'when-to-use', 'allowed-tools']);

function frontmatter(text: string) {
  const opening = /^\uFEFF?---[ \t]*(\r?\n)/.exec(text);
  if (!opening) return undefined;
  const start = opening[0].length;
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(text.slice(start));
  if (!closing) throw new ValidationError('Skill frontmatter is missing its closing --- line.');
  const end = start + closing.index;
  const document = parseDocument(text.slice(start, end), { schema: 'core', prettyErrors: false });
  if (document.errors.length || document.warnings.length || (document.contents !== null && !isMap(document.contents))) {
    throw new ValidationError('Skill frontmatter must be a valid YAML mapping with unique keys.');
  }
  return { document, start, end, bodyStart: end + closing[0].length, newline: opening[1] };
}

export function readSkillDocument(text: string): { fields: Record<string, string>; body: string } {
  const parsed = frontmatter(text);
  if (!parsed) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const key of textFields) {
    const node = parsed.document.get(key, true);
    if (node === undefined) continue;
    if (!isScalar(node) || typeof node.value !== 'string') {
      throw new ValidationError('Skill frontmatter field "' + key + '" must be a string.');
    }
    fields[key] = node.value.replace(/\s+/g, ' ').trim();
  }
  return { fields, body: text.slice(parsed.bodyStart) };
}

export function replaceSkillDescription(text: string, description: string): string {
  const parsed = frontmatter(text);
  const replacement = JSON.stringify(description);
  if (!parsed) return '---\ndescription: ' + replacement + '\n---\n' + text;

  const node = parsed.document.get('description', true);
  if (isScalar(node) && node.range) {
    const [valueStart, valueEnd] = node.range;
    const start = parsed.start + valueStart;
    const end = parsed.start + valueEnd;
    const ending = /\r?\n$/.exec(text.slice(start, end))?.[0] ?? '';
    return text.slice(0, start) + replacement + ending + text.slice(end);
  }
  return text.slice(0, parsed.end) + 'description: ' + replacement + parsed.newline + text.slice(parsed.end);
}

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}
