import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadResult, loadResults } from '../../../lib/results';

export async function generateStaticParams() {
  return (await loadResults()).map((result) => ({ id: result.id }));
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
                <td>{task.arm_a_pass_rate}</td>
                <td>{task.arm_b_pass_rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Transcript Hashes</h2>
        <pre>{result.reproducibility.transcript_hashes.join('\n')}</pre>
      </section>
    </main>
  );
}
