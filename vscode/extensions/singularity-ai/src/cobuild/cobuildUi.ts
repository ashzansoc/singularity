import * as vscode from 'vscode';
import type { CobuildService } from './cobuildService.js';
import { COBUILD_MODELS, formatVramGb, type CobuildSession } from './types.js';

export async function openCobuildMenu(service: CobuildService): Promise<void> {
  const session = service.current;
  if (session) {
    await showActiveMenu(service, session);
    return;
  }

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: '$(add) Create Cobuild pod',
        description: 'Pick a model, start Cobuild, share an invite token',
        action: 'create' as const,
      },
      {
        label: '$(link) Join with token',
        description: 'Enter an invite token from a host',
        action: 'join' as const,
      },
      {
        label: '$(book) About Cobuild',
        description: 'Pool GPUs into a Singularity Cobuild virtual supercomputer',
        action: 'about' as const,
      },
    ],
    {
      title: 'Singularity Cobuild',
      placeHolder: 'Pool GPUs with friends into a virtual supercomputer',
    },
  );

  if (!pick) {
    return;
  }
  if (pick.action === 'create') {
    await createFlow(service);
  } else if (pick.action === 'join') {
    await joinFlow(service);
  } else {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/hyperspaceai/agi'));
  }
}

async function showActiveMenu(service: CobuildService, session: CobuildSession): Promise<void> {
  const resources = service.getResources();
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: `$(check) ${session.modelLabel}`,
        description: `${session.role} · ${session.podName}`,
        detail: `VRAM ${formatVramGb(resources.vramUsedMb)} / ${formatVramGb(resources.vramTotalMb)} · ${resources.onlineCount} online`,
        action: 'status' as const,
      },
      {
        label: '$(copy) Copy invite token',
        description: session.inviteToken,
        action: 'copy' as const,
      },
      ...(session.source === 'simulated'
        ? [
            {
              label: '$(person-add) Simulate peer join',
              description: 'Adds VRAM to the pool (demo)',
              action: 'sim-peer' as const,
            },
          ]
        : []),
      {
        label: '$(sign-out) Leave Cobuild pod',
        action: 'leave' as const,
      },
    ],
    {
      title: 'Singularity Cobuild · active',
      placeHolder: 'Manage your shared GPU pod',
    },
  );

  if (!pick) {
    return;
  }
  switch (pick.action) {
    case 'copy':
      await vscode.env.clipboard.writeText(session.inviteToken);
      void vscode.window.showInformationMessage('Cobuild invite token copied.');
      break;
    case 'sim-peer':
      await service.simulatePeerJoin();
      break;
    case 'leave':
      await service.leavePod();
      break;
    case 'status':
      void vscode.window.showInformationMessage(
        `Cobuild · ${session.modelLabel} · token ${session.inviteToken} · VRAM ${formatVramGb(resources.vramUsedMb)}/${formatVramGb(resources.vramTotalMb)}`,
      );
      break;
  }
}

async function createFlow(service: CobuildService): Promise<void> {
  const modelPick = await vscode.window.showQuickPick(
    COBUILD_MODELS.map(m => ({
      label: m.label,
      description: `needs ~${formatVramGb(m.minVramMb)} alone`,
      detail: m.description,
      modelId: m.id,
    })),
    {
      title: 'Singularity Cobuild · select model',
      placeHolder: 'Model will be sharded across pod VRAM as members join',
    },
  );
  if (!modelPick) {
    return;
  }

  try {
    const session = await service.createPod(modelPick.modelId);
    if (session) {
      await vscode.env.clipboard.writeText(session.inviteToken);
      const copyNote = await vscode.window.showInformationMessage(
        `Invite token copied. Friends run Cobuild → Join with token.`,
        'Copy again',
        'Learn more',
      );
      if (copyNote === 'Copy again') {
        await vscode.env.clipboard.writeText(session.inviteToken);
      } else if (copyNote === 'Learn more') {
        await vscode.env.openExternal(vscode.Uri.parse('https://pods.hyper.space/'));
      }
    }
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Cobuild create failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function joinFlow(service: CobuildService): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: 'Singularity Cobuild · join pod',
    prompt: 'Paste the invite token from the host',
    placeHolder: 'Invite token',
    ignoreFocusOut: true,
  });
  if (!token) {
    return;
  }
  try {
    await service.joinPod(token);
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Cobuild join failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function formatCobuildStatusText(service: CobuildService): string | undefined {
  if (!service.isActive) {
    return undefined;
  }
  const r = service.getResources();
  return `$(server-process) Cobuild ${formatVramGb(r.vramUsedMb)}/${formatVramGb(r.vramTotalMb)} · ${r.onlineCount} GPU`;
}

export function formatCobuildStatusTooltip(service: CobuildService): string {
  const session = service.current;
  if (!session) {
    return 'Singularity Cobuild inactive';
  }
  const r = service.getResources();
  const lines = [
    `Singularity Cobuild · ${session.modelLabel}`,
    `Pod: ${session.podName}`,
    `Role: ${session.role}`,
    `VRAM: ${formatVramGb(r.vramUsedMb)} used / ${formatVramGb(r.vramTotalMb)} pooled`,
    `Members online: ${r.onlineCount}/${r.memberCount}`,
    `Token: ${session.inviteToken}`,
    session.source === 'simulated' ? 'Mode: simulated (demo)' : 'Mode: live pod',
  ];
  return lines.join('\n');
}
