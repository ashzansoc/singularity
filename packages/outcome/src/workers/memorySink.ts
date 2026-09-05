/**
 * Optional projection of outcomes into the Memory Engine.
 * Coding plane MUST NOT import this module.
 */
export interface MemorySink {
  remember(input: {
    project_id: string;
    type: string;
    title: string;
    content: string;
    reason?: string;
    source_id?: string;
    entities?: string[];
  }): void;
}

export class NoopMemorySink implements MemorySink {
  remember(): void {
    /* optional */
  }
}
