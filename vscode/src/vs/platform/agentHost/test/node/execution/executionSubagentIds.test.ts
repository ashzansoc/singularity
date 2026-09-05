import { describe, expect, it } from 'vitest';
import { buildExecutionToolCallId, isExecutionToolCallId, parseExecutionToolCallId } from '../../../node/execution/executionSubagentIds.js';

describe('executionSubagentIds', () => {
  it('round-trips execution tool call ids with task ids containing dashes', () => {
    const id = buildExecutionToolCallId('exec-uuid-1234', 'TASK-002');
    expect(isExecutionToolCallId(id)).toBe(true);
    expect(parseExecutionToolCallId(id)).toEqual({ executionId: 'exec-uuid-1234', taskId: 'TASK-002' });
  });
});
