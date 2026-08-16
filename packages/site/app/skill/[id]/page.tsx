import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadResult, loadResults } from '../../../lib/results';

export async function generateStaticParams() {
  const results = await loadResults();
  if (results.length === 0) {
    // `output: export` refuses a dynamic route with zero pages (fresh clones
    // have no results/). Emit one placeholder that renders the 404 boundary.
    return [{ id: '_none' }];
  }
  return results.map((result) => ({ id: result.id }));
}

export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadResult(id);
  if (!result) {
    notFound();
  }

  return (
    <main className="shell">
      <p className="eyebrow"><Link href="/">leaderboard</Link> / {result.result.verdict}</p>
      <section className="hero">
        <h1>{result.skill.name}</h1>
        <p className="lede">{result.skill.domain}</p>
      </section>
      <section className="grid">
        <div className="stat"><strong>{result.result.effect_pp} pp</strong>effect [{result.result.ci_pp.join(', ')}]</div>
        <div className="stat"><strong>{result.result.with_skill_pass}</strong>with-skill pass</div>
        <div className="stat"><strong>{result.result.no_skill_pass}</strong>no-skill pass</div>
        <div className="stat"><strong>{result.result.value_per_1k_tokens}</strong>value / 1k tokens</div>
      </section>
      <section className="panel">
        <h2>Reproducibility</h2>
        <p><strong>Result JSON:</strong> <code>{result.filePath}</code></p>
        <p><strong>Task suite:</strong> <code>{result.reproducibility.task_suite_path}</code></p>
        <p><strong>Verify command:</strong> <code>skillcheck verify {result.filePath}</code></p>
        <p><strong>Runner:</strong> <code>{result.config.runner_model}</code></p>
        <p><strong>Grader:</strong> <code>{result.config.grader_model}</code></p>
        <p><strong>Generator:</strong> <code>{result.config.generator_model}</code></p>
      </section>
      <section className="panel">
        <h2>Task Suite</h2>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Prompt</th>
              <th>Criterion</th>
              <th>With</th>
              <th>Without</th>
            </tr>
          </thead>
          <tbody>
            {result.tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.id}</td>
                <td>{task.prompt}</td>
                <td>{task.criterion}</td>
                <td>{task.with_skill_pass_rate ?? task.arm_a_pass_rate}</td>
                <td>{task.no_skill_pass_rate ?? task.arm_b_pass_rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Rot Timeline</h2>
        {result.rot ? (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Runner</th>
                <th>Effect</th>
                <th>Verdict</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.rot.history.map((entry) => (
                <tr key={`${entry.file_path}:${entry.runner_model}`}>
                  <td>{entry.run_date}</td>
                  <td>{entry.runner_model}</td>
                  <td>{entry.effect_pp} pp [{entry.ci_pp.join(', ')}]</td>
                  <td><span className={`badge ${entry.verdict}`}>{entry.verdict}</span></td>
                  <td><code>{entry.file_path}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No rot report is available for this skill version.</p>
        )}
        {result.rot?.status === 'rot' ? (
          <p className="rot-alert">Rot flagged: this skill previously helped and the latest run is {result.rot.latest.verdict}.</p>
        ) : null}
      </section>
      <section className="panel">
        <h2>Transcript Hashes</h2>
        <pre>{result.reproducibility.transcript_hashes.join('\n')}</pre>
      </section>
    </main>
  );
}
