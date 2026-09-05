import type { InvalidationScope } from './types.js';

export interface VersionState {
  templateVersion: string;
  prefixVersion: string;
  settingsVersion: string;
  depsVersion: string;
  branch: string;
  workspaceId: string;
}

export interface InvalidationEvent {
  scope: InvalidationScope;
  /** Optional payload, e.g. new branch name or workspace id. */
  value?: string;
}

/**
 * Maps IDE events to version bumps without clearing the entire cache.
 * Callers rebuild fingerprints / keys with the updated versions.
 */
export class InvalidationController {
  constructor(private state: VersionState) {}

  getState(): VersionState {
    return { ...this.state };
  }

  apply(event: InvalidationEvent): VersionState {
    switch (event.scope) {
      case 'file_save':
        // Fingerprint inputs change naturally; no version bump required.
        break;
      case 'branch_switch':
        if (event.value) {
          this.state.branch = event.value;
        }
        break;
      case 'dependency_change':
        this.state.depsVersion = bump(this.state.depsVersion);
        break;
      case 'template_change':
        this.state.templateVersion = bump(this.state.templateVersion);
        break;
      case 'provider_change':
        this.state.prefixVersion = bump(this.state.prefixVersion);
        break;
      case 'settings_change':
        this.state.settingsVersion = bump(this.state.settingsVersion);
        break;
      case 'workspace_change':
        if (event.value) {
          this.state.workspaceId = event.value;
        }
        break;
      default: {
        const _exhaustive: never = event.scope;
        void _exhaustive;
      }
    }
    return this.getState();
  }
}

function bump(version: string): string {
  const n = Number.parseInt(version, 10);
  if (Number.isFinite(n)) {
    return String(n + 1);
  }
  return `${version}.1`;
}
