#!/usr/bin/env node
// Regenerates .github/assets/skillcheck-wordmark.svg — the README hero image.
// Mirrors the CLI banner exactly: "SKILL" in white, "CHECK" in the brand
// gradient (cyan → blue → indigo, top to bottom) with white outline accents,
// using the same ANSI-Shadow block glyphs the terminal shows. The letters are
// drawn as SVG rects (not font glyphs) so the image renders identically on
// every platform, with no monospace-font dependency.
// Run: node scripts/wordmark-svg.mjs

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GLYPHS = {
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  K: ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝']
};
const ROWS = 6;

const WHITE = '#f8fafc';
const DIM = '#8b98a9';
// Same stops the CLI paints per banner row (cyan-400 → blue-500 → indigo-500).
const GRADIENT = [
  [34, 211, 238],
  [59, 130, 246],
  [99, 102, 241]
];

function rowColor(t) {
  const span = (GRADIENT.length - 1) * Math.max(0, Math.min(1, t));
  const i = Math.min(GRADIENT.length - 2, Math.floor(span));
  const local = span - i;
  const [a, b] = [GRADIENT[i], GRADIENT[i + 1]];
  const channel = (k) => Math.round(a[k] + (b[k] - a[k]) * local);
  return `#${[0, 1, 2].map((k) => channel(k).toString(16).padStart(2, '0')).join('')}`;
}

// Cell geometry: each character cell of the banner becomes a CW×CH box.
const CW = 10;
const CH = 19;
const LINE = 3; // thickness of the outline strokes (═ ║ and corners)
const PAD_X = 30;
const PAD_Y = 28;

function wordRow(word, row) {
  return [...word].map((ch) => GLYPHS[ch][row]).join(' ');
}

// Emit the rects for one character cell. `█` is a solid block in `fill`; the
// box-drawing outline characters become thin white line segments along the
// cell's centre lines, which preserves the ANSI-Shadow drop-shadow look.
function cellRects(ch, x, y, fill) {
  const cx = x + CW / 2 - LINE / 2;
  const cy = y + CH / 2 - LINE / 2;
  const r = (rx, ry, rw, rh, color) => `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${color}"/>`;
  switch (ch) {
    case '█':
      return r(x, y, CW, CH, fill);
    case '═':
      return r(x, cy, CW, LINE, WHITE);
    case '║':
      return r(cx, y, LINE, CH, WHITE);
    case '╔':
      return r(cx, cy, CW - (CW / 2 - LINE / 2), LINE, WHITE) + r(cx, cy, LINE, CH - (CH / 2 - LINE / 2), WHITE);
    case '╗':
      return r(x, cy, CW / 2 + LINE / 2, LINE, WHITE) + r(cx, cy, LINE, CH - (CH / 2 - LINE / 2), WHITE);
    case '╚':
      return r(cx, cy, CW - (CW / 2 - LINE / 2), LINE, WHITE) + r(cx, y, LINE, CH / 2 + LINE / 2, WHITE);
    case '╝':
      return r(x, cy, CW / 2 + LINE / 2, LINE, WHITE) + r(cx, y, LINE, CH / 2 + LINE / 2, WHITE);
    default:
      return '';
  }
}

// Merge horizontal runs of █ into single rects to keep the file small.
function rowRects(text, y, fill) {
  const chars = [...text];
  const parts = [];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '█') {
      let j = i;
      while (j < chars.length && chars[j] === '█') j += 1;
      parts.push(`<rect x="${PAD_X + i * CW}" y="${y}" width="${(j - i) * CW}" height="${CH}" fill="${fill}"/>`);
      i = j;
      continue;
    }
    const cell = cellRects(chars[i], PAD_X + i * CW, y, fill);
    if (cell) parts.push(cell);
    i += 1;
  }
  return parts.join('');
}

const skillCols = [...wordRow('SKILL', 0)].length;
const rows = [];
for (let r = 0; r < ROWS; r += 1) {
  rows.push(`${wordRow('SKILL', r)}  ${wordRow('CHECK', r)}`);
}
const cols = Math.max(...rows.map((r) => [...r].length));

const width = cols * CW + PAD_X * 2;
const tagY = PAD_Y + ROWS * CH + 34;
const height = tagY + 26;

const body = rows
  .map((row, r) => {
    const y = PAD_Y + r * CH;
    const fill = rowColor(r / (ROWS - 1));
    // SKILL columns render white; CHECK columns take the per-row gradient.
    const skillPart = [...row].slice(0, skillCols).join('');
    const checkPart = [...row].slice(skillCols).join('');
    return (
      rowRects(skillPart, y, WHITE) +
      `<g transform="translate(${skillCols * CW},0)">${rowRects(checkPart, y, fill)}</g>`
    );
  })
  .join('\n  ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="SKILLCHECK — is your skill actually helping the model?">
  <rect width="${width}" height="${height}" rx="14" fill="#0b1220"/>
  ${body}
  <text x="${PAD_X}" y="${tagY}" font-family="ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace" font-size="15" fill="${DIM}">Is your skill actually helping the model?</text>
</svg>
`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'assets', 'skillcheck-wordmark.svg');
writeFileSync(out, svg);
console.log(`wrote ${out} (${cols} cols, ${width}×${height})`);
