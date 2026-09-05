/**
 * Local Project Intelligence daemon.
 *
 *   SINGULARITY_WORKSPACE=/path/to/repo node dist/main.js
 *
 * Listens on 127.0.0.1 (PORT or 4781). The IDE spawns this as a child process
 * (`dist/intelligenceWorker/main.js`) so indexing never blocks the extension host.
 */

import { IntelligenceEngine, codeImpactFromEngine, serveIntelligence } from '@singularity/intelligence';
import { createArchitectureSubsystem, type GraphSink } from '@singularity/architecture';
import { createMemorySubsystem } from '@singularity/memory';
import { createOutcomeSubsystem } from '@singularity/outcome';

const workspace = process.env.SINGULARITY_WORKSPACE || process.cwd();
const port = Number(process.env.SINGULARITY_INTELLIGENCE_PORT || 4781);

async function main(): Promise<void> {
  const engine = new IntelligenceEngine({ workspaceRoot: workspace });
  const autoBootstrap = process.env.SINGULARITY_INTELLIGENCE_AUTO_BOOTSTRAP === '1';
  if (autoBootstrap) {
    void engine.bootstrapAsync().then((boot) => {
      console.log(`[project-intelligence] bootstrap queued ${boot.files} files`);
    });
  } else {
    console.log('[project-intelligence] lazy mode — indexing on demand only');
  }

  function graphSink(eng: IntelligenceEngine): GraphSink {
    return {
      upsertAdr(node) {
        eng.store.upsertNodes([
          {
            id: node.id,
            kind: 'adr',
            label: node.title,
            content: node.content,
            hash: node.id,
            version: 1,
            tokenCount: Math.max(1, Math.ceil(node.content.length / 4)),
            dependencies: [],
            lastModified: Date.now(),
          },
        ]);
      },
      upsertEdge(from, to, kind) {
        const k = kind.toUpperCase();
        const edgeKind =
          k === 'AFFECTS' ? 'affects' : k === 'IMPLEMENTED_BY' || k === 'IMPLEMENTS' ? 'implements' : 'related_to';
        eng.store.upsertEdges([
          {
            id: `${from}:${edgeKind}:${to}`,
            from,
            to,
            kind: edgeKind,
          },
        ]);
      },
    };
  }

  const memory = await createMemorySubsystem({
    workspaceRoot: workspace,
    projectId: workspace,
  });
  void memory.start().catch(() => undefined);

  const architecture = createArchitectureSubsystem({
    workspaceRoot: workspace,
    projectId: workspace,
    heuristicOnly: false,
    memorySink: {
      remember(input) {
        memory.emit({
          event_type: 'architecture.decision',
          project_id: input.project_id,
          payload: {
            summary: input.title,
            text: `${input.title}. ${input.content}. ${input.reason ?? ''}`,
            source_id: input.source_id,
            entities: input.entities,
          },
        });
      },
    },
    graph: graphSink(engine),
    codeImpact: codeImpactFromEngine(engine),
  });
  void architecture.start().catch(() => undefined);

  const outcome = createOutcomeSubsystem({
    workspaceRoot: workspace,
    projectId: workspace,
    memorySink: {
      remember(input) {
        memory.emit({
          event_type: 'agent.decision',
          project_id: input.project_id,
          payload: {
            summary: input.title,
            text: input.content,
            source_id: input.source_id,
          },
        });
      },
    },
  });
  void outcome.start().catch(() => undefined);

  const server = serveIntelligence(engine, { port, hostname: '127.0.0.1' }, architecture, memory, outcome);
  console.log(
    `[project-intelligence] workspace=${workspace} http://127.0.0.1:${server.port}`,
  );

  const shutdown = () => {
    try {
      architecture.stop();
      memory.stop();
      outcome.stop();
    } catch {
      /* ignore */
    }
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error('[project-intelligence] fatal', err);
  process.exit(1);
});
