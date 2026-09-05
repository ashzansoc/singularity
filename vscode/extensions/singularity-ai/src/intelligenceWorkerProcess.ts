/**
 * Spawns the Project Intelligence worker as a separate Node process.
 * Indexing, Tree-sitter parsing, and intelligence-plane LLM work stay out of
 * the VS Code extension host so chat remains responsive.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { IntelligenceClient } from '@singularity/intelligence';
import { singularityLog, singularityWarn } from './singularityLog.js';

let child: ChildProcess | undefined;
let client: IntelligenceClient | undefined;
let baseUrl: string | undefined;
let starting: Promise<IntelligenceClient | undefined> | undefined;

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createConnection({ port, host: '127.0.0.1' }, () => {
      srv.destroy();
      resolve(false);
    });
    srv.on('error', () => resolve(true));
    setTimeout(() => {
      srv.destroy();
      resolve(true);
    }, 200);
  });
}

async function pickPort(start = 4781): Promise<number> {
  for (let p = start; p < start + 64; p++) {
    if (await portAvailable(p)) {
      return p;
    }
  }
  return start;
}

export function getIntelligenceClient(): IntelligenceClient | undefined {
  return client;
}

export function getIntelligenceBaseUrl(): string | undefined {
  return baseUrl;
}

export function isIntelligenceWorkerActive(): boolean {
  return Boolean(client && baseUrl);
}

export async function ensureIntelligenceWorker(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<IntelligenceClient | undefined> {
  if (client) {
    return client;
  }
  if (starting) {
    return starting;
  }
  starting = startWorker(context, workspaceRoot).finally(() => {
    starting = undefined;
  });
  return starting;
}

async function startWorker(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<IntelligenceClient | undefined> {
  const workerScript = join(context.extensionPath, 'dist', 'intelligenceWorker', 'main.js');
  const port = await pickPort(4781);
  const url = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [workerScript], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      SINGULARITY_WORKSPACE: workspaceRoot,
      SINGULARITY_INTELLIGENCE_PORT: String(port),
      SINGULARITY_INTELLIGENCE_AUTO_BOOTSTRAP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  context.subscriptions.push({
    dispose: () => {
      try {
        child?.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      child = undefined;
      client = undefined;
      baseUrl = undefined;
    },
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      singularityLog(`[intelligence-worker] ${line}`);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      singularityWarn(`[intelligence-worker] ${line}`);
    }
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      singularityWarn(`[intelligence-worker] exited with code ${code}`);
    }
    if (child) {
      child = undefined;
      client = undefined;
      baseUrl = undefined;
    }
  });

  const probe = new IntelligenceClient({ baseUrl: url, timeoutMs: 400 });
  for (let i = 0; i < 40; i++) {
    if (await probe.health()) {
      client = probe;
      baseUrl = url;
      singularityLog(`[singularity-ai] Intelligence worker ready ${url}`);
      return client;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  singularityWarn('[singularity-ai] Intelligence worker failed to become healthy');
  try {
    child?.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  child = undefined;
  return undefined;
}
