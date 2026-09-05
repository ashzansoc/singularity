/**
 * LangExtract Background Agent
 *
 * Separate from the Chat agent. Chat schedules work and returns immediately;
 * this agent extracts project facts and writes Context Engine JSON in the
 * background so replies are never blocked on the LangExtract sidecar.
 */

import type { SingularityAI } from '@singularity/router';
import { ingestChatMessage } from './contextEngineBridge.js';
import { singularityLog } from './singularityLog.js';

export interface LangExtractJob {
  text: string;
  messageId: string;
  enqueuedAt: number;
}

export interface ScheduleResult {
  scheduled: boolean;
  reason?: 'trivial' | 'duplicate' | 'disabled' | 'queued' | 'busy';
  queueDepth?: number;
  messageId?: string;
}

const queue: LangExtractJob[] = [];
const recentHashes = new Map<string, number>();
const DEDUPE_MS = 60_000;
let running = false;
let activeAi: SingularityAI | undefined;

type Waiter = (result: { ok: boolean; skipped?: boolean; reason?: string }) => void;
const waiters = new Map<string, Waiter[]>();
const completedResults = new Map<string, { ok: boolean; skipped?: boolean; reason?: string }>();

function notifyWaiters(
  messageId: string,
  result: { ok: boolean; skipped?: boolean; reason?: string },
): void {
  const list = waiters.get(messageId);
  if (!list?.length) {
    completedResults.set(messageId, result);
    // Bound memory for unmatched completions
    if (completedResults.size > 100) {
      const first = completedResults.keys().next().value;
      if (first !== undefined) {
        completedResults.delete(first);
      }
    }
    return;
  }
  waiters.delete(messageId);
  completedResults.delete(messageId);
  for (const w of list) {
    try {
      w(result);
    } catch {
      // ignore waiter errors
    }
  }
}

/** Resolve when a scheduled job finishes (or was skipped / never queued). */
export function waitForLangExtractJob(
  messageId: string,
  timeoutMs = 120_000,
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const existing = completedResults.get(messageId);
  if (existing) {
    completedResults.delete(messageId);
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const list = waiters.get(messageId);
      if (list) {
        waiters.set(
          messageId,
          list.filter((w) => w !== onDone),
        );
        if ((waiters.get(messageId)?.length ?? 0) === 0) {
          waiters.delete(messageId);
        }
      }
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    const onDone: Waiter = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const list = waiters.get(messageId) ?? [];
    list.push(onDone);
    waiters.set(messageId, list);
  });
}

/**
 * Prompts that must never wake LangExtract or the intelligence planes.
 * Keep in sync with isTrivialChatPrompt in singularityPromptEngineBridge.ts.
 */
export function isLangExtractSkipPrompt(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length < 12) {
    return true;
  }
  if (raw.length > 120) {
    return false;
  }
  const p = raw.toLowerCase().replace(/\s+/g, ' ');
  if (
    /\b(code|file|bug|error|fix|implement|build|create|refactor|function|component|page|api|postgres|auth|design|landing|dashboard)\b/.test(
      p,
    )
  ) {
    return false;
  }
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|bye|goodbye)[ !.]*$/i.test(p)) {
    return true;
  }
  if (/^what is singularity\b/.test(p) || /^(what|who) (is|are) (this )?(ide|assistant|product|app)\b/.test(p)) {
    return true;
  }
  if (
    /\b(how (are|have|is) (you|things)|how('s|s) it going|what'?s up|who are you|what can you (do|tell)|good (morning|afternoon|evening))\b/.test(
      p,
    )
  ) {
    return true;
  }
  if (!/\b(you|your|yourself)\b/.test(p)) {
    return false;
  }
  return (
    (/\b(who|what|which)\b/.test(p) && /\b(model|llm|name|ai|assistant)\b/.test(p))
    || (/\bare you\b/.test(p) && /\b(powered|using|based|running|built|chatgpt|claude|gpt|deepseek|gemini|singularity|openai|anthropic)\b/.test(p))
    || /\b(what are you|what'?s your name)\b/.test(p)
    || (/\bdo you use\b/.test(p) && /\b(gpt|claude|deepseek|gemini|openai|anthropic|singularity)\b/.test(p))
  );
}

function hashText(text: string): string {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
  let h = 0;
  for (let i = 0; i < t.length; i++) {
    h = (h * 31 + t.charCodeAt(i)) | 0;
  }
  return `${t.length}:${h}`;
}

/**
 * Enqueue LangExtract work and return immediately.
 * Chat must never await the returned promise of the actual extraction.
 */
export function scheduleLangExtractJob(
  text: string,
  messageId: string,
  ai?: SingularityAI,
): ScheduleResult {
  if (ai) {
    activeAi = ai;
  }
  if (isLangExtractSkipPrompt(text)) {
    notifyWaiters(messageId, { ok: true, skipped: true, reason: 'trivial' });
    return { scheduled: false, reason: 'trivial', queueDepth: queue.length, messageId };
  }

  const key = hashText(text);
  const now = Date.now();
  const last = recentHashes.get(key);
  if (last && now - last < DEDUPE_MS) {
    notifyWaiters(messageId, { ok: true, skipped: true, reason: 'duplicate' });
    return { scheduled: false, reason: 'duplicate', queueDepth: queue.length, messageId };
  }
  recentHashes.set(key, now);
  // Bound memory
  if (recentHashes.size > 200) {
    for (const [k, at] of recentHashes) {
      if (now - at > DEDUPE_MS) {
        recentHashes.delete(k);
      }
    }
  }

  queue.push({ text: text.trim(), messageId, enqueuedAt: now });
  // Cap backlog — keep newest work
  while (queue.length > 8) {
    const dropped = queue.shift();
    if (dropped) {
      notifyWaiters(dropped.messageId, { ok: false, skipped: true, reason: 'dropped' });
    }
  }
  void pumpQueue();
  return { scheduled: true, reason: 'queued', queueDepth: queue.length, messageId };
}

export function langExtractQueueDepth(): number {
  return queue.length + (running ? 1 : 0);
}

async function pumpQueue(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      const started = Date.now();
      try {
        singularityLog(
          `[langextract-agent] start messageId=${job.messageId} chars=${job.text.length} waited=${started - job.enqueuedAt}ms`,
        );
        const result = await ingestChatMessage(job.text, job.messageId, activeAi);
        singularityLog(
          `[langextract-agent] done messageId=${job.messageId} skipped=${result?.skipped ?? false} reason=${result?.reason ?? 'ok'} in ${Date.now() - started}ms`,
        );
        notifyWaiters(job.messageId, {
          ok: !(result?.skipped && result.reason === 'error'),
          skipped: result?.skipped,
          reason: result?.reason,
        });
      } catch (err) {
        console.error(
          '[langextract-agent] failed',
          err instanceof Error ? err.message : err,
        );
        notifyWaiters(job.messageId, { ok: false, reason: 'error' });
      }
    }
  } finally {
    running = false;
  }
}
