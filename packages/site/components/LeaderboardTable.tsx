'use client';

import { useState } from 'react';
import type { LeaderboardResult } from '../lib/results';

type SortKey = 'name' | 'effect' | 'verdict' | 'value' | 'date' | 'rot';

function compare(a: LeaderboardResult, b: LeaderboardResult, sort: SortKey): number {
  if (sort === 'name') return a.skill.name.localeCompare(b.skill.name);
  if (sort === 'verdict') return a.result.verdict.localeCompare(b.result.verdict);
  if (sort === 'value') return b.result.value_per_1k_tokens - a.result.value_per_1k_tokens;
  if (sort === 'date') return b.run_date.localeCompare(a.run_date);
  if (sort === 'rot') return (a.rot?.status ?? 'untracked').localeCompare(b.rot?.status ?? 'untracked');
  return b.result.effect_pp - a.result.effect_pp;
}

export function LeaderboardTable({ results }: { results: LeaderboardResult[] }) {
  const [query, setQuery] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [sort, setSort] = useState<SortKey>('effect');
  const filtered = results
    .filter((result) => verdict === 'all' || result.result.verdict === verdict)
    .filter((result) =>
      `${result.skill.name} ${result.skill.domain} ${result.skill.source} ${result.rot?.status ?? ''}`.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => compare(a, b, sort));

  return (
    <section className="panel">
      <div className="toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter skills, domains, sources" />
        <select value={verdict} onChange={(event) => setVerdict(event.target.value)}>
          <option value="all">All verdicts</option>
          <option value="helps">helps</option>
          <option value="placebo">placebo</option>
          <option value="harms">harms</option>
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th><button onClick={() => setSort('name')}>Skill</button></th>
            <th>Domain</th>
            <th><button onClick={() => setSort('effect')}>Effect</button></th>
            <th><button onClick={() => setSort('verdict')}>Verdict</button></th>
            <th>Token overhead</th>
            <th><button onClick={() => setSort('value')}>Value / 1k</button></th>
            <th><button onClick={() => setSort('date')}>Model</button></th>
            <th><button onClick={() => setSort('rot')}>Rot</button></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((result) => (
            <tr key={result.id}>
              <td><a href={`/skill/${result.id}/`}>{result.skill.name}</a></td>
              <td>{result.skill.domain}</td>
              <td>{result.result.effect_pp} pp [{result.result.ci_pp.join(', ')}]</td>
              <td><span className={`badge ${result.result.verdict}`}>{result.result.verdict}</span></td>
              <td>{result.result.token_overhead}</td>
              <td>{result.result.value_per_1k_tokens}</td>
              <td>{result.config.runner_model}</td>
              <td><span className={`rot-status status-${result.rot?.status ?? 'untracked'}`}>{result.rot?.status ?? 'untracked'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
