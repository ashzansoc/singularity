import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

const execFileAsync = promisify(execFile);

const HYPERSPACE_CANDIDATES = [
  'hyperspace',
  join(homedir(), '.hyperspace', 'bin', 'hyperspace'),
  join(homedir(), '.local', 'bin', 'hyperspace'),
];

export class HyperspaceCli {
  private resolvedPath: string | undefined;
  private resolved = false;

  async resolveBinary(): Promise<string | undefined> {
    if (this.resolved) {
      return this.resolvedPath;
    }
    this.resolved = true;
    for (const candidate of HYPERSPACE_CANDIDATES) {
      try {
        if (candidate === 'hyperspace') {
          await execFileAsync(candidate, ['--version'], { timeout: 8_000 });
          this.resolvedPath = candidate;
          return candidate;
        }
        await access(candidate, fsConstants.X_OK);
        this.resolvedPath = candidate;
        return candidate;
      } catch {
        /* try next */
      }
    }
    return undefined;
  }

  async isAvailable(): Promise<boolean> {
    return !!(await this.resolveBinary());
  }

  async run(args: string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> {
    const bin = await this.resolveBinary();
    if (!bin) {
      throw new Error(
        'Cobuild runtime not found. Open Singularity Cobuild → Install Cobuild runtime, then retry.',
      );
    }
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: opts?.timeoutMs ?? 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
    });
    return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
  }

  async runJson<T>(args: string[], opts?: { timeoutMs?: number }): Promise<T> {
    const withJson = args.includes('--json') ? args : [...args, '--json'];
    const { stdout, stderr } = await this.run(withJson, opts);
    const text = stdout.trim() || stderr.trim();
    if (!text) {
      throw new Error(`Cobuild runtime ${args.join(' ')} returned empty output`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some CLI builds print a human line then JSON — take the last {...} block.
      const start = text.lastIndexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1)) as T;
      }
      throw new Error(`Could not parse Cobuild runtime JSON: ${text.slice(0, 240)}`);
    }
  }

  extractInviteToken(raw: string): string | undefined {
    const tokenMatch = raw.match(/\b(hsi_v1\.[A-Za-z0-9._\-]+|hp_inv_[A-Za-z0-9._\-]+)\b/);
    if (tokenMatch) {
      return tokenMatch[1];
    }
    const linkMatch = raw.match(/https?:\/\/[^\s]+(?:join|invite)[^\s]*[?&](?:code|token)=([A-Za-z0-9._\-]+)/i);
    return linkMatch?.[1];
  }
}
