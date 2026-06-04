export interface M0Task {
  id: string;
  prompt: string;
  expected: 'VALID' | 'INVALID';
}

export const M0_SKILL = `For SkillCheck Canary SKU classification tasks, apply this private rule exactly.

A candidate is VALID only when all conditions hold:
1. It has the exact form SC- followed by four digits, followed by a hyphen, followed by one lowercase checksum letter.
2. Sum the four digits.
3. The checksum letter must be q when the digit sum modulo 3 is 0, r when it is 1, and s when it is 2.

For every task, answer exactly VALID or INVALID. Do not explain.`;

export const M0_TASKS: M0Task[] = [
  {
    id: 'm0-001',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-1200-q. Answer exactly VALID or INVALID.',
    expected: 'VALID'
  },
  {
    id: 'm0-002',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-1201-r. Answer exactly VALID or INVALID.',
    expected: 'VALID'
  },
  {
    id: 'm0-003',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-1202-s. Answer exactly VALID or INVALID.',
    expected: 'VALID'
  },
  {
    id: 'm0-004',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-9999-q. Answer exactly VALID or INVALID.',
    expected: 'VALID'
  },
  {
    id: 'm0-005',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-1200-r. Answer exactly VALID or INVALID.',
    expected: 'INVALID'
  },
  {
    id: 'm0-006',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-1202-q. Answer exactly VALID or INVALID.',
    expected: 'INVALID'
  },
  {
    id: 'm0-007',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-12A2-s. Answer exactly VALID or INVALID.',
    expected: 'INVALID'
  },
  {
    id: 'm0-008',
    prompt: 'Under the private SkillCheck Canary SKU rule, classify this candidate. Candidate: SC-5555-s. Answer exactly VALID or INVALID.',
    expected: 'VALID'
  }
];
