import { execSync } from 'node:child_process';
import type { Adr } from '../domain/adr/schema.js';
import type { DomainEvent } from '../events/types.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import type { GraphBackend } from './backend.js';
import { projectAdrToGraph } from './builder.js';
import { edgeId, nodeId } from './types.js';

export interface GitCommitEvidence {
  hash: string;
  subject: string;
  files: string[];
  body: string;
}

export function readCommitEvidence(
  workspaceRoot: string,
  commitId?: string,
): GitCommitEvidence | undefined {
  try {
    const spec = commitId ?? 'HEAD';
    const raw = execSync(`git show --name-only --pretty=format:%H%n%s%n%b%n==FILES== ${spec}`, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [head, filesPart] = raw.split('==FILES==');
    const lines = (head ?? '').split('\n');
    const hash = (lines[0] ?? spec).trim();
    const subject = (lines[1] ?? '').trim();
    const body = lines.slice(2).join('\n').trim();
    const files = (filesPart ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return { hash, subject, files, body };
  } catch {
    return undefined;
  }
}

export function attachEvidenceToMatchingAdrs(
  store: DecisionStore,
  graph: GraphBackend,
  projectId: string,
  event: DomainEvent,
  git?: GitCommitEvidence,
): Adr[] {
  const files = [
    ...(event.changed_files ?? []),
    ...(git?.files ?? []),
  ];
  const prId =
    typeof event.payload?.pull_request_id === 'string'
      ? event.payload.pull_request_id
      : typeof event.payload?.pr === 'string'
        ? event.payload.pr
        : undefined;
  const commitId = event.commit_id ?? git?.hash;
  const updated: Adr[] = [];

  for (const adr of store.list({ project_id: projectId })) {
    if (adr.record_kind === 'observation' || adr.status === 'rejected') {
      continue;
    }
    const overlaps = files.some(
      (f) =>
        adr.evidence.code.some((e) => f.includes(e.id) || e.id.includes(f)) ||
        adr.affected_components.some((c) => f.toLowerCase().includes(c.toLowerCase())),
    );
    if (!overlaps && !commitId && !prId) {
      continue;
    }
    if (!overlaps && files.length) {
      continue;
    }
    let changed = false;
    const next: Adr = {
      ...adr,
      evidence: {
        ...adr.evidence,
        commits: [...adr.evidence.commits],
        pull_requests: [...adr.evidence.pull_requests],
        code: [...adr.evidence.code],
      },
    };
    if (commitId && !next.evidence.commits.some((c) => c.id === commitId)) {
      next.evidence.commits.push({
        type: 'commit',
        id: commitId,
        relationship: 'implemented_decision',
      });
      changed = true;
    }
    if (prId && !next.evidence.pull_requests.some((c) => c.id === prId)) {
      next.evidence.pull_requests.push({
        type: 'pull_request',
        id: prId,
        relationship: 'implemented_decision',
      });
      changed = true;
    }
    for (const f of files) {
      if (!next.evidence.code.some((c) => c.id === f)) {
        next.evidence.code.push({ type: 'code', id: f, relationship: 'touches' });
        changed = true;
      }
    }
    if (!changed) {
      continue;
    }
    if (
      (next.status === 'accepted' || next.status === 'proposed') &&
      next.evidence.commits.length
    ) {
      next.status = next.status === 'proposed' ? next.status : 'implemented';
    }
    next.timestamps = { ...next.timestamps, updated_at: new Date().toISOString() };
    store.update(next);
    projectAdrToGraph(graph, next);
    if (commitId) {
      graph.upsertNodes([
        {
          id: nodeId('Commit', commitId),
          kind: 'Commit',
          label: commitId.slice(0, 12),
          project_id: projectId,
          meta: { subject: git?.subject },
        },
      ]);
      graph.upsertEdges([
        {
          id: edgeId(nodeId('ADR', next.id), 'IMPLEMENTED_BY', nodeId('Commit', commitId)),
          from: nodeId('ADR', next.id),
          to: nodeId('Commit', commitId),
          kind: 'IMPLEMENTED_BY',
        },
      ]);
    }
    if (prId) {
      graph.upsertNodes([
        {
          id: nodeId('PullRequest', prId),
          kind: 'PullRequest',
          label: prId,
          project_id: projectId,
        },
      ]);
      graph.upsertEdges([
        {
          id: edgeId(nodeId('ADR', next.id), 'IMPLEMENTED_BY', nodeId('PullRequest', prId)),
          from: nodeId('ADR', next.id),
          to: nodeId('PullRequest', prId),
          kind: 'IMPLEMENTED_BY',
        },
      ]);
    }
    updated.push(next);
  }
  return updated;
}
