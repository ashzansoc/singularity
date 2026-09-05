/**
 * Persistent stdio client for the Qwen3-1.7B MLX classifier sidecar.
 * Load-once; never HTTP; never an external provider.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SidecarClassifyResult {
  ok: boolean;
  json?: string;
  error?: string;
  load_ms?: number;
  ttft_ms?: number;
  generate_ms?: number;
  tokens?: number;
  tokens_per_sec?: number;
  ready?: boolean;
}

const CLASSIFY_TIMEOUT_MS = Number(process.env.SINGULARITY_QWEN_ROUTER_TIMEOUT_MS) || 2_000;

function findUp(start: string, rel: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

function repoRootFromHere(): string {
  if (process.env.SINGULARITY_ROOT && existsSync(process.env.SINGULARITY_ROOT)) {
    return process.env.SINGULARITY_ROOT;
  }
  const script = findUp(process.cwd(), 'services/qwen-router-sidecar/main.py')
    ?? (process.env.SINGULARITY_WORKSPACE_ROOT
      ? findUp(process.env.SINGULARITY_WORKSPACE_ROOT, 'services/qwen-router-sidecar/main.py')
      : undefined);
  return script ? join(dirname(script), '../..') : process.cwd();
}

function defaultScriptPath(): string {
  const root = process.env.SINGULARITY_ROOT || repoRootFromHere();
  const candidates = [
    join(root, 'services/qwen-router-sidecar/main.py'),
    join(process.cwd(), 'services/qwen-router-sidecar/main.py'),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

function defaultPythonPath(): string {
  if (process.env.SINGULARITY_QWEN_PYTHON) {
    return process.env.SINGULARITY_QWEN_PYTHON;
  }
  const root = process.env.SINGULARITY_ROOT || repoRootFromHere();
  const venv = join(root, 'services/qwen-router-sidecar/.venv/bin/python');
  if (existsSync(venv)) {
    return venv;
  }
  return 'python3';
}

interface Pending {
  resolve: (v: SidecarClassifyResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

class QwenSidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly pending = new Map<string, Pending>();
  private req = 0;
  private spawnFailed = false;
  private starting: Promise<void> | null = null;
  private ready = false;

  isReady(): boolean {
    return this.ready && Boolean(this.child && !this.child.killed);
  }

  warmup(): void {
    void this.ensureStarted().catch(() => {
      /* never throw from warmup */
    });
  }

  async classify(text: string, timeoutMs = CLASSIFY_TIMEOUT_MS): Promise<SidecarClassifyResult> {
    if (process.env.SINGULARITY_QWEN_ROUTER !== '1') {
      return { ok: false, error: 'disabled' };
    }
    try {
      await this.ensureStarted();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const id = `qwen_${++this.req}`;
    return this.send(id, { id, op: 'classify', text: text.slice(0, 2000) }, timeoutMs);
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'disposed' });
    }
    this.pending.clear();
    this.kill();
  }

  private kill(): void {
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    this.ready = false;
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }
    if (this.spawnFailed) {
      throw new Error('sidecar_unavailable');
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.spawnChild().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async spawnChild(): Promise<void> {
    const python = defaultPythonPath();
    const script = defaultScriptPath();
    if (!existsSync(script)) {
      this.spawnFailed = true;
      throw new Error('sidecar_script_missing');
    }
    this.child = spawn(python, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.buffer = '';
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) {
          continue;
        }
        this.handleLine(line);
      }
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').slice(0, 300);
      if (process.env.SINGULARITY_CONTEXT_DEBUG === '1') {
        console.error('[qwen-router-sidecar]', msg);
      }
    });
    this.child.on('exit', () => {
      this.child = null;
      this.ready = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'sidecar_exited' });
      }
      this.pending.clear();
    });
    await new Promise((r) => setTimeout(r, 40));
    if (!this.child || this.child.killed) {
      this.spawnFailed = true;
      throw new Error('sidecar_start_failed');
    }
  }

  private send(
    id: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<SidecarClassifyResult> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve({ ok: false, error: 'sidecar_not_running' });
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  private handleLine(line: string): void {
    let msg: SidecarClassifyResult & { id?: string };
    try {
      msg = JSON.parse(line) as SidecarClassifyResult & { id?: string };
    } catch {
      return;
    }
    if (msg.ready) {
      this.ready = true;
    }
    const id = msg.id;
    if (!id) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(msg);
  }
}

const singleton = new QwenSidecarClient();

export function warmupQwenClassifier(): void {
  if (process.env.SINGULARITY_QWEN_ROUTER !== '1') {
    return;
  }
  singleton.warmup();
}

export function disposeQwenClassifier(): void {
  singleton.dispose();
}

export function classifyWithQwenSidecar(
  text: string,
  timeoutMs?: number,
): Promise<SidecarClassifyResult> {
  return singleton.classify(text, timeoutMs);
}

export function isQwenClassifierReady(): boolean {
  return singleton.isReady();
}
