import { singleLine } from '../core/security/output.js';

/** Renders untrusted text literally in headings, list items and GFM table cells. */
export function escapeMarkdown(text: string): string {
  return singleLine(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\[\]`|*_~#]/g, '\\$&')
    // Break GFM autolinks and GitHub mentions while preserving their display text.
    .replace(/\b(https?):/gi, '$1&#58;')
    .replace(/\bwww\./gi, (prefix) => `${prefix.slice(0, -1)}&#46;`)
    .replace(/@/g, '@\u200b');
}
