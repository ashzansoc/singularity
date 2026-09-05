/**
 * Node client for the LangExtract Python sidecar (stdio JSON lines).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractionDelta, ProjectState, SourceMetadata } from './types.js';

export interface SidecarConfig {
  pythonPath?: string;
  scriptPath?: string;
  timeoutMs?: number;
  provider?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface SidecarExtractRequest {
  text: string;
  source_metadata?: SourceMetadata;
  existing_state_summary?: string;
  complexity?: 'simple' | 'complex' | 'large_document';
}

export interface SidecarExtractResponse {
  ok: boolean;
  delta?: ExtractionDelta;
  raw_item_count?: number;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
}

interface Pending {
  resolve: (v: SidecarExtractResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultScriptPath(): string {
  // packages/context/src|dist -> repo root -> services/langextract-sidecar/main.py
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../services/langextract-sidecar/main.py'),
    join(here, '../../../../services/langextract-sidecar/main.py'),
    join(process.cwd(), 'services/langextract-sidecar/main.py'),
    join(process.cwd(), '../services/langextract-sidecar/main.py'),
    process.env.SINGULARITY_ROOT
      ? join(process.env.SINGULARITY_ROOT, 'services/langextract-sidecar/main.py')
      : '',
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

function defaultPythonPath(): string {
  if (process.env.SINGULARITY_CONTEXT_PYTHON) {
    return process.env.SINGULARITY_CONTEXT_PYTHON;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../services/langextract-sidecar/.venv/bin/python'),
    join(here, '../../../../services/langextract-sidecar/.venv/bin/python'),
    join(process.cwd(), 'services/langextract-sidecar/.venv/bin/python'),
    process.env.SINGULARITY_ROOT
      ? join(process.env.SINGULARITY_ROOT, 'services/langextract-sidecar/.venv/bin/python')
      : '',
    'python3',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'python3' || existsSync(c)) {
      return c;
    }
  }
  return 'python3';
}

function summarizeState(state: ProjectState | null | undefined): string {
  if (!state) {
    return '';
  }
  const lines: string[] = [];
  for (const t of state.technologies.filter((x) => x.status === 'active').slice(0, 20)) {
    lines.push(`tech: ${t.name}`);
  }
  for (const d of state.architecture_decisions
    .filter((x) => x.status === 'active')
    .slice(0, 20)) {
    lines.push(`decision: ${d.decision}`);
  }
  for (const p of state.prohibitions.filter((x) => x.status === 'active').slice(0, 20)) {
    lines.push(`prohibition: ${p.prohibition}`);
  }
  for (const r of state.requirements.filter((x) => x.status === 'active').slice(0, 20)) {
    lines.push(`requirement: ${r.description}`);
  }
  return lines.join('\n');
}

/**
 * Manages a long-lived Python sidecar with circuit breaker.
 */
export class LangExtractSidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly pending = new Map<string, Pending>();
  private reqCounter = 0;
  private failures = 0;
  private openUntil = 0;
  private lastSpawnAt = 0;
  private static readonly SPAWN_COOLDOWN_MS = 8_000;
  private readonly config: Required<
    Pick<SidecarConfig, 'timeoutMs'>
  > &
    SidecarConfig;

  constructor(config: SidecarConfig = {}) {
    this.config = {
      timeoutMs:
        config.timeoutMs
        ?? (Number(process.env.SINGULARITY_LANGEXTRACT_TIMEOUT_MS) || 8_000),
      ...config,
    };
  }

  isCircuitOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  async extract(
    req: SidecarExtractRequest,
    existingState?: ProjectState | null,
  ): Promise<SidecarExtractResponse> {
    if (this.isCircuitOpen()) {
      return {
        ok: false,
        error: 'circuit_open',
      };
    }

    try {
      await this.ensureStarted();
      const id = `req_${++this.reqCounter}`;
      const payload = {
        id,
        op: 'extract',
        text: req.text,
        source_metadata: req.source_metadata ?? null,
        existing_state_summary:
          req.existing_state_summary ?? summarizeState(existingState),
        complexity: req.complexity ?? 'simple',
        config: {
          provider:
            this.config.provider ??
            process.env.SINGULARITY_CONTEXT_PROVIDER ??
            'langextract',
          model:
            this.config.model ??
            process.env.SINGULARITY_CONTEXT_MODEL ??
            'deepseek/deepseek-v4-flash-0731',
          temperature: Number(
            this.config.temperature ??
              process.env.SINGULARITY_CONTEXT_TEMPERATURE ??
              0,
          ),
          max_output_tokens: Number(
            this.config.maxOutputTokens ??
              process.env.SINGULARITY_CONTEXT_MAX_OUTPUT_TOKENS ??
              4096,
          ),
          api_key:
            this.config.apiKey ??
            process.env.LANGEXTRACT_API_KEY ??
            process.env.AI_GATEWAY_API_KEY ??
            process.env.OPENAI_API_KEY ??
            process.env.GOOGLE_API_KEY,
          base_url:
            this.config.baseUrl ??
            process.env.SINGULARITY_CONTEXT_BASE_URL ??
            process.env.AI_GATEWAY_BASE_URL,
        },
      };

      const response = await this.send(id, payload);
      if (!response.ok) {
        this.noteFailure();
      } else {
        this.failures = 0;
      }
      return response;
    } catch (err) {
      this.noteFailure();
      const msg = err instanceof Error ? err.message : String(err);
      // Timeouts mean the extract is still running in Python. Killing the child
      // forces a full interpreter restart on the next file and starves the
      // extension host (unresponsive + leaked multiprocessing semaphores).
      if (!/timeout/i.test(msg)) {
        this.killChild();
      }
      return {
        ok: false,
        error: msg,
      };
    }
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('sidecar disposed'));
    }
    this.pending.clear();
    this.killChild();
  }

  private noteFailure(): void {
    this.failures += 1;
    if (this.failures >= 3) {
      this.openUntil = Date.now() + 30_000;
      this.failures = 0;
    }
  }

  private killChild(): void {
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.child = null;
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }
    const sinceSpawn = Date.now() - this.lastSpawnAt;
    if (this.lastSpawnAt && sinceSpawn < LangExtractSidecarClient.SPAWN_COOLDOWN_MS) {
      throw new Error('sidecar spawn cooldown');
    }
    const python = this.config.pythonPath ?? defaultPythonPath();
    const script = this.config.scriptPath ?? defaultScriptPath();
    if (!existsSync(script)) {
      throw new Error(`LangExtract sidecar script not found: ${script}`);
    }

    if (process.env.SINGULARITY_CONTEXT_DEBUG === '1') {
      console.error(
        `[langextract-sidecar] starting python=${python} script=${script}`,
      );
    }

    this.lastSpawnAt = Date.now();
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
      // Log-like stderr; avoid dumping project content. Keep short.
      const msg = chunk.toString('utf8').slice(0, 400);
      if (process.env.SINGULARITY_CONTEXT_DEBUG === '1') {
        console.error('[langextract-sidecar]', msg);
      }
    });

    this.child.on('exit', () => {
      this.child = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('sidecar exited'));
        this.pending.delete(id);
      }
    });

    // Wait briefly for process to stay alive
    await new Promise((r) => setTimeout(r, 50));
    if (!this.child || this.child.killed) {
      throw new Error('failed to start langextract sidecar');
    }
  }

  private send(
    id: string,
    payload: unknown,
  ): Promise<SidecarExtractResponse> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error('sidecar not running'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('sidecar timeout'));
      }, this.config.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private handleLine(line: string): void {
    let msg: {
      id?: string;
      ok?: boolean;
      delta?: ExtractionDelta;
      raw_item_count?: number;
      provider?: string;
      model?: string;
      input_tokens?: number;
      output_tokens?: number;
      error?: string;
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
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
    pending.resolve({
      ok: Boolean(msg.ok),
      delta: msg.delta,
      raw_item_count: msg.raw_item_count,
      provider: msg.provider,
      model: msg.model,
      input_tokens: msg.input_tokens,
      output_tokens: msg.output_tokens,
      error: msg.error,
    });
  }
}

export { summarizeState };
