/**
 * Optional projection onto the code-intelligence GraphStore.
 * Rich ADR graph lives in GraphBackend (not this). Coding plane MUST NOT import.
 */
export interface GraphSink {
  upsertAdr?(node: { id: string; title: string; content: string }): void;
  upsertEdge?(from: string, to: string, kind: string): void;
}

export class NoopGraphSink implements GraphSink {
  upsertAdr(): void {
    /* phase 2 */
  }
  upsertEdge(): void {
    /* phase 2 */
  }
}
