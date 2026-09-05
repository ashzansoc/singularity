/**
 * Per-prompt Flash/Pro router via OpenRouter Nemotron.
 * DeepSeek V4 Pro is currently disabled — coding always uses Flash-0731.
 */

import { NEMOTRON_ROUTER_SYSTEM } from './systemPrompt.js';

export const NEMOTRON_ROUTER_MODEL = 'nvidia/nemotron-3.5-lightning:free';
export const FLASH_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';
export const PRO_MODEL_ID = 'deepseek/deepseek-v4-pro-0813';

export interface FlashProDecision {
  choice: 'flash' | 'pro';
  modelId: typeof FLASH_MODEL_ID | typeof PRO_MODEL_ID;
  latencyMs: number;
  source: 'llm' | 'timeout' | 'error' | 'disabled';
  raw: string;
}

export function coerceFlashOrPro(text: string): 'flash' | 'pro' | undefined {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, ' ').trim().toLowerCase();
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (t === 'flash' || t === 'pro') {
    return t;
  }
  const hits = t.match(/\b(flash|pro)\b/g);
  if (hits?.length) {
    return hits[hits.length - 1] as 'flash' | 'pro';
  }
  return undefined;
}

export function isNemotronRouterEnabled(): boolean {
  return process.env.SINGULARITY_NEMOTRON_ROUTER !== '0';
}

export async function decideFlashOrPro(
  _prompt?: string,
  _options?: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    apiKey?: string;
    baseUrl?: string;
  },
): Promise<FlashProDecision> {
  return {
    choice: 'flash',
    modelId: FLASH_MODEL_ID,
    latencyMs: 0,
    source: 'disabled',
    raw: 'deepseek-pro-disabled',
  };
}

export { NEMOTRON_ROUTER_SYSTEM };
