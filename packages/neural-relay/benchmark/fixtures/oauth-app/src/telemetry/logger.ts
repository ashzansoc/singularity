export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  ts: string;
}

const buffer: LogEntry[] = [];

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  buffer.push({ level, message, context, ts: new Date().toISOString() });
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => log('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => log('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => log('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => log('error', m, c),
};

export function drainLogs(): LogEntry[] {
  return buffer.splice(0);
}