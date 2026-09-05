export interface Evidence {
  type: string;
  id: string;
  excerpt?: string;
}

export interface EvidenceSource {
  getEvidence(sourceId: string): Promise<Evidence | undefined>;
}

export class GitEvidenceSource implements EvidenceSource {
  constructor(private readonly workspaceRoot: string) {}

  async getEvidence(sourceId: string): Promise<Evidence | undefined> {
    try {
      const { execSync } = await import('node:child_process');
      const msg = execSync(`git log -1 --pretty=%s ${sourceId}`, {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { type: 'commit', id: sourceId, excerpt: msg.slice(0, 400) };
    } catch {
      return { type: 'commit', id: sourceId };
    }
  }
}

export class StaticEvidenceSource implements EvidenceSource {
  constructor(private readonly items = new Map<string, Evidence>()) {}

  async getEvidence(sourceId: string): Promise<Evidence | undefined> {
    return this.items.get(sourceId);
  }
}
