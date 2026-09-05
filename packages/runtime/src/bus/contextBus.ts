import type { BusEvent, BusEventKind } from '../types.js';

export type AgentMessageType =
  | 'Finding'
  | 'Question'
  | 'DependencyRequest'
  | 'Blocker'
  | 'Evidence'
  | 'Recommendation'
  | 'Result';

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId?: string;
  taskId: string;
  type: AgentMessageType;
  message: string;
  payload?: Record<string, unknown>;
  ts: number;
}

export type BusListener = (event: BusEvent) => void;
export type AgentMessageListener = (message: AgentMessage) => void;

/**
 * Typed in-process context bus for worker → integrator coordination
 * and structured inter-agent messages.
 */
export class ContextBus {
  private readonly listeners = new Set<BusListener>();
  private readonly messageListeners = new Set<AgentMessageListener>();
  private readonly history: BusEvent[] = [];
  private readonly messages: AgentMessage[] = [];
  private msgSeq = 0;

  on(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onMessage(listener: AgentMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  publishMessage(
    msg: Omit<AgentMessage, 'id' | 'ts'> & { id?: string; ts?: number },
  ): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: msg.id ?? `msg-${++this.msgSeq}`,
      ts: msg.ts ?? Date.now(),
    };
    this.messages.push(full);
    for (const l of this.messageListeners) {
      l(full);
    }
    this.emitKind('Custom', msg.taskId, msg.message, {
      payload: { agentMessage: full },
    });
    return full;
  }

  getMessagesForTask(taskId: string): AgentMessage[] {
    return this.messages.filter(
      (m) => m.taskId === taskId || m.toAgentId === taskId,
    );
  }

  getMessages(): readonly AgentMessage[] {
    return this.messages;
  }

  emit(event: Omit<BusEvent, 'ts'> & { ts?: number }): BusEvent {
    const full: BusEvent = { ...event, ts: event.ts ?? Date.now() };
    this.history.push(full);
    for (const l of this.listeners) {
      l(full);
    }
    return full;
  }

  emitKind(
    kind: BusEventKind,
    taskId: string,
    message: string,
    extra?: Partial<Pick<BusEvent, 'path' | 'payload'>>,
  ): BusEvent {
    return this.emit({ kind, taskId, message, ...extra });
  }

  getEvents(): readonly BusEvent[] {
    return this.history;
  }

  getEventsForTask(taskId: string): BusEvent[] {
    return this.history.filter((e) => e.taskId === taskId);
  }

  clear(): void {
    this.history.length = 0;
  }
}
