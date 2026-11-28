import path from 'node:path';
import { isInside } from '../normalize/files.js';
import { singleLine } from '../security/output.js';

function diffLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function unifiedDiff(before: string, after: string, filePath: string): string {
  if (before === after) return '';
  const left = diffLines(before);
  const right = diffLines(after);
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start += 1;
  let end = 0;
  while (end < Math.min(left.length, right.length) - start && left.at(-1 - end) === right.at(-1 - end)) end += 1;
  const contextStart = Math.max(0, start - 3);
  const contextEnd = Math.max(0, end - 3);
  const leftSize = left.length - contextStart - contextEnd;
  const rightSize = right.length - contextStart - contextEnd;
  const header = (size: number) => (size ? contextStart + 1 : contextStart) + ',' + size;
  const cwd = process.cwd();
  const resolved = path.resolve(filePath);
  const relative = isInside(cwd, resolved) ? path.relative(cwd, resolved) : path.basename(resolved);
  const displayPath = singleLine(relative).replaceAll('\\', '/');
  const hunk: string[] = [
    '--- a/' + displayPath,
    '+++ b/' + displayPath,
    '@@ -' + header(leftSize) + ' +' + header(rightSize) + ' @@'
  ];
  const append = (prefix: string, lines: string[]) => {
    for (const line of lines) {
      hunk.push(prefix + line.replace(/\n$/, ''));
      if (!line.endsWith('\n')) hunk.push('\\ No newline at end of file');
    }
  };
  append(' ', left.slice(contextStart, start));
  append('-', left.slice(start, left.length - end));
  append('+', right.slice(start, right.length - end));
  append(' ', left.slice(left.length - end, left.length - contextEnd));
  return hunk.join('\n') + '\n';
}
