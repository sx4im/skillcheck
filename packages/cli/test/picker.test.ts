import { describe, expect, it } from 'vitest';
import { filterPickerEntries, type PickerEntry } from '../src/ui/picker.js';

describe('picker fuzzy filtering', () => {
  const sampleEntries: PickerEntry[] = [
    { label: '../', fullPath: '/root', kind: 'parent', runnable: false, note: 'back' },
    { label: 'skills/', fullPath: '/root/skills', kind: 'directory', runnable: false, note: 'folder' },
    { label: 'CLAUDE.md', fullPath: '/root/CLAUDE.md', kind: 'file', runnable: true, note: 'markdown' },
    { label: '.cursorrules', fullPath: '/root/.cursorrules', kind: 'file', runnable: true, note: 'markdown' },
    { label: 'package.json', fullPath: '/root/package.json', kind: 'file', runnable: false, note: 'not .md' },
    { label: 'auth-skill.md', fullPath: '/root/auth-skill.md', kind: 'file', runnable: true, note: 'markdown' }
  ];

  it('returns all entries when filter query is empty', () => {
    const res = filterPickerEntries(sampleEntries, '');
    expect(res).toEqual(sampleEntries);
  });

  it('filters entries matching substring case-insensitively and preserves parent back navigation', () => {
    const res = filterPickerEntries(sampleEntries, 'claude');
    expect(res.map((e) => e.label)).toEqual(['../', 'CLAUDE.md']);
  });

  it('filters for cursor or auth correctly', () => {
    const res = filterPickerEntries(sampleEntries, 'auth');
    expect(res.map((e) => e.label)).toEqual(['../', 'auth-skill.md']);
  });

  it('returns only parent entry if no match exists', () => {
    const res = filterPickerEntries(sampleEntries, 'nonexistent');
    expect(res.map((e) => e.label)).toEqual(['../']);
  });
});
