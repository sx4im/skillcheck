import http from 'node:http';
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
    const expectedVersion = process.env.TEST_SABOTAGE_VERSION || packageJsonVersion;
    if (versionOutput !== expectedVersion) {
      throw new Error(`Installed binary version mismatch: expected ${expectedVersion}, got ${versionOutput}`);
    }

    console.log('Testing mocked --json evaluation...');
    const server = http.createServer((req, res) => {
      if (process.env.TEST_SABOTAGE_TIMEOUT === '1') {
        // Intentionally hang request to simulate hanging LLM endpoint for timeout test
        return;
      }
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

      const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 90_000);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        console.error(`Mock check exceeded ${timeoutMs / 1000}s deadline. Killing child process...`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
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
