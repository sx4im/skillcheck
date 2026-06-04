import { LeaderboardTable } from '../components/LeaderboardTable';
import { loadResults } from '../lib/results';

export default async function HomePage() {
  const results = await loadResults();
  const helps = results.filter((result) => result.result.verdict === 'helps').length;
  const placebo = results.filter((result) => result.result.verdict === 'placebo').length;
  const rot = new Set(results.filter((result) => result.rot?.status === 'rot').map((result) => result.rot?.key)).size;

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">forced-injection mode / static evidence</div>
        <h1>skillcheck leaderboard</h1>
        <p className="lede">
          A committed, reproducible scoreboard for agent skills. Each row links to the exact task suite, model config,
          and verification command used to reproduce the score.
        </p>
      </section>
      <section className="grid">
        <div className="stat"><strong>{results.length}</strong>results</div>
        <div className="stat"><strong>{helps}</strong>helps</div>
        <div className="stat"><strong>{placebo}</strong>placebo</div>
        <div className="stat"><strong>{rot}</strong>rot flags</div>
      </section>
      <LeaderboardTable results={results} />
    </main>
  );
}
