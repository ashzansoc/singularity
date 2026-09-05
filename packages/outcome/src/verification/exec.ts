import { execFile } from 'node:child_process';
import type { CommandExecutor, CommandResult } from './adapter.js';

export function createDefaultExecutor(): CommandExecutor {
  return {
    exec(command, args, opts) {
      return new Promise<CommandResult>((resolve) => {
        const t0 = Date.now();
        const child = execFile(
          command,
          args,
          {
            cwd: opts.cwd,
            timeout: opts.timeoutMs,
            env: { ...process.env, NODE_ENV: 'test' },
            maxBuffer: 2 * 1024 * 1024,
          },
          (err, stdout, stderr) => {
            const durationMs = Date.now() - t0;
            const timedOut =
              !!err && ((err as NodeJS.ErrnoException & { killed?: boolean }).killed === true);
            const exitCode =
              err && typeof (err as { code?: number }).code === 'number'
                ? Number((err as { code?: number }).code)
                : err
                  ? 1
                  : 0;
            resolve({
              exitCode: timedOut ? -1 : exitCode,
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
              durationMs,
              timedOut,
            });
          },
        );
        child.on('error', () => {
          resolve({
            exitCode: 127,
            stdout: '',
            stderr: `failed to spawn ${command}`,
            durationMs: Date.now() - t0,
            timedOut: false,
          });
        });
      });
    },
  };
}
