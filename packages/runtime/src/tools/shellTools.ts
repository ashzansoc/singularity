/**
 * Deterministic tool runners (rg / git / typecheck / test).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolPort } from '../ports.js';

const execFileAsync = promisify(execFile);

export interface ShellToolPortOptions {
  cwd?: string;
  /** Override search binary (default: rg, falls back to grep). */
  searchBin?: string;
}

export class ShellToolPort implements ToolPort {
  private readonly cwd?: string;
  private readonly searchBin: string;

  constructor(options: ShellToolPortOptions = {}) {
    this.cwd = options.cwd;
    this.searchBin = options.searchBin ?? 'rg';
  }

  async searchText(
    pattern: string,
    glob?: string,
  ): Promise<Array<{ path: string; line: number; text: string }>> {
    try {
      const args = ['-n', '--no-heading', '-S', pattern];
      if (glob) {
        args.push('-g', glob);
      }
      args.push('.');
      const { stdout } = await execFileAsync(this.searchBin, args, {
        cwd: this.cwd,
        maxBuffer: 2_000_000,
        timeout: 15_000,
      });
      return parseRg(stdout);
    } catch (err) {
      // rg exits 1 when no matches
      const stdout = (err as { stdout?: string }).stdout;
      if (stdout) {
        return parseRg(stdout);
      }
      return [];
    }
  }

  async gitDiff(paths?: string[]): Promise<string> {
    try {
      const args = ['diff', '--', ...(paths ?? [])];
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.cwd,
        maxBuffer: 4_000_000,
        timeout: 15_000,
      });
      return stdout.slice(0, 80_000);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async gitStatus(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--short'], {
        cwd: this.cwd,
        timeout: 10_000,
      });
      return stdout.slice(0, 20_000);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async typecheck(paths?: string[]): Promise<{ ok: boolean; output: string }> {
    try {
      const args = ['-p', 'tsconfig.json', '--noEmit'];
      if (paths?.length) {
        // tsc -p ignores file list; still useful as project check
      }
      const { stdout, stderr } = await execFileAsync('npx', ['tsc', ...args], {
        cwd: this.cwd,
        maxBuffer: 4_000_000,
        timeout: 120_000,
      });
      return { ok: true, output: (stdout || stderr).slice(0, 40_000) };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        output: (e.stdout || e.stderr || e.message || String(err)).slice(0, 40_000),
      };
    }
  }

  async test(paths?: string[]): Promise<{ ok: boolean; output: string }> {
    try {
      const args = ['test', '--', ...(paths ?? [])];
      const { stdout, stderr } = await execFileAsync('npm', args, {
        cwd: this.cwd,
        maxBuffer: 4_000_000,
        timeout: 180_000,
      });
      return { ok: true, output: (stdout || stderr).slice(0, 40_000) };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        output: (e.stdout || e.stderr || e.message || String(err)).slice(0, 40_000),
      };
    }
  }
}

function parseRg(stdout: string): Array<{ path: string; line: number; text: string }> {
  const out: Array<{ path: string; line: number; text: string }> = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (m) {
      out.push({ path: m[1]!, line: Number(m[2]), text: m[3]! });
    }
    if (out.length >= 80) {
      break;
    }
  }
  return out;
}
