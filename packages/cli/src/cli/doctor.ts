import { stat } from 'node:fs/promises';
import { verifyCloudKey, userConfigPath, loadUserConfig } from '../config.js';
import { resolveActiveProvider } from '../env.js';
import { AuthError } from '../errors.js';
import { singleLine } from '../core/security/output.js';
import { currentVersion } from '../version.js';

export async function runDoctor(ping: boolean): Promise<number> {
  let status = 0;
  const nodeSupported = Number(process.versions.node.split('.')[0]) >= 20;
  console.log('Skillcheck ' + currentVersion());
  console.log('Node ' + process.versions.node + (nodeSupported ? ' · supported' : ' · requires Node 20 or later'));
  if (!nodeSupported) status = 1;

  const file = userConfigPath();
  try {
    const mode = (await stat(file)).mode & 0o777;
    loadUserConfig();
    const secured = process.platform === 'win32' || mode === 0o600;
    console.log('Config ' + singleLine(file) + ' · ' + (process.platform === 'win32' ? 'Windows permissions' : mode.toString(8).padStart(4, '0')));
    if (!secured) {
      console.error('Config permissions should be 0600.');
      status = 1;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.log('Config · no saved configuration');
  }

  try {
    const active = resolveActiveProvider();
    console.log('Provider ' + active.provider + ' · ' + active.source + ' · credential [REDACTED]');
    if (ping) {
      const { verifyProviderKey } = await import('../providers/providers.js');
      const result = active.provider === 'cloud'
        ? await verifyCloudKey(active.baseUrl, active.apiKey)
        : await verifyProviderKey(active.provider, active.apiKey, active.baseUrl);
      console.log('Provider ping · ' + (result.valid ? 'passed' : singleLine(result.message ?? 'failed')));
      if (!result.valid) status = 1;
    }
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    console.log('Provider · no configured credential');
    if (ping) status = 1;
  }
  return status;
}
