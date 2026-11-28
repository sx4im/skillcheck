import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { IoError, ValidationError } from '../../errors.js';

export const DEFAULT_SKILL_MAX_BYTES = 1024 * 1024;

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function canonicalSkillPath(filePath: string, root: string, allowExternalSymlinks = false): Promise<string> {
  const canonical = await realpath(filePath);
  if (!allowExternalSymlinks && !isInside(await realpath(root), canonical)) {
    throw new ValidationError('Skill path resolves outside its workspace: ' + filePath);
  }
  return canonical;
}

export async function checkLinkedAssets(body: string, root: string): Promise<void> {
  const destinations = body.matchAll(/(?:\]\(\s*|^\s*\[[^\]\n]+\]:\s*)(?:<([^>\n]+)>|([^\s)\n]+))/gm);
  const paths = new Set<string>();
  for (const [, wrapped, bare] of destinations) {
    const destination = wrapped ?? bare;
    let relative: string;
    try {
      relative = decodeURIComponent(destination.split(/[?#]/, 1)[0]!).replaceAll('\\', '/');
    } catch {
      continue;
    }
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(relative) || !/(?:^|\/)(?:references|scripts)\//i.test(relative)) continue;
    const linked = path.resolve(root, relative);
    if (!isInside(root, linked)) throw new ValidationError('Skill linked asset resolves outside the skill directory.');
    paths.add(linked);
  }
  for (const linked of paths) {
    const canonical = await realpath(linked).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return linked;
      throw new IoError('Could not resolve a linked skill asset.', { cause });
    });
    if (!isInside(root, canonical)) throw new ValidationError('Skill linked asset resolves outside the skill directory.');
  }
}

export async function readBoundedFile(filePath: string, maxBytes = DEFAULT_SKILL_MAX_BYTES): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) {
    throw new ValidationError('Skill size limit must be between 1 byte and 32 MiB.');
  }
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    .catch((cause: unknown) => { throw new IoError('Could not open skill file: ' + filePath, { cause }); });
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new ValidationError('Skill input must be a regular file.');
    const tooLarge = () => new ValidationError('Skill exceeds the configured limit of ' + maxBytes + ' bytes.');
    if (stats.size > maxBytes) throw tooLarge();

    const chunks: Buffer[] = [];
    let remaining = maxBytes + 1;
    while (remaining > 0) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) return Buffer.concat(chunks).toString('utf8');
      chunks.push(buffer.subarray(0, bytesRead));
      remaining -= bytesRead;
    }
    throw tooLarge();
  } finally {
    await handle.close();
  }
}
