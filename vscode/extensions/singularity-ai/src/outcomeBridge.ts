/**
 * Outcome Engine — intelligence plane only.
 * Chat critical path must use emitOutcomeEvent (void) — never start/stop/verify.
 */

import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  createOutcomeSubsystem,
  type OutcomeSubsystem,
} from '@singularity/outcome';
import { getMemorySubsystem } from './memoryBridge.js';
import { isIntelligenceRemoteMode } from './intelligenceBridge.js';
import { getIntelligenceClient } from './intelligenceWorkerProcess.js';
import { singularityWarn } from './singularityLog.js';

let sys: OutcomeSubsystem | undefined;

export function getOutcomeSubsystem(): OutcomeSubsystem | undefined {
  return sys;
}

export function startOutcomeDaemon(workspaceRoot: string): OutcomeSubsystem | undefined {
  if (isIntelligenceRemoteMode()) {
    return undefined;
  }
  const cfg = vscode.workspace.getConfiguration('singularity.ai');
  const enabled = cfg.get<boolean>('outcome.enabled', true);
  if (!enabled) {
    return undefined;
  }
  try {
    sys?.stop();
    sys = createOutcomeSubsystem({
      workspaceRoot,
      projectId: workspaceRoot,
      flags: {
        outcome_engine_enabled: enabled,
        outcome_extraction_enabled: cfg.get<boolean>('outcome.extractionEnabled', true),
        outcome_verification_enabled: cfg.get<boolean>('outcome.verificationEnabled', true),
        human_review_enabled: cfg.get<boolean>('outcome.humanReviewEnabled', true),
      },
      memorySink: {
        remember(input) {
          getMemorySubsystem()?.emit({
            event_type: 'agent.decision',
            project_id: input.project_id,
            payload: {
              summary: input.title,
              text: input.content,
              source_id: input.source_id,
            },
          });
        },
      },
    });
    void sys.start().catch(() => {
      /* coding continues */
    });
    return sys;
  } catch (e) {
    singularityWarn('[singularity-ai] Outcome Engine failed to start', e);
    sys = undefined;
    return undefined;
  }
}

export function disposeOutcomeDaemon(): void {
  try {
    sys?.stop();
  } catch {
    /* ignore */
  }
  sys = undefined;
}

/** Coding plane: never throws, never awaits. */
export function emitOutcomeEvent(
  event_type:
    | 'USER_INTENT_CAPTURED'
    | 'CODE_CHANGE_COMPLETED'
    | 'FILE_CREATED'
    | 'FILE_MODIFIED'
    | 'FILE_DELETED'
    | 'mission.execution.updated'
    | 'READY_FOR_VERIFICATION',
  extra?: {
    changed_files?: string[];
    text?: string;
    session_id?: string;
    task_id?: string;
    commit_id?: string;
    mission_id?: string;
    revision?: string;
    /** Runtime hot-path verification observations (Outcome persists as Evidence). */
    verification_evidence?: unknown;
  },
): void {
  try {
    if (isIntelligenceRemoteMode()) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      void getIntelligenceClient()?.postCodingEvent({
        event_type,
        project_id: folder ?? 'default',
        changed_files: extra?.changed_files,
        text: extra?.text ?? extra?.revision,
        session_id: extra?.session_id,
        task_id: extra?.task_id,
        commit_id: extra?.commit_id ?? extra?.revision,
        mission_id: extra?.mission_id,
        ...(extra?.verification_evidence !== undefined
          ? { payload: { verification_evidence: extra.verification_evidence } }
          : {}),
      });
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const payload: Record<string, unknown> = {};
    if (extra?.text) {
      payload.text = extra.text;
    }
    if (extra?.revision) {
      payload.revision = extra.revision;
    }
    if (extra?.verification_evidence !== undefined) {
      payload.verification_evidence = extra.verification_evidence;
    }
    sys?.emit({
      event_type,
      project_id: folder ?? 'default',
      changed_files: extra?.changed_files,
      session_id: extra?.session_id,
      task_id: extra?.task_id,
      commit_id: extra?.commit_id ?? extra?.revision,
      mission_id: extra?.mission_id,
      payload: Object.keys(payload).length ? payload : undefined,
    });
  } catch {
    /* coding continues */
  }
}

/** Records remediation for async replan when Outcome pipeline requests it. */
export function queueRemediationReplan(payload: {
  missionId: string;
  plannerPrompt: string;
  goal: string;
}): void {
  emitOutcomeEvent('mission.execution.updated', {
    mission_id: payload.missionId,
    text: payload.plannerPrompt,
    task_id: 'remediation-queued',
  });
}

export function outcomeDbHint(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return '';
  }
  return join(folder, '.singularity', 'outcome', 'outcome.sqlite');
}
