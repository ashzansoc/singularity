import * as vscode from 'vscode';

const PATTERN = '**/.singularity';

/** Ensure workspace intelligence folder is visible in the File Explorer. */
export function ensureDotSingularityVisibleInExplorer(context: vscode.ExtensionContext): void {
  const apply = () => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      void patchFolder(folder);
    }
  };

  apply();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(apply));
}

async function patchFolder(folder: vscode.WorkspaceFolder): Promise<void> {
  const files = vscode.workspace.getConfiguration('files', folder.uri);
  const exclude = { ...(files.get<Record<string, boolean>>('exclude') ?? {}) };
  if (exclude[PATTERN] === false) {
    return;
  }
  exclude[PATTERN] = false;
  await files.update('exclude', exclude, vscode.ConfigurationTarget.WorkspaceFolder);
}
