import {
  DEFAULT_PENPOT_URL,
  isDesignCodingUnlocked,
  loadDesignPreviewGate,
  markDesignPreviewStatus,
  type DesignPreviewGate,
} from '@singularity/design';
import type { DesignPreviewGatePort } from '@singularity/runtime';
import type { PenpotManager } from './penpotManager.js';

/**
 * Design Canvas HITL is disabled — unlock coding immediately (skipped).
 */
export async function promptDesignPreviewGate(options: {
  workspaceRoot: string;
  penpot: PenpotManager;
  goal?: string;
  productName?: string;
  forcePreview?: boolean;
}): Promise<'approved' | 'skipped'> {
  const existing = loadDesignPreviewGate(options.workspaceRoot);
  if (existing && isDesignCodingUnlocked(existing.status)) {
    return existing.status === 'approved' ? 'approved' : 'skipped';
  }

  markDesignPreviewStatus(options.workspaceRoot, 'skipped', {
    productName: options.productName,
    penpotUrl: options.penpot.url || DEFAULT_PENPOT_URL,
    notes: 'Design Canvas disabled',
  });
  return 'skipped';
}

export function createVsCodeDesignPreviewGatePort(
  penpot: PenpotManager,
): DesignPreviewGatePort {
  return {
    async runGate(input) {
      return promptDesignPreviewGate({
        workspaceRoot: input.workspaceRoot,
        penpot,
        goal: input.goal,
      });
    },
  };
}

export function readGate(workspaceRoot: string): DesignPreviewGate | undefined {
  return loadDesignPreviewGate(workspaceRoot);
}
