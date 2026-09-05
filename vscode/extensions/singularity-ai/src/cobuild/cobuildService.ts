import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as vscode from 'vscode';
import { HyperspaceCli } from './hyperspaceCli.js';
import {
  COBUILD_MODELS,
  type CobuildMember,
  type CobuildResources,
  type CobuildRole,
  type CobuildSession,
  type CobuildSource,
} from './types.js';
import { singularityWarn } from '../singularityLog.js';

const STORAGE_KEY = 'singularity.cobuild.session';
const DEFAULT_GATEWAY = 'http://127.0.0.1:8080/v1';

interface PodStatusJson {
  name?: string;
  pod?: string;
  model?: string;
  models?: Array<{ id?: string; name?: string }>;
  members?: Array<{
    id?: string;
    name?: string;
    online?: boolean;
    vram?: number;
    vramMb?: number;
    vramTotalMb?: number;
    vramUsedMb?: number;
    usedVramMb?: number;
    role?: string;
  }>;
  resources?: {
    vramTotalMb?: number;
    vramUsedMb?: number;
    totalVramMb?: number;
    usedVramMb?: number;
  };
  vram?: { total?: number; used?: number; totalMb?: number; usedMb?: number };
  shard?: { active?: boolean; model?: string };
}

export class CobuildService implements vscode.Disposable {
  private readonly cli = new HyperspaceCli();
  private readonly emitter = new EventEmitter();
  private readonly lmInfoEmitter = new vscode.EventEmitter<void>();
  private session: CobuildSession | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lmRegistration: vscode.Disposable | undefined;
  private localVramMb = 8_192;

  constructor(private readonly context: vscode.ExtensionContext) {
    void this.detectLocalVram();
    this.registerLanguageModelProvider();
    const saved = context.globalState.get<CobuildSession>(STORAGE_KEY);
    if (saved?.inviteToken) {
      this.session = saved;
      this.startPolling();
      this.lmInfoEmitter.fire();
    }
  }

  dispose(): void {
    this.stopPolling();
    this.lmRegistration?.dispose();
    this.lmRegistration = undefined;
    this.lmInfoEmitter.dispose();
    this.emitter.removeAllListeners();
  }

  get current(): CobuildSession | undefined {
    return this.session;
  }

  get isActive(): boolean {
    return !!this.session;
  }

  onDidChange(listener: (session: CobuildSession | undefined) => void): vscode.Disposable {
    this.emitter.on('change', listener);
    return { dispose: () => this.emitter.off('change', listener) };
  }

  async ensureCliOrConfirmSimulate(): Promise<CobuildSource | undefined> {
    if (await this.cli.isAvailable()) {
      return 'hyperspace';
    }
    const choice = await vscode.window.showWarningMessage(
      'Cobuild runtime is not installed. You can run a simulated pod to try the UI, or open install instructions.',
      'Simulate pod',
      'Install Cobuild runtime',
      'Cancel',
    );
    if (choice === 'Simulate pod') {
      return 'simulated';
    }
    if (choice === 'Install Cobuild runtime') {
      await vscode.env.openExternal(vscode.Uri.parse('https://agents.hyper.space'));
      void vscode.window.showInformationMessage(
        'Install the Cobuild runtime, then restart Singularity and try Cobuild again.',
      );
    }
    return undefined;
  }

  async createPod(modelId: string): Promise<CobuildSession | undefined> {
    const model = COBUILD_MODELS.find(m => m.id === modelId) ?? {
      id: modelId,
      label: modelId,
      minVramMb: 8_192,
      description: modelId,
    };
    const source = await this.ensureCliOrConfirmSimulate();
    if (!source) {
      return undefined;
    }

    const podName = `singularity-${sanitizePodName(model.id)}-${randomBytes(2).toString('hex')}`;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Cobuild · starting ${model.label}`,
        cancellable: false,
      },
      async progress => {
        if (source === 'simulated') {
          progress.report({ message: 'Creating simulated pod…' });
          const inviteToken = `hsi_v1.sim.${randomBytes(12).toString('hex')}`;
          const session = this.buildSession({
            podName,
            inviteToken,
            modelId: model.id,
            modelLabel: model.label,
            role: 'host',
            source: 'simulated',
            members: [this.hostMember()],
          });
          await this.activate(session);
          void vscode.window.showInformationMessage(
            `Cobuild pod ready (simulated). Share token: ${inviteToken}`,
          );
          return session;
        }

        progress.report({ message: 'Ensuring Cobuild runtime…' });
        try {
          await this.cli.run(['start'], { timeoutMs: 60_000 });
        } catch {
          /* may already be running */
        }

        progress.report({ message: `Creating pod ${podName}…` });
        try {
          await this.cli.run(['pod', 'create', podName], { timeoutMs: 60_000 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/already|exists/i.test(msg)) {
            throw e;
          }
        }

        progress.report({ message: 'Generating invite token…' });
        const inviteOut = await this.cli.run(
          ['pod', 'invite', '--multi-use', '--ttl', '7d', '--role', 'member'],
          { timeoutMs: 30_000 },
        );
        const inviteToken =
          this.cli.extractInviteToken(`${inviteOut.stdout}\n${inviteOut.stderr}`) ??
          (await this.tryInviteFromJson());

        if (!inviteToken) {
          throw new Error('Cobuild did not return an invite token. Try creating the pod again.');
        }

        progress.report({ message: `Pulling / sharding ${model.label}…` });
        try {
          await this.cli.run(['pod', 'shard', model.id], { timeoutMs: 180_000 });
        } catch {
          try {
            await this.cli.run(['models', 'pull', model.id], { timeoutMs: 300_000 });
            await this.cli.run(['pod', 'shard', model.id], { timeoutMs: 180_000 });
          } catch (shardErr) {
            singularityWarn('[cobuild] shard deferred:', shardErr);
            void vscode.window.showWarningMessage(
              `Pod created, but sharding ${model.label} was deferred. Members can still join; shard when VRAM is ready.`,
            );
          }
        }

        let apiKey = 'pk_cobuild_local';
        let gatewayBaseUrl = DEFAULT_GATEWAY;
        try {
          const keyOut = await this.cli.run(['pod', 'keys', 'create', '--name', 'singularity-cobuild'], {
            timeoutMs: 30_000,
          });
          const keyMatch = `${keyOut.stdout}\n${keyOut.stderr}`.match(/\b(pk_[A-Za-z0-9]+)\b/);
          if (keyMatch) {
            apiKey = keyMatch[1];
          }
        } catch {
          /* optional */
        }
        try {
          const gw = await this.cli.runJson<{ url?: string; baseUrl?: string; port?: number }>([
            'pod',
            'gateway',
          ]);
          if (gw.url || gw.baseUrl) {
            gatewayBaseUrl = normalizeGateway(gw.url ?? gw.baseUrl!);
          } else if (gw.port) {
            gatewayBaseUrl = `http://127.0.0.1:${gw.port}/v1`;
          }
        } catch {
          /* default localhost */
        }

        const session = this.buildSession({
          podName,
          inviteToken,
          modelId: model.id,
          modelLabel: model.label,
          role: 'host',
          source: 'hyperspace',
          gatewayBaseUrl,
          apiKey,
          members: [this.hostMember()],
        });
        await this.activate(session);
        void vscode.window.showInformationMessage(
          `Cobuild pod ready. Share this token so others can join: ${inviteToken}`,
        );
        return session;
      },
    );
  }

  async joinPod(inviteToken: string): Promise<CobuildSession | undefined> {
    const token = inviteToken.trim();
    if (!token) {
      return undefined;
    }

    if (token.startsWith('hsi_v1.sim.')) {
      const model = COBUILD_MODELS[1];
      const session = this.buildSession({
        podName: 'singularity-joined-sim',
        inviteToken: token,
        modelId: model.id,
        modelLabel: model.label,
        role: 'member',
        source: 'simulated',
        members: [
          {
            id: 'host',
            name: 'Host',
            online: true,
            vramTotalMb: 8_192,
            vramUsedMb: 2_048,
            role: 'host',
          },
          this.hostMember('member'),
        ],
      });
      await this.activate(session);
      void vscode.window.showInformationMessage('Joined simulated Cobuild pod.');
      return session;
    }

    const source = await this.ensureCliOrConfirmSimulate();
    if (source !== 'hyperspace') {
      return undefined;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Cobuild · joining pod',
        cancellable: false,
      },
      async progress => {
        progress.report({ message: 'Starting Cobuild…' });
        try {
          await this.cli.run(['start'], { timeoutMs: 60_000 });
        } catch {
          /* ignore */
        }
        progress.report({ message: 'Redeeming invite…' });
        await this.cli.run(['pod', 'join', token], { timeoutMs: 60_000 });

        let modelId = COBUILD_MODELS[0].id;
        let modelLabel = COBUILD_MODELS[0].label;
        let podName = 'pod';
        try {
          const status = await this.cli.runJson<PodStatusJson>(['pod', 'status']);
          podName = status.name ?? status.pod ?? podName;
          const mid = status.shard?.model ?? status.model ?? status.models?.[0]?.id ?? status.models?.[0]?.name;
          if (mid) {
            modelId = mid;
            modelLabel = COBUILD_MODELS.find(m => m.id === mid)?.label ?? mid;
          }
        } catch {
          /* defaults */
        }

        const session = this.buildSession({
          podName,
          inviteToken: token,
          modelId,
          modelLabel,
          role: 'member',
          source: 'hyperspace',
          members: [this.hostMember('member')],
        });
        await this.activate(session);
        void vscode.window.showInformationMessage(`Joined Cobuild pod · ${modelLabel}`);
        return session;
      },
    );
  }

  async leavePod(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    if (session.source === 'hyperspace') {
      try {
        await this.cli.run(['pod', 'leave'], { timeoutMs: 30_000 });
      } catch (e) {
        singularityWarn('[cobuild] pod leave:', e);
      }
    }
    this.session = undefined;
    await this.context.globalState.update(STORAGE_KEY, undefined);
    this.stopPolling();
    this.lmInfoEmitter.fire();
    this.emitter.emit('change', undefined);
    void vscode.window.showInformationMessage('Left Cobuild pod.');
  }

  getResources(): CobuildResources {
    const session = this.session;
    if (!session) {
      return {
        vramTotalMb: 0,
        vramUsedMb: 0,
        memberCount: 0,
        onlineCount: 0,
        shardActive: false,
      };
    }
    const online = session.members.filter(m => m.online);
    const vramTotalMb = online.reduce((s, m) => s + m.vramTotalMb, 0);
    const vramUsedMb = online.reduce((s, m) => s + m.vramUsedMb, 0);
    return {
      vramTotalMb,
      vramUsedMb,
      memberCount: session.members.length,
      onlineCount: online.length,
      modelId: session.modelId,
      shardActive: vramUsedMb > 0,
    };
  }

  /** Demo helper: add a simulated peer so VRAM grows in the status bar. */
  async simulatePeerJoin(): Promise<void> {
    if (!this.session || this.session.source !== 'simulated') {
      void vscode.window.showWarningMessage('Simulate peer is only available in simulated Cobuild pods.');
      return;
    }
    const n = this.session.members.length + 1;
    const peer: CobuildMember = {
      id: `peer-${n}`,
      name: `Peer ${n}`,
      online: true,
      vramTotalMb: 8_192 + (n % 3) * 4_096,
      vramUsedMb: 1_024 + (n % 4) * 512,
      role: 'peer',
    };
    this.session = {
      ...this.session,
      members: [...this.session.members, peer],
    };
    await this.persist();
    this.emitter.emit('change', this.session);
  }

  private buildSession(partial: {
    podName: string;
    inviteToken: string;
    modelId: string;
    modelLabel: string;
    role: CobuildRole;
    source: CobuildSource;
    gatewayBaseUrl?: string;
    apiKey?: string;
    members: CobuildMember[];
  }): CobuildSession {
    return {
      podName: partial.podName,
      inviteToken: partial.inviteToken,
      modelId: partial.modelId,
      modelLabel: partial.modelLabel,
      role: partial.role,
      source: partial.source,
      gatewayBaseUrl: partial.gatewayBaseUrl ?? DEFAULT_GATEWAY,
      apiKey: partial.apiKey ?? `pk_sim_${createHash('sha256').update(partial.inviteToken).digest('hex').slice(0, 24)}`,
      createdAt: Date.now(),
      members: partial.members,
    };
  }

  private hostMember(role: CobuildRole = 'host'): CobuildMember {
    return {
      id: 'local',
      name: role === 'host' ? 'You (host)' : 'You',
      online: true,
      vramTotalMb: this.localVramMb,
      vramUsedMb: Math.min(2_048, Math.floor(this.localVramMb * 0.25)),
      role,
    };
  }

  private async activate(session: CobuildSession): Promise<void> {
    this.session = session;
    await this.persist();
    this.startPolling();
    this.lmInfoEmitter.fire();
    this.emitter.emit('change', this.session);
    // Give the LM registry a tick, then point chat at the Cobuild model.
    setTimeout(() => {
      void vscode.commands.executeCommand('workbench.action.chat.changeModel', {
        vendor: 'cobuild',
        id: session.modelId,
        family: 'cobuild',
      });
    }, 400);
  }

  private async persist(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, this.session);
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.refreshStatus();
    }, 8_000);
    void this.refreshStatus();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async refreshStatus(): Promise<void> {
    if (!this.session) {
      return;
    }

    if (this.session.source === 'simulated') {
      // Gentle usage drift so the status bar feels alive.
      const members = this.session.members.map(m => {
        if (!m.online) {
          return m;
        }
        const delta = Math.floor((Math.random() - 0.4) * 256);
        const used = Math.max(256, Math.min(m.vramTotalMb, m.vramUsedMb + delta));
        return { ...m, vramUsedMb: used };
      });
      this.session = { ...this.session, members };
      await this.persist();
      this.emitter.emit('change', this.session);
      return;
    }

    try {
      let status: PodStatusJson;
      try {
        status = await this.cli.runJson<PodStatusJson>(['pod', 'resources']);
      } catch {
        status = await this.cli.runJson<PodStatusJson>(['pod', 'status']);
      }
      const members = this.mapMembers(status);
      if (members.length) {
        this.session = { ...this.session, members };
        await this.persist();
        this.emitter.emit('change', this.session);
      }
    } catch (e) {
      singularityWarn('[cobuild] status poll failed:', e);
    }
  }

  private mapMembers(status: PodStatusJson): CobuildMember[] {
    if (status.members?.length) {
      return status.members.map((m, i) => {
        const total =
          m.vramTotalMb ??
          m.vramMb ??
          (typeof m.vram === 'number' ? m.vram : undefined) ??
          this.localVramMb;
        const used = m.vramUsedMb ?? m.usedVramMb ?? Math.floor(total * 0.2);
        return {
          id: m.id ?? `m${i}`,
          name: m.name ?? `Member ${i + 1}`,
          online: m.online !== false,
          vramTotalMb: total,
          vramUsedMb: used,
          role: (m.role as CobuildMember['role']) ?? 'peer',
        };
      });
    }

    const total =
      status.resources?.vramTotalMb ??
      status.resources?.totalVramMb ??
      status.vram?.totalMb ??
      status.vram?.total;
    const used =
      status.resources?.vramUsedMb ??
      status.resources?.usedVramMb ??
      status.vram?.usedMb ??
      status.vram?.used;
    if (typeof total === 'number' && total > 0) {
      return [
        {
          id: 'cluster',
          name: this.session?.podName ?? 'Pod',
          online: true,
          vramTotalMb: total,
          vramUsedMb: typeof used === 'number' ? used : 0,
          role: 'host',
        },
      ];
    }
    return this.session?.members ?? [];
  }

  private async tryInviteFromJson(): Promise<string | undefined> {
    try {
      const data = await this.cli.runJson<{ token?: string; code?: string; invite?: string; url?: string }>([
        'pod',
        'invite',
        '--multi-use',
        '--ttl',
        '7d',
      ]);
      return (
        data.token ??
        data.code ??
        data.invite ??
        (data.url ? this.cli.extractInviteToken(data.url) : undefined)
      );
    } catch {
      return undefined;
    }
  }

  private async detectLocalVram(): Promise<void> {
    try {
      // macOS Metal: rough estimate from unified memory when nvidia-smi is absent
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const exec = promisify(execFile);
      try {
        const { stdout } = await exec('nvidia-smi', [
          '--query-gpu=memory.total',
          '--format=csv,noheader,nounits',
        ], { timeout: 5_000 });
        const mb = Number.parseInt(stdout.trim().split('\n')[0] ?? '', 10);
        if (Number.isFinite(mb) && mb > 0) {
          this.localVramMb = mb;
          return;
        }
      } catch {
        /* not NVIDIA */
      }
      if (process.platform === 'darwin') {
        try {
          const { stdout } = await exec('sysctl', ['-n', 'hw.memsize'], { timeout: 3_000 });
          const bytes = Number.parseInt(stdout.trim(), 10);
          if (Number.isFinite(bytes) && bytes > 0) {
            // Cap attributed "GPU" pool at half of unified memory for Cobuild estimates
            this.localVramMb = Math.max(4_096, Math.floor(bytes / 1024 / 1024 / 2));
          }
        } catch {
          /* keep default */
        }
      }
    } catch {
      /* keep default */
    }
  }

  private registerLanguageModelProvider(): void {
    this.lmRegistration?.dispose();
    this.lmRegistration = vscode.lm.registerLanguageModelChatProvider('cobuild', {
      onDidChangeLanguageModelChatInformation: this.lmInfoEmitter.event,
      provideLanguageModelChatInformation: async () => {
        const session = this.session;
        if (!session) {
          return [];
        }
        return [
          {
            id: session.modelId,
            name: `Cobuild · ${session.modelLabel}`,
            version: '1.0.0',
            family: 'cobuild',
            tooltip: `Singularity Cobuild pod ${session.podName}`,
            detail: session.source === 'simulated' ? 'simulated' : 'pod',
            maxInputTokens: 32_768,
            maxOutputTokens: 8_192,
            capabilities: {
              toolCalling: true,
              imageInput: false,
            },
          },
        ];
      },
      provideLanguageModelChatResponse: async (_model, messages, _options, progress, token) => {
        if (!this.session) {
          throw new Error('Cobuild pod is not active.');
        }
        if (this.session.source === 'simulated') {
          await this.streamSimulated(messages, progress, token);
          return;
        }
        await this.streamFromGateway(messages, progress, token);
      },
      provideTokenCount: async (_model, text) => {
        const s = typeof text === 'string' ? text : JSON.stringify(text);
        return Math.ceil(s.length / 4);
      },
    });
  }

  private async streamFromGateway(
    messages: ReadonlyArray<vscode.LanguageModelChatRequestMessage | vscode.LanguageModelChatMessage>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const session = this.session!;
    const body = {
      model: session.modelId,
      stream: true,
      messages: messages.map(m => ({
        role: m.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant',
        content: extractText(m),
      })),
    };

    const ac = new AbortController();
    const cancelSub = token.onCancellationRequested(() => ac.abort());
    let res: Response;
    try {
      res = await fetch(`${session.gatewayBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } finally {
      cancelSub.dispose();
    }

    if (token.isCancellationRequested) {
      return;
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Cobuild gateway error ${res.status}: ${errText.slice(0, 400)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!token.isCancellationRequested) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) {
            progress.report(new vscode.LanguageModelTextPart(chunk));
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }

  private async streamSimulated(
    messages: ReadonlyArray<vscode.LanguageModelChatRequestMessage | vscode.LanguageModelChatMessage>,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const last = messages[messages.length - 1];
    const prompt = last ? extractText(last).slice(0, 120) : '';
    const resources = this.getResources();
    const reply =
      `**Cobuild (simulated)** · ${this.session!.modelLabel}\n\n` +
      `Pooled VRAM: ${Math.round(resources.vramUsedMb / 1024 * 10) / 10} / ${Math.round(resources.vramTotalMb / 1024 * 10) / 10} GB across ${resources.onlineCount} node(s).\n\n` +
      `Invite token: \`${this.session!.inviteToken}\`\n\n` +
      (prompt ? `You said: ${prompt}\n\n` : '') +
      `Install the Cobuild runtime and create a live pod to run sharded local inference across friends' GPUs.`;

    for (const word of reply.split(/(\s+)/)) {
      if (token.isCancellationRequested) {
        return;
      }
      progress.report(new vscode.LanguageModelTextPart(word));
      await delay(12);
    }
  }
}

function sanitizePodName(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 24).toLowerCase();
}

function normalizeGateway(url: string): string {
  const u = url.replace(/\/$/, '');
  if (u.endsWith('/v1')) {
    return u;
  }
  return `${u}/v1`;
}

function extractText(
  message: vscode.LanguageModelChatRequestMessage | vscode.LanguageModelChatMessage,
): string {
  const parts = message.content;
  if (!Array.isArray(parts)) {
    return String(parts ?? '');
  }
  return parts
    .map(p => {
      if (p instanceof vscode.LanguageModelTextPart) {
        return p.value;
      }
      if (p && typeof p === 'object' && 'value' in p && typeof (p as { value: unknown }).value === 'string') {
        return (p as { value: string }).value;
      }
      return '';
    })
    .join('');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
