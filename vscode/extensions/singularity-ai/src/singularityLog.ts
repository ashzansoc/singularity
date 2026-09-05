import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.message;
  }
  if (typeof detail === 'string') {
    return detail;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/** Shared structured log channel for the Singularity AI extension host. */
export function getSingularityLog(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Singularity AI', { log: true });
  }
  return channel;
}

export function singularityLog(message: string, ...detail: unknown[]): void {
  getSingularityLog().info(detail.length ? `${message} ${detail.map(formatDetail).join(' ')}` : message);
}

export function singularityWarn(message: string, ...detail: unknown[]): void {
  getSingularityLog().warn(detail.length ? `${message} ${detail.map(formatDetail).join(' ')}` : message);
}

export function singularityError(message: string, ...detail: unknown[]): void {
  getSingularityLog().error(detail.length ? `${message} ${detail.map(formatDetail).join(' ')}` : message);
}
