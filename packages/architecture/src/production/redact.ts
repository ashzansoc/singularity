const SENSITIVE_KEY =
  /(token|secret|password|passwd|authorization|cookie|private_key|api_key|apikey|credential|bearer)/i;

const MAX_STRING = 4_096;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[truncated]';
  }
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function redactRecord(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input) {
    return undefined;
  }
  return redactValue(input) as Record<string, unknown>;
}
