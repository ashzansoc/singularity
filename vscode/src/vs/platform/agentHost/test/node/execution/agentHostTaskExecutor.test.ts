import { describe, expect, it } from 'vitest';
import { NullLogService } from '../../../../log/common/log.js';
import { AgentHostTaskExecutor } from '../../../node/execution/agentHostTaskExecutor.js';
import { buildExecutionToolCallId } from '../../../node/execution/executionSubagentIds.js';
import { executionSubagentCompletionRegistry } from '../../../node/execution/subagentCompletionRegistry.js';
import type { ExecutionTaskRequest } from '../../../node/execution/executionTypes.js';

describe('AgentHostTaskExecutor', () => {
  it('spawns execution subagent and waits for completion registry', async () => {
    const spawned: string[] = [];
    const ctx: ExecutionTaskRequest = {
      executionId: 'exec-1',
      workspaceRoot: '/tmp',
      parentSessionId: 'session-1',
      parentChatUri: 'ahp-chat://session-1/default',
      task: {
        id: 'TASK-002',
        title: 'Backend',
        expectedOutput: 'API',
        ownedPaths: ['backend/'],
      },
    };
    const toolCallId = buildExecutionToolCallId(ctx.executionId, ctx.task.id);

    const executor = new AgentHostTaskExecutor({
      logService: new NullLogService(),
      spawnHooks: {
        onChatSpawned: event => {
          spawned.push(event.chat.toString());
        },
        startExecutionSubagentTurn: () => 'turn-1',
        runSubagentTurn: async () => {
          expect(executionSubagentCompletionRegistry.has(toolCallId)).toBe(true);
          executionSubagentCompletionRegistry.resolve(toolCallId, {
            ok: true,
            subagentResult: {
              subagentId: 'TASK-002',
              status: 'success',
              summary: 'done',
              filesCreated: [],
              filesModified: ['backend/'],
              filesDeleted: [],
              testsRun: [],
              testsPassed: [],
              testsFailed: [],
              issues: [],
              recommendations: [],
            },
          });
        },
        collectSubagentResult: () => ({
          subagentId: 'TASK-002',
          status: 'success',
          summary: 'fallback',
          filesCreated: [],
          filesModified: [],
          filesDeleted: [],
          testsRun: [],
          testsPassed: [],
          testsFailed: [],
          issues: [],
          recommendations: [],
        }),
      },
    });

    const result = await executor.executeTask(ctx);
    expect(result.ok).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain('TASK-002');
  });
});
