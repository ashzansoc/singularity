import type { ExecutionPlan, TaskNode } from '@singularity/runtime';

export interface TodoProjectionItem {
  id: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'cancelled';
  details?: string;
}

function taskStatusToTodo(status: TaskNode['status']): TodoProjectionItem['status'] {
  switch (status) {
    case 'running':
    case 'verifying':
    case 'waiting':
      return 'in-progress';
    case 'done':
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'not-started';
    default:
      return 'not-started';
  }
}

export function tasksToTodoItems(nodes: TaskNode[]): TodoProjectionItem[] {
  return nodes.map(n => ({
    id: n.id,
    title: n.title,
    status: taskStatusToTodo(n.status),
    details: n.acceptanceCriteria?.join('; ') ?? n.description ?? n.expectedOutput,
  }));
}

export function renderTodoMd(plan: ExecutionPlan, items?: TodoProjectionItem[]): string {
  const todos = items ?? tasksToTodoItems(plan.nodes);
  const lines: string[] = [
    `# ${plan.goal}`,
    '',
    `> Auto-generated projection from execution engine. Canonical state: \`.singularity/execution/\``,
    '',
    `## Plan`,
    '',
    plan.projectSummary ? `${plan.projectSummary}\n` : '',
  ];

  for (const item of todos) {
    const checked = item.status === 'completed' ? 'x' : ' ';
    const marker = item.status === 'in-progress' ? ' *(in progress)*' : '';
    lines.push(`- [${checked}] **${item.title}**${marker}`);
    if (item.details) {
      lines.push(`  - ${item.details}`);
    }
  }

  lines.push('');
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

export class TodoProjection {
  constructor(private lastRendered?: string) {}

  render(plan: ExecutionPlan): string {
    this.lastRendered = renderTodoMd(plan);
    return this.lastRendered;
  }

  getLastRendered(): string | undefined {
    return this.lastRendered;
  }
}
