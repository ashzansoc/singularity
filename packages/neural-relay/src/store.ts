/**
 * Local Neural Relay store under `.singularity/neural-relay/`.
 * Nemotron is stateless; project knowledge stays here.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ExperimentRecord } from './types.js';
import type { CacheStatusSnapshot } from './metrics/cacheStatus.js';
import { emptyCacheStatusSnapshot } from './metrics/cacheStatus.js';

const DIR_NAME = 'neural-relay';

export function neuralRelayDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.singularity', DIR_NAME);
}

function experimentsDir(workspaceRoot: string): string {
  return join(neuralRelayDir(workspaceRoot), 'experiments');
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export class NeuralRelayStore {
  constructor(private readonly workspaceRoot: string) {}

  get dir(): string {
    return neuralRelayDir(this.workspaceRoot);
  }

  ensure(): void {
    mkdirSync(experimentsDir(this.workspaceRoot), { recursive: true });
  }

  writeExperiment(record: ExperimentRecord): string {
    this.ensure();
    const safeId = record.task_id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const path = join(experimentsDir(this.workspaceRoot), `${safeId}.json`);
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(this.dir, 'latest.json'),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );
    return path;
  }

  readLatest(): ExperimentRecord | undefined {
    return readJson<ExperimentRecord | undefined>(
      join(this.dir, 'latest.json'),
      undefined,
    );
  }

  listExperiments(): ExperimentRecord[] {
    const dir = experimentsDir(this.workspaceRoot);
    if (!existsSync(dir)) {
      return [];
    }
    const out: ExperimentRecord[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const rec = readJson<ExperimentRecord | undefined>(
        join(dir, name),
        undefined,
      );
      if (rec) {
        out.push(rec);
      }
    }
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  appendEgressLog(line: string): void {
    this.ensure();
    const path = join(this.dir, 'egress.log');
    const prev = existsSync(path) ? readFileSync(path, 'utf8') : '';
    writeFileSync(path, `${prev}${line}\n`, 'utf8');
  }

  writeTelemetry(snapshot: CacheStatusSnapshot): void {
    this.ensure();
    writeFileSync(
      join(this.dir, 'telemetry.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8',
    );
  }

  readTelemetry(): CacheStatusSnapshot {
    const raw = readJson<Partial<CacheStatusSnapshot> | undefined>(
      join(this.dir, 'telemetry.json'),
      undefined,
    );
    if (!raw?.deepseek || !raw?.neuralRelay) {
      return emptyCacheStatusSnapshot();
    }
    return {
      ...emptyCacheStatusSnapshot(),
      ...raw,
      deepseek: { ...emptyCacheStatusSnapshot().deepseek, ...raw.deepseek },
      neuralRelay: { ...emptyCacheStatusSnapshot().neuralRelay, ...raw.neuralRelay },
    };
  }
}
