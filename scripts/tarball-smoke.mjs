import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
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

  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcheck-smoke-prefix-'));
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillcheck-smoke-run-'));

  try {
    console.log(`Installing ${tarballName} into clean prefix ${prefixDir}...`);
    execFileSync('npm', ['install', '-g', '--prefix', prefixDir, tarballPath], {
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
    if (!versionOutput) {
      throw new Error('Version output was empty');
    }

    console.log('Testing mocked --json evaluation...');
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (body.includes('Declared domain:')) {
          res.end(JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  tasks: [
                    { id: 't1', prompt: 'Explain commit best practices.', criterion: 'Explains why.' }
                  ]
                })
              },
              finish_reason: 'stop'
            }]
          }));
        } else if (body.includes('Candidate output to grade:')) {
          res.end(JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({ score: 1, reason: 'Meets criteria.' })
              },
              finish_reason: 'stop'
            }]
          }));
        } else {
          res.end(JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'Always explain why changes were made.'
              },
              finish_reason: 'stop'
            }]
          }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const skillPath = path.join(runDir, 'SKILL.md');
      fs.writeFileSync(skillPath, '# Commit Skill\nAlways explain why.');

      const child = spawn(binPath, ['check', skillPath, '--tasks', '1', '--trials', '1', '--json'], {
        cwd: runDir,
        env: {
          ...process.env,
          SKILLCHECK_CONFIG_DIR: path.join(runDir, 'cfg'),
          SKILLCHECK_NO_UPDATE_CHECK: '1',
          NVIDIA_API_KEY: 'test-key',
          NVIDIA_BASE_URL: `http://127.0.0.1:${port}/v1`,
          NVIDIA_REQUEST_DELAY_MS: '0'
        }
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('exit', (code) => {
        server.close();
        if (code !== 0) {
          console.error('Mock check failed with exit code', code);
          console.error(stderr);
          process.exit(1);
        }
        try {
          const parsed = JSON.parse(stdout);
          if (!parsed.result || !parsed.result.verdict) {
            console.error('Parsed result missing verdict:', stdout);
            process.exit(1);
          }
          console.log(`Mock check verified successfully (verdict: ${parsed.result.verdict}).`);
        } catch (error) {
          console.error('Failed to parse json output from mock check:', error);
          console.error(stdout);
          process.exit(1);
        }
      });
    });
  } finally {
    if (fs.existsSync(tarballPath)) {
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
