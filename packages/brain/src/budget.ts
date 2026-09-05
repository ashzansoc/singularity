/**
 * Cost / call budget for Brain model invocations.
 */

import type { BrainStore } from './store.js';
import type { BrainConfig } from './types.js';

function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface BudgetState {
  day: string;
  calls: number;
  tokens: number;
  spendUsd: number;
}

export class BrainBudget {
  constructor(
    private store: BrainStore,
    private cfg: BrainConfig,
  ) {}

  private load(now = Date.now()): BudgetState {
    const day = dayKey(now);
    const raw = this.store.kvGet(`budget:${day}`);
    if (!raw) {
      return { day, calls: 0, tokens: 0, spendUsd: 0 };
    }
    try {
      return JSON.parse(raw) as BudgetState;
    } catch {
      return { day, calls: 0, tokens: 0, spendUsd: 0 };
    }
  }

  private save(state: BudgetState): void {
    this.store.kvSet(`budget:${state.day}`, JSON.stringify(state));
  }

  snapshot(now = Date.now()): BudgetState {
    return this.load(now);
  }

  /** Whether another background model call is allowed. */
  canCall(now = Date.now()): { ok: boolean; reason?: string } {
    const s = this.load(now);
    if (s.calls >= this.cfg.maxBackgroundCallsPerDay) {
      return { ok: false, reason: 'daily call budget exhausted' };
    }
    if (s.spendUsd >= this.cfg.dailyBudgetUsd) {
      return { ok: false, reason: 'daily USD budget exhausted' };
    }
    return { ok: true };
  }

  recordCall(tokens: number, now = Date.now()): BudgetState {
    const s = this.load(now);
    s.calls += 1;
    s.tokens += Math.max(0, tokens);
    s.spendUsd += (Math.max(0, tokens) / 1000) * this.cfg.estimatedUsdPer1kTokens;
    this.save(s);
    return s;
  }
}
