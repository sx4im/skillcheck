import { randomUUID } from 'node:crypto';

export function createPromptBoundary(): (label: string, value: string) => string {
  const nonce = randomUUID();
  return (label, value) => {
    const tag = `${label}_${nonce}`;
    // Encode angle brackets so content can never introduce a delimiter, even if
    // the same nonce has already appeared in an earlier message in the run.
    const literal = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<${tag}>\n${literal}\n</${tag}>`;
  };
}
