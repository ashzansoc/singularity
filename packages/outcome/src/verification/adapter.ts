import type { RequirementStatus, VerificationPlan } from '../domain/types.js';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CommandExecutor {
  exec(
    command: string,
    args: string[],
    opts: { cwd: string; timeoutMs: number },
  ): Promise<CommandResult>;
}

export interface VerificationContext {
  workspaceRoot: string;
  missionId: string;
  codeRevision: string;
  requirementVersionHash: string;
  executor: CommandExecutor;
}

export interface VerificationResult {
  result: RequirementStatus;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  source: string;
  testsDiscovered?: number;
  testsExecuted?: number;
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
}

export interface VerificationAdapter {
  type: string;
  canHandle(plan: VerificationPlan): boolean;
  execute(plan: VerificationPlan, context: VerificationContext): Promise<VerificationResult>;
}

const ALLOWED_BINS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'tsc',
  'pytest',
  'python',
  'python3',
  'go',
  'cargo',
]);

export function assertSafeCommand(command: string, args: string[]): void {
  const base = command.split(/[/\\]/).pop() ?? command;
  if (!ALLOWED_BINS.has(base)) {
    throw new Error(`verification command not allowed: ${command}`);
  }
  const joined = args.join(' ');
  if (/[;&|`$]/.test(command) || /[;&|`$]/.test(joined)) {
    throw new Error('verification command contains forbidden shell metacharacters');
  }
}
