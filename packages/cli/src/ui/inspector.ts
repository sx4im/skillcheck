import type { EvalResult } from '../eval.js';
import { copyToClipboardOsc52, formatPrMarkdown } from './clipboard.js';
import { readKey, withRawMode, wrapIndex } from './picker.js';
import { BOX, SYM, layoutWidth, padDisplay, paint, truncateDisplay, wrapText } from './theme.js';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function pp(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)} pp`;
}

/**
 * Pure rendering function for Skillcheck Lens inspector frame.
 * Produces an array of terminal strings formatted to terminal width.
 */
export function renderInspectorScreen(result: EvalResult, selectedIndex: number, width = layoutWidth()): string[] {
  const lines: string[] = [];
  const innerWidth = Math.max(40, width - 4);
  const tasks = result.tasks ?? [];
  const selectedTask = tasks[selectedIndex];

  // Header Bar
  const title = ` ${paint.bold('Skillcheck Lens')} ${SYM.dot} ${result.skill.name} ${paint.dim(`(${pp(result.result.effect_pp)})`)} `;
  lines.push(paint.accent(`${BOX.tl}${BOX.h.repeat(2)}${title}${BOX.h.repeat(Math.max(0, width - 2 - 2 - title.length))}${BOX.tr}`));

  // Task List Navigation Pane
  lines.push(`${paint.accent(BOX.v)} ${paint.bold('Evaluation Tasks (select to view trial details):'.padEnd(innerWidth))} ${paint.accent(BOX.v)}`);

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i]!;
    const isSelected = i === selectedIndex;
    const diff = (task.with_skill_pass_rate - task.no_skill_pass_rate) * 100;
    const tag = diff > 0 ? paint.ok(`[${pp(diff)}] HELPS`) : diff < 0 ? paint.err(`[${pp(diff)}] HARMS`) : paint.warn(`[${pp(diff)}] NEUTRAL`);
    const pointer = isSelected ? paint.accent(SYM.pointer) : ' ';
    const promptShort = truncateDisplay(task.prompt, Math.max(20, innerWidth - 28));
    const label = `Task ${i + 1}: ${promptShort}`;
    const rowContent = `${pointer} ${isSelected ? paint.bold(padDisplay(label, innerWidth - 24)) : padDisplay(label, innerWidth - 24)}  ${tag}`;
    lines.push(`${paint.accent(BOX.v)} ${padDisplay(rowContent, innerWidth)} ${paint.accent(BOX.v)}`);
  }

  // Mid Border Divider
  lines.push(paint.accent(`${BOX.ml}${BOX.h.repeat(width - 2)}${BOX.mr}`));

  // Detailed Task Inspection Pane
  if (selectedTask) {
    const diff = (selectedTask.with_skill_pass_rate - selectedTask.no_skill_pass_rate) * 100;
    const taskHead = ` Task ${selectedIndex + 1} Deep Dive: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp lift `;
    lines.push(`${paint.accent(BOX.v)} ${paint.bold(taskHead.padEnd(innerWidth))} ${paint.accent(BOX.v)}`);
    lines.push(`${paint.accent(BOX.v)} ${' '.repeat(innerWidth)} ${paint.accent(BOX.v)}`);

    // Prompt
    lines.push(`${paint.accent(BOX.v)} ${paint.accent('Prompt:')} ${' '.repeat(innerWidth - 8)} ${paint.accent(BOX.v)}`);
    const wrappedPrompt = wrapText(selectedTask.prompt, innerWidth - 4);
    for (const pLine of wrappedPrompt) {
      lines.push(`${paint.accent(BOX.v)}   ${padDisplay(pLine, innerWidth - 2)} ${paint.accent(BOX.v)}`);
    }
    lines.push(`${paint.accent(BOX.v)} ${' '.repeat(innerWidth)} ${paint.accent(BOX.v)}`);

    // Criterion
    lines.push(`${paint.accent(BOX.v)} ${paint.accent('Evaluation Criterion (Blind Grader):')} ${' '.repeat(Math.max(0, innerWidth - 38))} ${paint.accent(BOX.v)}`);
    const wrappedCriterion = wrapText(selectedTask.criterion, innerWidth - 4);
    for (const cLine of wrappedCriterion) {
      lines.push(`${paint.accent(BOX.v)}   ${padDisplay(cLine, innerWidth - 2)} ${paint.accent(BOX.v)}`);
    }
    lines.push(`${paint.accent(BOX.v)} ${' '.repeat(innerWidth)} ${paint.accent(BOX.v)}`);

    // Scores
    const withSkillStr = `With Skill (Arm A):    ${pct(selectedTask.with_skill_pass_rate)} pass rate`;
    const noSkillStr = `Without Skill (Arm B): ${pct(selectedTask.no_skill_pass_rate)} pass rate`;
    lines.push(`${paint.accent(BOX.v)} ${paint.ok(withSkillStr.padEnd(innerWidth))} ${paint.accent(BOX.v)}`);
    lines.push(`${paint.accent(BOX.v)} ${paint.dim(noSkillStr.padEnd(innerWidth))} ${paint.accent(BOX.v)}`);
  }

  // Bottom Border & Controls Footer
  lines.push(paint.accent(`${BOX.bl}${BOX.h.repeat(width - 2)}${BOX.br}`));
  lines.push(`  ${paint.dim(`↑/↓ or j/k select task ${SYM.dot} c copy PR markdown ${SYM.dot} q or Esc return`)}`);

  return lines;
}

/**
 * Open alternate-screen interactive inspection view for evaluation results.
 */
export async function openInspector(result: EvalResult): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  let selected = 0;
  const tasksCount = result.tasks?.length ?? 0;
  if (tasksCount === 0) return;

  await withRawMode(async () => {
    for (;;) {
      const lines = renderInspectorScreen(result, selected);
      process.stdout.write(`\x1b[2J\x1b[H${lines.join('\n')}\n`);

      const { input, key } = await readKey();
      if ((key.ctrl && key.name === 'c') || key.name === 'escape' || input === 'q') {
        break;
      }
      if (key.name === 'up' || input === 'k') {
        selected = wrapIndex(selected, -1, tasksCount);
        continue;
      }
      if (key.name === 'down' || input === 'j') {
        selected = wrapIndex(selected, 1, tasksCount);
        continue;
      }
      if (input === 'c') {
        copyToClipboardOsc52(formatPrMarkdown(result));
      }
    }
  }, { altScreen: true });
}
