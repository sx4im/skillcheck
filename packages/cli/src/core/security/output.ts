import { stripVTControlCharacters } from 'node:util';

const REDACTED = '[REDACTED]';
const secretPattern = /\b(?:sk-|chk_live_|nvapi-|AIza|gsk_)[a-z0-9_-]{4,}/gi;
const knownSecrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) {
    if (knownSecrets.size >= 32) knownSecrets.delete(knownSecrets.values().next().value!);
    knownSecrets.add(value);
  }
}

export function redactSecrets(text: string): string {
  for (const secret of knownSecrets) text = text.replaceAll(secret, REDACTED);
  return text
    .replace(/(\bauthorization\s*[:=]\s*)(?:[\w-]+\s+)?[^\s,}]+/gi, '$1' + REDACTED)
    .replace(/(\bbearer\s+)[a-z0-9._~+/\-=]+/gi, '$1' + REDACTED)
    .replace(secretPattern, REDACTED);
}

export function sanitizeTerminal(text: string): string {
  // OSC and related string controls can carry arbitrary data up to BEL or ST.
  // eslint-disable-next-line no-control-regex
  const strings = /(?:\x1b[\]PX^_]|\x90|\x98|\x9d|\x9e|\x9f)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/g;
  // eslint-disable-next-line no-control-regex
  const controls = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;
  return redactSecrets(stripVTControlCharacters(text.replace(strings, '')).replace(/\r\n?/g, '\n').replace(controls, ''));
}

export function singleLine(text: string): string {
  return sanitizeTerminal(text).replace(/[\t\n\u2028\u2029]/g, ' ');
}

export function stringifySafe(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => {
    if (/^(?:authorization|(?:x[_-](?:goog[_-])?)?api[_-]?key|providerKey|token)$/i.test(key) && typeof item === 'string') return REDACTED;
    return typeof item === 'string' ? sanitizeTerminal(item) : item;
  }, 2);
}
