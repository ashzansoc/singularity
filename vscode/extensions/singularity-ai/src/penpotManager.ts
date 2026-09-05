import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_PENPOT_URL } from '@singularity/design';

/**
 * Locate tools/penpot relative to the Singularity repo / extension install.
 */
export function resolvePenpotRoot(extensionPath: string): string | undefined {
  const candidates = [
    join(extensionPath, '..', '..', '..', 'tools', 'penpot'),
    join(extensionPath, '..', '..', 'tools', 'penpot'),
    join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', 'tools', 'penpot'),
  ];
  for (const c of candidates) {
    if (c && existsSync(join(c, 'docker-compose.yml'))) {
      return c;
    }
  }
  return undefined;
}

export async function isPenpotReachable(url = DEFAULT_PENPOT_URL): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export class PenpotManager {
  private starting?: Promise<boolean>;

  constructor(private readonly extensionPath: string) {}

  get url(): string {
    return (
      vscode.workspace.getConfiguration('singularity.ai').get<string>('penpotUrl') ??
      DEFAULT_PENPOT_URL
    );
  }

  async ensureStarted(showProgress = true): Promise<boolean> {
    if (await isPenpotReachable(this.url)) {
      return true;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this._start(showProgress).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async _start(showProgress: boolean): Promise<boolean> {
    const root = resolvePenpotRoot(this.extensionPath);
    if (!root) {
      void vscode.window.showErrorMessage(
        'Penpot tools not found (expected tools/penpot/docker-compose.yml in the Singularity repo).',
      );
      return false;
    }
    const script = join(root, 'scripts', 'start.sh');
    const run = async (): Promise<boolean> => {
      await this._runScript(script, root);
      for (let i = 0; i < 45; i++) {
        if (await isPenpotReachable(this.url)) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return isPenpotReachable(this.url);
    };

    if (!showProgress) {
      return run();
    }
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Starting Penpot…',
        cancellable: false,
      },
      async () => run(),
    );
  }

  async stop(): Promise<void> {
    const root = resolvePenpotRoot(this.extensionPath);
    if (!root) {
      return;
    }
    await this._runScript(join(root, 'scripts', 'stop.sh'), root);
  }

  private _runScript(script: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn('bash', [script], {
        cwd,
        env: process.env,
      });
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `Penpot script exited ${code}`));
        }
      });
    });
  }
}

let sharedPenpot: PenpotManager | undefined;

export function setSharedPenpotManager(manager: PenpotManager): void {
  sharedPenpot = manager;
}

export function getSharedPenpotManager(): PenpotManager | undefined {
  return sharedPenpot;
}
