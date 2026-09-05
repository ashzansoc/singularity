import { sha256, shortHash } from '../keys.js';
import type { PrefixHints, ProviderKind } from '../types.js';
import { MemoryStore } from '../storage/memory.js';
import type { KvStore } from '../types.js';

export class PromptPrefixCache {
  private readonly store: KvStore;
  private prefixVersion: string;

  constructor(opts?: { prefixVersion?: string; store?: KvStore }) {
    this.prefixVersion = opts?.prefixVersion ?? '1';
    this.store = opts?.store ?? new MemoryStore(64);
  }

  get prefixVersionValue(): string {
    return this.prefixVersion;
  }

  setPrefixVersion(version: string): void {
    this.prefixVersion = version;
  }

  /**
   * Register a stable system/tools prefix body and return provider hints.
   */
  register(prefixBody: string, providerKind: ProviderKind = 'openrouter'): PrefixHints {
    const prefixHash = sha256(prefixBody);
    const hints = this.buildHints(prefixHash, providerKind);
    const now = Date.now();
    this.store.set({
      key: `prefix:${hints.prefixVersion}:${prefixHash}`,
      value: JSON.stringify(hints),
      expiresAt: now + 24 * 60 * 60_000,
      meta: {
        layer: 'L2',
        workspaceId: '_global',
        createdAt: now,
        expiresAt: now + 24 * 60 * 60_000,
      },
    });
    return hints;
  }

  hintsFor(
    prefixBody: string,
    providerKind: ProviderKind = 'openrouter',
  ): PrefixHints {
    return this.register(prefixBody, providerKind);
  }

  buildHints(prefixHash: string, providerKind: ProviderKind): PrefixHints {
    const hints: PrefixHints = {
      prefixHash,
      prefixVersion: this.prefixVersion,
      providerKind,
    };

    if (providerKind === 'anthropic' || providerKind === 'direct') {
      hints.cacheControl = { type: 'ephemeral' };
    }

    if (
      providerKind === 'openai' ||
      providerKind === 'openrouter' ||
      providerKind === 'gemini' ||
      providerKind === 'local'
    ) {
      hints.promptCacheKey = `singularity-pfx-${this.prefixVersion}-${shortHash(prefixHash)}`;
    }

    return hints;
  }
}
