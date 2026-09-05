/** Singularity Cobuild = multi-user GPU pod for shared local inference. */

export type CobuildRole = 'host' | 'member';

export type CobuildSource = 'hyperspace' | 'simulated';

export interface CobuildMember {
  readonly id: string;
  readonly name: string;
  readonly online: boolean;
  readonly vramTotalMb: number;
  readonly vramUsedMb: number;
  readonly role: CobuildRole | 'peer';
}

export interface CobuildSession {
  readonly podName: string;
  readonly inviteToken: string;
  readonly modelId: string;
  readonly modelLabel: string;
  readonly role: CobuildRole;
  readonly source: CobuildSource;
  readonly gatewayBaseUrl: string;
  readonly apiKey: string;
  readonly createdAt: number;
  readonly members: CobuildMember[];
}

export interface CobuildResources {
  readonly vramTotalMb: number;
  readonly vramUsedMb: number;
  readonly memberCount: number;
  readonly onlineCount: number;
  readonly modelId?: string;
  readonly shardActive: boolean;
}

export interface CobuildModelOption {
  readonly id: string;
  readonly label: string;
  /** Approximate VRAM needed to run alone (MB). Pod can pool below this. */
  readonly minVramMb: number;
  readonly description: string;
}

/** Curated open-weight options for Cobuild GPU pooling. */
export const COBUILD_MODELS: readonly CobuildModelOption[] = [
  {
    id: 'gemma3-1b',
    label: 'Gemma 3 1B',
    minVramMb: 4_096,
    description: '~4 GB VRAM — fits a single laptop GPU',
  },
  {
    id: 'gemma3-4b',
    label: 'Gemma 3 4B',
    minVramMb: 6_144,
    description: '~6–8 GB VRAM',
  },
  {
    id: 'glm4-9b',
    label: 'GLM-4 9B',
    minVramMb: 12_288,
    description: '~12 GB VRAM (or quantized on 8 GB)',
  },
  {
    id: 'gemma3-12b',
    label: 'Gemma 3 12B',
    minVramMb: 16_384,
    description: '~16 GB VRAM',
  },
  {
    id: 'gpt-oss-20b',
    label: 'GPT-OSS 20B',
    minVramMb: 24_576,
    description: '~24 GB — good for 2–3 pooled GPUs',
  },
  {
    id: 'gemma3-27b',
    label: 'Gemma 3 27B',
    minVramMb: 48_000,
    description: '~48 GB — shard across the pod',
  },
  {
    id: 'qwen2.5-coder-32b',
    label: 'Qwen2.5 Coder 32B',
    minVramMb: 80_000,
    description: '~80 GB — virtual supercomputer territory',
  },
];

export function formatVramGb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) {
    return '0 GB';
  }
  const gb = mb / 1024;
  if (gb >= 10) {
    return `${Math.round(gb)} GB`;
  }
  return `${gb.toFixed(1)} GB`;
}
