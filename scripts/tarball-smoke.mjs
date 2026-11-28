import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function main() {
  const rootDir = process.cwd();
  console.log('Packing tarball with npm pack...');
  const packOutput = execFileSync('npm', ['pack'], { cwd: rootDir, encoding: 'utf8' }).trim();
  const tarballName = packOutput.split('\n').filter(Boolean).pop();
  if (!tarballName) {
    throw new Error('Failed to determine tarball name from npm pack output');
  }
  const tarballPath = path.resolve(rootDir, tarballName);

  const customOut = process.argv[2];
  let finalTarballPath = tarballPath;
  if (customOut) {
    finalTarballPath = path.resolve(rootDir, customOut);
    fs.mkdirSync(path.dirname(finalTarballPath), { recursive: true });
    fs.copyFileSync(tarballPath, finalTarballPath);
  }

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(finalTarballPath)).digest('hex');
  console.log(`Validated tarball sha256: ${sha256}`);
  if (customOut) {
    console.log(`Preserved tarball at: ${finalTarballPath}`);
  }

  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcheck-smoke-prefix-'));
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcheck-smoke-run-'));

  try {
    console.log(`Installing ${path.basename(finalTarballPath)} into clean prefix ${prefixDir}...`);
    execFileSync('npm', ['install', '-g', '--prefix', prefixDir, finalTarballPath], {
      cwd: rootDir,
      stdio: 'inherit'
    });

    const isWindows = process.platform === 'win32';
    const binName = isWindows ? 'skillcheck.cmd' : 'skillcheck';
    const binPath = isWindows
      ? path.join(prefixDir, binName)
      : path.join(prefixDir, 'bin', binName);

    console.log(`Testing binary --version at ${binPath}...`);
    const versionOutput = execFileSync(binPath, ['--version'], { encoding: 'utf8' }).trim();
    console.log(`Reported version: ${versionOutput}`);
    const packageJsonVersion = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
    if (versionOutput !== packageJsonVersion) {
      throw new Error(`Installed binary version mismatch: expected ${packageJsonVersion}, got ${versionOutput}`);
    }

    console.log('Testing mocked --json evaluation...');
    const tasks = 1;
    const trials = 1;
    let graderRequests = 0;
    const models = {
      generator: 'skillcheck-smoke-generator',
      grader: 'skillcheck-smoke-grader',
      runner: 'skillcheck-smoke-runner'
    };
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let model;
        try {
          ({ model } = JSON.parse(body));
        } catch {
          res.writeHead(400).end();
          return;
        }

        let content;
        switch (model) {
          case models.generator:
            content = JSON.stringify({
              tasks: Array.from({ length: tasks }, (_, index) => ({
                id: 'task-' + (index + 1),
                prompt: 'Explain commit best practices.',
                criterion: 'Explains why.'
              }))
            });
            break;
          case models.grader:
            graderRequests += 1;
            content = JSON.stringify({ score: 1, reason: 'Meets criteria.' });
            break;
          case models.runner:
            content = 'Always explain why changes were made.';
            break;
          default:
            res.writeHead(400).end();
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Date.now(),
          model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
        }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const skillPath = path.join(runDir, 'SKILL.md');
      fs.writeFileSync(skillPath, '# Commit Skill\nAlways explain why.');

      const child = spawn(binPath, ['check', skillPath, '--tasks', String(tasks), '--trials', String(trials), '--json'], {
        cwd: runDir,
        env: {
          ...process.env,
          SKILLCHECK_CONFIG: path.join(runDir, 'cfg', 'config.json'),
          SKILLCHECK_NO_UPDATE_CHECK: '1',
          NVIDIA_API_KEY: 'test-key',
          NVIDIA_GENERATOR_MODEL: models.generator,
          NVIDIA_GRADER_MODEL: models.grader,
          NVIDIA_RUNNER_MODEL: models.runner,
          NVIDIA_BASE_URL: `http://127.0.0.1:${port}/v1`,
          NVIDIA_REQUEST_DELAY_MS: '0'
        }
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 90_000);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        console.error(`Mock check exceeded ${timeoutMs / 1000}s deadline. Killing child process...`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            console.error('Child did not exit after SIGTERM grace period. Sending SIGKILL...');
            try {
              child.kill('SIGKILL');
            } catch {
              // Ignore if already dead
            }
          }
          process.exit(1);
        }, 2000);
      }, timeoutMs);

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        server.close();
        if (timedOut) {
          console.error(`Mock check timed out after ${timeoutMs / 1000} seconds`);
          process.exit(1);
        }
        if (code !== 0) {
          console.error('Mock check failed with exit code', code, signal ? `(signal: ${signal})` : '');
          console.error(stderr);
          process.exit(1);
        }
        try {
          const parsed = JSON.parse(stdout);
          assert.equal(graderRequests, tasks * trials * 2, 'Unexpected number of grader requests');
          assert.equal(parsed.result?.with_skill_pass, 1, 'With-skill arm did not use the mock grade');
          assert.equal(parsed.result?.no_skill_pass, 1, 'Baseline arm did not use the mock grade');
          if (!parsed.result || !parsed.result.verdict) {
            console.error('Parsed result missing verdict:', stdout);
            process.exit(1);
          }
          console.log(`Mock check verified successfully (verdict: ${parsed.result.verdict}).`);
        } catch (error) {
          console.error('Failed to verify mock evaluation:', error);
          console.error(stdout);
          process.exit(1);
        }
      });
    });
  } finally {
    if (!customOut && fs.existsSync(tarballPath)) {
      fs.unlinkSync(tarballPath);
    } else if (customOut && fs.existsSync(tarballPath) && tarballPath !== finalTarballPath) {
      fs.unlinkSync(tarballPath);
    }
    // Clean up temporary directories on exit
    process.on('exit', () => {
      try {
        fs.rmSync(prefixDir, { recursive: true, force: true });
        fs.rmSync(runDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  }
}

main();
