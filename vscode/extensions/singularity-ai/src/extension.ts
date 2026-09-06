import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatUsageStatusText,
  formatUsageTooltip,
  formatUsd,
  normalizePromptUsage,
  ProjectTokenUsageStore,
  type TokenUsageDelta,
  workspaceFolderKey,
} from './tokenUsage.js';
import { ingestModelsPricingPayload } from './tokenPricing.js';
import { PromptDebugPanel } from './promptDebugPanel.js';
import { DesignPreviewPanel } from './designPreviewPanel.js';
import { promptDesignPreviewGate } from './designPreviewGate.js';
import { PenpotManager, setSharedPenpotManager } from './penpotManager.js';
import { runRuntimeInIde, isMultiAgentEnabled, type RunRuntimeRequest } from './runtimeBridge.js';
import {
  registerRuntimeChatParticipant,
  type SingularityAiApi,
} from './runtimeChatParticipant.js';
import { IntelligenceShellPanel } from './intelligenceShell/shellPanel.js';
import { openIntelligenceShell } from './brainBridge.js';
import {
  disposeContextEngine,
  ensureContextEngine,
  getActiveContextEngine,
  ingestChatMessage,
  prepareContextForPrompt,
  buildRuntimeContextPayload,
  scheduleContextIngest,
} from './contextEngineBridge.js';
import {
  expandNeuralRelay,
  latestNeuralRelayExperiment,
  neuralRelayStatus,
  registerNeuralRelayStatusBar,
  resolveNeuralRelay,
} from './neuralRelayBridge.js';
import {
  recordDeepSeekProviderUsage,
  registerCacheStatusBar,
  resetCacheStatus,
  setRequestPhase,
  showCacheTelemetryDebug,
} from './cacheTelemetry.js';
import { registerChatFooterTelemetry } from './chatFooterTelemetry.js';
import {
  disposeIntelligenceDaemon,
  startIntelligenceDaemon,
  notifyIntelligenceFile,
  notifyIntelligenceUriDeleted,
  intelligenceContext,
  intelligenceStatus,
  getIntelligenceEngine,
} from './intelligenceBridge.js';
import {
  emitArchitectureEvent,
  getArchitectureSubsystem,
} from './architectureBridge.js';
import { emitOutcomeEvent, getOutcomeSubsystem } from './outcomeBridge.js';
import { langExtractQueueDepth, waitForLangExtractJob } from './langExtractBackgroundAgent.js';
import { WikiPanel } from './wikiPanel.js';
import {
  disposeWikiEngine,
  fileWikiAnswer,
  ingestIntoWiki,
  initWiki,
  lintWiki,
  queryWiki,
  searchWiki,
  wikiStatus,
} from './wikiBridge.js';
import type { RuntimeEvent } from '@singularity/runtime';
import type { SingularityAI } from '@singularity/router';
import { requestTracer } from '@singularity/router';
import { DEFAULT_PENPOT_URL, markDesignPreviewStatus } from '@singularity/design';
import { CobuildService } from './cobuild/cobuildService.js';
import {
  formatCobuildStatusText,
  formatCobuildStatusTooltip,
  openCobuildMenu,
} from './cobuild/cobuildUi.js';
import { ensureDotSingularityVisibleInExplorer } from './dotSingularityExplorer.js';
import { ENGINE, uniqueEngines } from './engineCatalog.js';
import { startBrainBridge, disposeBrainBridge, reportIntelligenceShellProgress } from './brainBridge.js';
import { startGlobalMemoryBridge } from './globalMemoryBridge.js';
import { singularityLog, singularityWarn } from './singularityLog.js';
import { registerExecutionBridge } from './executionBridgeInit.js';

const SECRET_GATEWAY_KEY = 'singularity.ai.gatewayApiKey';

let ai: SingularityAI | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let cobuildStatusItem: vscode.StatusBarItem | undefined;
let tokenStore: ProjectTokenUsageStore | undefined;
let cobuildService: CobuildService | undefined;
let perfTraceChannel: vscode.OutputChannel | undefined;
let indexTimer: ReturnType<typeof setTimeout> | undefined;
let penpotManager: PenpotManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<SingularityAiApi | undefined> {
  ensureDotSingularityVisibleInExplorer(context);

  // Token status bar + recordUsage MUST register before any await / router import
  // so Singularity can update the bar even if @singularity/router fails to load.
  tokenStore = new ProjectTokenUsageStore(context);
  context.subscriptions.push({ dispose: () => tokenStore?.dispose() });

  // Perf traces: <workspace>/.singularity/traces/requests.jsonl (timings only).
  const traceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (traceRoot) {
    requestTracer.setTraceDir(join(traceRoot, '.singularity', 'traces'));
  }

  cobuildService = new CobuildService(context);
  context.subscriptions.push(cobuildService);

  const versionItem = vscode.window.createStatusBarItem(
    'singularity.version',
    vscode.StatusBarAlignment.Right,
    -10000,
  );
  versionItem.name = 'Singularity version';
  versionItem.text = `Singularity`;
  versionItem.tooltip = `Singularity ${vscode.version}`;
  versionItem.show();

  statusItem = vscode.window.createStatusBarItem(
    'singularity.ai.tokens',
    vscode.StatusBarAlignment.Right,
    1000,
  );
  statusItem.name = 'Singularity Spend & Tokens';
  statusItem.command = 'singularity.ai.status';
  updateStatusBar();
  statusItem.show();

  registerNeuralRelayStatusBar(context);
  registerCacheStatusBar(context);
  registerChatFooterTelemetry(context, () => tokenStore!.snapshot);

  cobuildStatusItem = vscode.window.createStatusBarItem(
    'singularity.ai.cobuild',
    vscode.StatusBarAlignment.Right,
    1001,
  );
  cobuildStatusItem.name = 'Cobuild VRAM';
  cobuildStatusItem.command = 'singularity.ai.cobuild';
  updateCobuildStatusBar();

  context.subscriptions.push(
    versionItem,
    statusItem,
    cobuildStatusItem,
    tokenStore.onDidChange(() => {
      updateStatusBar();
      void vscode.commands.executeCommand('singularity.ai.chatFooter.notify');
    }),
    cobuildService.onDidChange(() => updateCobuildStatusBar()),
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        tokenStore?.reloadFromDisk();
        updateStatusBar();
      }
    }),
    vscode.commands.registerCommand('singularity.ai.status', () => showStatus()),
    vscode.commands.registerCommand('singularity.ai.cobuild', () => {
      if (!cobuildService) {
        void vscode.window.showWarningMessage('Cobuild is not initialized.');
        return;
      }
      return openCobuildMenu(cobuildService);
    }),
    vscode.commands.registerCommand('singularity.ai.cobuild.copyToken', async () => {
      const token = cobuildService?.current?.inviteToken;
      if (!token) {
        void vscode.window.showWarningMessage('No active Cobuild pod.');
        return;
      }
      await vscode.env.clipboard.writeText(token);
      void vscode.window.showInformationMessage('Cobuild invite token copied.');
    }),
    vscode.commands.registerCommand('singularity.ai.cobuild.leave', () => cobuildService?.leavePod()),
    vscode.commands.registerCommand(
      'singularity.ai.recordUsage',
      (delta?: TokenUsageDelta) => {
        if (!tokenStore || !delta || typeof delta !== 'object') {
          return tokenStore?.snapshot;
        }
        const result = tokenStore.record(delta);
        const promptTokens =
          Math.max(0, delta.inputTokens ?? 0) + Math.max(0, delta.cachedInputTokens ?? 0);
        recordDeepSeekProviderUsage({
          modelId: delta.modelId,
          promptTokens,
          outputTokens: delta.outputTokens ?? 0,
          cacheReadTokens: delta.cachedInputTokens,
          cacheReported: delta.cacheReported === true,
        });
        return result;
      },
    ),
    vscode.commands.registerCommand('singularity.ai.neuralRelay.status', () => neuralRelayStatus()),
    vscode.commands.registerCommand(
      'singularity.ai.neuralRelay.resolve',
      async (req?: { task?: string }) => {
        const task = req?.task?.trim();
        if (!task) {
          return { ok: false };
        }
        const prepared = await resolveNeuralRelay(task);
        return {
          ok: true,
          enabled: prepared?.enabled ?? false,
          promptBlock: prepared?.promptBlock ?? '',
          experiment: prepared?.experiment,
          usedRelay: prepared?.usedRelay,
        };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.neuralRelay.expand',
      async (req?: { requested_files?: string[]; reason?: string }) => {
        const extra = await expandNeuralRelay(
          req?.requested_files ?? [],
          req?.reason ?? 'needs more context',
        );
        return { ok: true, promptBlock: extra };
      },
    ),
    vscode.commands.registerCommand('singularity.ai.neuralRelay.latest', () => {
      return { ok: true, experiment: latestNeuralRelayExperiment() };
    }),
    vscode.commands.registerCommand(
      'singularity.ai.recordRelay',
      (delta?: TokenUsageDelta) => {
        if (!tokenStore || !delta || typeof delta !== 'object') {
          return tokenStore?.snapshot;
        }
        // Nemotron context-intelligence tokens only — never DeepSeek provider cache.
        return tokenStore.record({
          inputTokens: delta.inputTokens,
          outputTokens: delta.outputTokens,
          modelId: delta.modelId,
        });
      },
    ),
    vscode.commands.registerCommand('singularity.ai.cacheTelemetry', () => {
      showCacheTelemetryDebug();
    }),
    vscode.commands.registerCommand('singularity.ai.perfTraces', () => {
      showPerfTraces();
    }),
    vscode.commands.registerCommand(
      'singularity.ai.perfTraceChat',
      (sample?: {
        modelId?: string;
        ttftMs?: number;
        completionTokens?: number;
        reasoningTokens?: number;
        ok?: boolean;
      }) => {
        if (!sample) {
          return { ok: false };
        }
        const traceId = requestTracer.begin({ source: 'chat' });
        requestTracer.mark(traceId, 'request_received');
        requestTracer.setMeta(traceId, {
          modelId: sample.modelId,
          ok: sample.ok ?? true,
        });
        if (typeof sample.ttftMs === 'number' && sample.ttftMs > 0) {
          // Reconstruct a first-token timestamp consistent with the reported TTFT.
          const receivedTs = Date.now() - Math.round(sample.ttftMs);
          const firstTokenTs = Date.now();
          const rec = requestTracer.snapshot(traceId);
          if (rec) {
            rec.phases[0].ts = receivedTs;
            rec.phases.push({ phase: 'first_token_received', ts: firstTokenTs });
            rec.phases.push({
              phase: 'model_request_started',
              ts: Math.max(receivedTs, firstTokenTs - 1),
            });
            rec.phases.push({ phase: 'request_finished', ts: firstTokenTs + 1 });
          }
        }
        requestTracer.addUsage(traceId, {
          completionTokens: sample.completionTokens,
          reasoningTokens: sample.reasoningTokens,
        });
        if (sample.completionTokens !== undefined) {
          requestTracer.setTokenFlow(
            traceId,
            sample.completionTokens,
            sample.completionTokens,
          );
        }
        requestTracer.finish(traceId, { ok: sample.ok ?? true });
        return { ok: true };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.setRequestPhase',
      (req?: { phase?: string; liveLabel?: string }) => {
        const phase = req?.phase as
          | 'Idle'
          | 'Resolving Context'
          | 'Neural Relay'
          | 'Building Context'
          | 'DeepSeek'
          | 'Verifying'
          | 'Expanding Context'
          | 'Complete'
          | 'Error'
          | 'Fallback'
          | undefined;
        if (!phase) {
          return { ok: false };
        }
        setRequestPhase(phase, req?.liveLabel);
        return { ok: true, phase };
      },
    ),
    vscode.commands.registerCommand('singularity.ai.resetTokenUsage', async () => {
      if (!tokenStore) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        'Reset local project token counters only? Server-side beta usage counters are unchanged.',
        { modal: true },
        'Reset local',
      );
      if (choice === 'Reset local') {
        tokenStore.reset();
        resetCacheStatus();
        void vscode.window.showInformationMessage('Local project token counters reset. Beta quota unchanged.');
      }
    }),
  );

  // Intelligence Shell commands register here (before router import) so the sidebar icon responds instantly.
  startBrainBridge(context, {
    getAi: () => ai,
    gatewayKey: undefined,
    gatewayUrl: undefined,
  });
  startIntelligenceDaemon(context);
  startGlobalMemoryBridge(context);

  const enabled =
    process.env.SINGULARITY_AI_ENABLED !== '0' &&
    vscode.workspace.getConfiguration('singularity.ai').get<boolean>('enabled', true);

  if (!enabled) {
    singularityLog('[singularity-ai] router disabled via settings; token status bar still active');
    return undefined;
  }

  reportIntelligenceShellProgress('Loading AI router…', 0.25);

  // Lazy-load router so tree-sitter / import.meta bundling bugs cannot block token commands.
  let createSingularityAI: typeof import('@singularity/router').createSingularityAI;
  let applySingularityBundledEnv: typeof import('@singularity/router').applySingularityBundledEnv;
  let getTokenRouterApiKey: typeof import('@singularity/router').getTokenRouterApiKey;
  let getTokenRouterBaseUrl: typeof import('@singularity/router').getTokenRouterBaseUrl;
  try {
    const router = await import('@singularity/router');
    createSingularityAI = router.createSingularityAI;
    applySingularityBundledEnv = router.applySingularityBundledEnv;
    getTokenRouterApiKey = router.getTokenRouterApiKey;
    getTokenRouterBaseUrl = router.getTokenRouterBaseUrl;
  } catch (e) {
    console.error(
      '[singularity-ai] failed to load @singularity/router — token status bar is active, routing disabled:',
      e,
    );
    return undefined;
  }

  loadDotEnvIntoProcess();
  applySingularityBundledEnv();

  reportIntelligenceShellProgress('Connecting services…', 0.45);

  const workspaceId =
    vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'default';
  const durableCacheDir = join(context.globalStorageUri.fsPath, 'ai-cache');
  const gatewayKey = await resolveGatewayApiKey(context, getTokenRouterApiKey);
  const gatewayUrl = getTokenRouterBaseUrl();

  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  if (gatewayKey) {
    await seedTokenRouterLanguageModelProvider(gatewayKey);
    void refreshTokenRouterPricing(gatewayKey, gatewayUrl);
  }

  ai = createSingularityAI({
    workspaceId,
    durableCacheDir,
    adapter: {
      localEcho: !gatewayKey,
      openrouter: gatewayKey
        ? {
            apiKey: gatewayKey,
            baseUrl: gatewayUrl,
            appName: 'Singularity',
          }
        : undefined,
    },
  });

  penpotManager = new PenpotManager(context.extensionPath);
  setSharedPenpotManager(penpotManager);

  void registerExecutionBridge(context, ai);

  // Tree-sitter is the PRIMARY symbol parser — warm WASM grammars before crawl/index
  void ai.promptEngine.indexer.ensureReady().then((ok) => {
    singularityLog(
      `[singularity-ai] Tree-sitter primary parser: ${ok ? 'ready' : 'unavailable (optional fallback may apply)'}`,
    );
  });

  reportIntelligenceShellProgress('Starting intelligence worker…', 0.65);

  // Singularity Brain — update gateway refs after router is ready.
  startBrainBridge(context, {
    getAi: () => getSingularityAI(),
    gatewayKey,
    gatewayUrl,
  });

  reportIntelligenceShellProgress('Ready', 1);
  IntelligenceShellPanel.refreshIfOpen();

  context.subscriptions.push(
    vscode.commands.registerCommand('singularity.ai.clearCache', () => {
      ai?.clearCaches();
      updateStatusBar();
      void vscode.window.showInformationMessage('Singularity AI caches cleared.');
    }),
    vscode.commands.registerCommand('singularity.ai.complete', () => runComplete()),
    vscode.commands.registerCommand('singularity.ai.promptDebug', () => {
      if (!ai) {
        void vscode.window.showWarningMessage('Singularity AI is not initialized.');
        return;
      }
      PromptDebugPanel.show(ai);
    }),
    vscode.commands.registerCommand('singularity.ai.projectContext', () => {
      openIntelligenceShell('context');
    }),
    vscode.commands.registerCommand('singularity.ai.wiki.open', () => {
      WikiPanel.show();
    }),
    vscode.commands.registerCommand('singularity.ai.wiki.init', () => {
      const result = initWiki();
      if (!result.ok) {
        void vscode.window.showWarningMessage(
          `Could not initialize LLM Wiki (${result.reason}).`,
        );
        return result;
      }
      void vscode.window.showInformationMessage(
        result.created
          ? `LLM Wiki initialized at ${result.wikiRoot}`
          : `LLM Wiki already exists at ${result.wikiRoot}`,
      );
      WikiPanel.show();
      return result;
    }),
    vscode.commands.registerCommand('singularity.ai.wiki.ingest', async () => {
      const editor = vscode.window.activeTextEditor;
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: 'Active editor file',
            description: editor?.document.fileName,
            id: 'active',
          },
          { label: 'Paste text…', id: 'paste' },
          { label: 'Pick a file…', id: 'file' },
        ],
        { placeHolder: 'Ingest into LLM Wiki' },
      );
      if (!pick) {
        return;
      }
      if (pick.id === 'active') {
        if (!editor) {
          void vscode.window.showWarningMessage('No active editor.');
          return;
        }
        const result = ingestIntoWiki({
          sourcePath: editor.document.uri.fsPath,
          title: editor.document.fileName.split(/[\\/]/).pop(),
        });
        void vscode.window.showInformationMessage(
          result.skipped
            ? `Wiki ingest skipped: ${result.reason}`
            : `Ingested — ${'pagesTouched' in result ? result.pagesTouched.length : 0} pages touched`,
        );
        WikiPanel.show();
        return result;
      }
      if (pick.id === 'paste') {
        const title = await vscode.window.showInputBox({
          prompt: 'Source title (optional)',
        });
        const text = await vscode.window.showInputBox({
          prompt: 'Paste source text to ingest',
          ignoreFocusOut: true,
        });
        if (!text) {
          return;
        }
        const result = ingestIntoWiki({ text, title: title || undefined });
        void vscode.window.showInformationMessage(
          result.skipped
            ? `Wiki ingest skipped: ${result.reason}`
            : `Ingested — ${'pagesTouched' in result ? result.pagesTouched.length : 0} pages touched`,
        );
        WikiPanel.show();
        return result;
      }
      const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Ingest into wiki',
      });
      if (!uri?.[0]) {
        return;
      }
      const result = ingestIntoWiki({
        sourcePath: uri[0].fsPath,
        title: uri[0].fsPath.split(/[\\/]/).pop(),
      });
      void vscode.window.showInformationMessage(
        result.skipped
          ? `Wiki ingest skipped: ${result.reason}`
          : `Ingested — ${'pagesTouched' in result ? result.pagesTouched.length : 0} pages touched`,
      );
      WikiPanel.show();
      return result;
    }),
    vscode.commands.registerCommand('singularity.ai.wiki.query', async () => {
      const question = await vscode.window.showInputBox({
        prompt: 'Ask the LLM Wiki',
        placeHolder: 'What do we know about…?',
      });
      if (!question) {
        return;
      }
      const result = queryWiki(question);
      const channel = vscode.window.createOutputChannel('Singularity LLM Wiki');
      channel.appendLine(result?.draft ?? 'No wiki result.');
      channel.show(true);
      WikiPanel.show();
      return result;
    }),
    vscode.commands.registerCommand('singularity.ai.wiki.lint', () => {
      const result = lintWiki();
      WikiPanel.show();
      return result;
    }),
    vscode.commands.registerCommand(
      'singularity.ai.wiki.search',
      async (req?: { query?: string; limit?: number }) => {
        const query = req?.query?.trim();
        if (!query) {
          return { ok: false };
        }
        return { ok: true, hits: searchWiki(query, req?.limit) };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.wiki.fileAnswer',
      async (req?: {
        question?: string;
        answer?: string;
        title?: string;
        citations?: string[];
      }) => {
        if (!req?.question || !req?.answer) {
          return { ok: false, reason: 'missing_question_or_answer' };
        }
        const filed = fileWikiAnswer({
          question: req.question,
          answer: req.answer,
          title: req.title,
          citations: req.citations,
        });
        return { ok: Boolean(filed), relPath: filed?.relPath };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.wiki.run',
      async (req?: {
        operation?: string;
        text?: string;
        title?: string;
        path?: string;
        url?: string;
        question?: string;
        answer?: string;
        citations?: string[];
        fileAnswer?: boolean;
        notes?: string;
        limit?: number;
      }) => {
        const op = req?.operation?.trim() || 'status';
        if (op === 'init') {
          return initWiki();
        }
        if (op === 'status') {
          return { ok: true, status: wikiStatus() };
        }
        if (op === 'ingest') {
          const result = ingestIntoWiki({
            text: req?.text,
            title: req?.title,
            sourcePath: req?.path,
            url: req?.url,
            notes: req?.notes,
          });
          return { ok: !('skipped' in result && result.skipped && !('pagesTouched' in result && result.pagesTouched.length)), ...result };
        }
        if (op === 'query') {
          const question = req?.question || req?.text;
          if (!question) {
            return { ok: false, reason: 'missing_question' };
          }
          const result = queryWiki(question, { fileAnswer: req?.fileAnswer });
          return { ok: true, ...result };
        }
        if (op === 'search') {
          const q = req?.question || req?.text;
          if (!q) {
            return { ok: false, reason: 'missing_query' };
          }
          return { ok: true, hits: searchWiki(q, req?.limit) };
        }
        if (op === 'lint') {
          return { ok: true, ...lintWiki() };
        }
        if (op === 'file') {
          if (!req?.question || !req?.answer) {
            return { ok: false, reason: 'missing_question_or_answer' };
          }
          const filed = fileWikiAnswer({
            question: req.question,
            answer: req.answer,
            title: req.title,
            citations: req.citations,
          });
          return { ok: Boolean(filed), relPath: filed?.relPath };
        }
        return { ok: false, reason: `unknown_operation:${op}` };
      },
    ),
    vscode.commands.registerCommand('singularity.ai.runtimeExecution', () => {
      openIntelligenceShell('tasks');
    }),
    vscode.commands.registerCommand('singularity.ai.context.refresh', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'Text to extract into Project Context',
        placeHolder: 'Use PostgreSQL. Do not use Firebase.',
      });
      if (!text) {
        return;
      }
      ensureContextEngine();
      // Manual UI refresh still runs LangExtract synchronously so the user sees a result.
      const result = await ingestChatMessage(text, `manual-${Date.now()}`, ai);
      if (result?.skipped) {
        void vscode.window.showInformationMessage(
          `Context Engine skipped: ${result.reason ?? 'n/a'}`,
        );
      } else {
        void vscode.window.showInformationMessage(
          `Context Engine updated (v${result?.state?.meta.version ?? '?'})`,
        );
        openIntelligenceShell('context');
      }
    }),
    vscode.commands.registerCommand('singularity.ai.context.show', () => {
      const ce = getActiveContextEngine();
      if (!ce) {
        void vscode.window.showWarningMessage(
          'Context Engine is disabled or no workspace is open.',
        );
        return;
      }
      openIntelligenceShell('context');
      return ce.counts();
    }),
    vscode.commands.registerCommand('singularity.ai.openDesignPreview', async () => {
      if (!penpotManager) {
        void vscode.window.showWarningMessage('Singularity AI is not initialized.');
        return;
      }
      await DesignPreviewPanel.show(penpotManager, { startPenpot: true });
    }),
    vscode.commands.registerCommand('singularity.ai.startPenpot', async () => {
      if (!penpotManager) {
        return;
      }
      const ok = await penpotManager.ensureStarted(true);
      void vscode.window.showInformationMessage(
        ok
          ? `Penpot is ready at ${penpotManager.url}`
          : `Penpot did not become ready. Check Docker/Podman and ${penpotManager.url}`,
      );
    }),
    vscode.commands.registerCommand('singularity.ai.stopPenpot', async () => {
      if (!penpotManager) {
        return;
      }
      try {
        await penpotManager.stop();
        void vscode.window.showInformationMessage('Penpot stopped.');
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Failed to stop Penpot: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      'singularity.ai.runDesignPreviewGate',
      async (req?: { workspaceRoot?: string; productName?: string; goal?: string; forcePreview?: boolean }) => {
        if (!penpotManager) {
          return 'skipped';
        }
        const root =
          req?.workspaceRoot ??
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
          return 'skipped';
        }
        return promptDesignPreviewGate({
          workspaceRoot: root,
          penpot: penpotManager,
          productName: req?.productName,
          goal: req?.goal,
          forcePreview: req?.forcePreview,
        });
      },
    ),
    vscode.commands.registerCommand('singularity.ai.finalizeDesign', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        return;
      }
      markDesignPreviewStatus(root, 'approved', {
        penpotUrl: penpotManager?.url ?? DEFAULT_PENPOT_URL,
      });
      void vscode.window.showInformationMessage('Final Design locked — coding unlocked.');
    }),
    vscode.commands.registerCommand(
      'singularity.ai.compilePromptContext',
      async (req?: {
        prompt?: string;
        intent?: string;
        systemPrompt?: string;
        selectionText?: string;
        activeUri?: string;
        openFiles?: string[];
        fileContent?: string;
        languageId?: string;
      }) => {
        if (!ai || !req?.prompt) {
          return { ok: false };
        }
        // Context Engine: ingest + inject for Agent / Ask / Edit / all Prompt Engine modes
        let contextSystem = '';
        try {
          const prepared = await prepareContextForPrompt(req.prompt, ai, {
            messageId: `compile-${Date.now()}`,
            intent: req.intent,
          });
          contextSystem = prepared.systemBlock ?? '';
          const intel = await intelligenceContext(req.prompt);
          if (intel.prompt_block) {
            contextSystem = contextSystem
              ? `${contextSystem}\n\n${intel.prompt_block}`
              : intel.prompt_block;
          }
          if (prepared.structuredContext) {
            for (const fact of getActiveContextEngine()?.memoryFacts() ?? []) {
              ai.promptEngine.projectMemory.upsert({
                id: `ctx-${fact.id}`,
                kind: fact.kind as
                  | 'architecture'
                  | 'preference'
                  | 'convention'
                  | 'approach'
                  | 'other',
                text: fact.text.slice(0, 400),
                updatedAt: Date.now(),
              });
            }
          }
        } catch (e) {
          singularityWarn('[singularity-ai] context prepare failed', e);
        }

        const editor = vscode.window.activeTextEditor;
        const baseSystem =
          req.systemPrompt ?? 'You are Singularity, an AI coding assistant.';
        const systemPrompt = contextSystem
          ? `${baseSystem}\n\n${contextSystem}`
          : baseSystem;

        const pe = await ai.promptEngine.run({
          sessionId: workspaceFolderKey(),
          prompt: req.prompt,
          systemPrompt,
          intent: req.intent ?? 'GENERAL',
          provider: 'openai',
          files:
            req.fileContent && req.activeUri
              ? [
                  {
                    uri: req.activeUri,
                    content: req.fileContent,
                    version: 1,
                    languageId: req.languageId,
                  },
                ]
              : editor
                ? [
                    {
                      uri: editor.document.uri.toString(),
                      content: editor.document.getText().slice(0, 80_000),
                      version: editor.document.version,
                      languageId: editor.document.languageId,
                    },
                  ]
                : undefined,
          retrieval: {
            cursorUri: req.activeUri ?? editor?.document.uri.toString(),
            selectionText: req.selectionText,
            openFileUris: req.openFiles,
          },
        });
        return {
          ok: true,
          messages: pe.rendered.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          irHash: pe.ir.irHash,
          totalTokens: pe.ir.totalTokens,
          fromCache: pe.fromCache,
          contextEngine: Boolean(contextSystem),
        };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.context.ingest',
      async (req?: { text?: string; messageId?: string; sync?: boolean }) => {
        if (!req?.text) {
          return { ok: false, skipped: true, reason: 'missing_text' };
        }
        // Default: background LangExtract agent — chat must not await extraction.
        if (!req.sync) {
          const scheduled = scheduleContextIngest(req.text, req.messageId, ai);
          return {
            ok: true,
            background: true,
            scheduled: scheduled.scheduled,
            reason: scheduled.reason,
            messageId: scheduled.messageId,
            queueDepth: scheduled.queueDepth ?? langExtractQueueDepth(),
          };
        }
        const result = await ingestChatMessage(req.text, req.messageId, ai);
        return {
          ok: true,
          skipped: result?.skipped ?? true,
          reason: result?.reason,
          version: result?.state?.meta.version,
          counts: getActiveContextEngine()?.counts(),
        };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.context.waitIngest',
      async (req?: { messageId?: string; timeoutMs?: number }) => {
        if (!req?.messageId) {
          return { ok: false, reason: 'missing_messageId' };
        }
        return waitForLangExtractJob(req.messageId, req.timeoutMs ?? 120_000);
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.intelligence.context',
      async (req?: { task?: string; query?: string }) => {
        const task = req?.task?.trim() || req?.query?.trim() || '';
        if (!task) {
          return { ok: false };
        }
        const intel = await intelligenceContext(task);
        return { ok: true, ...intel };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.intelligence.status',
      () => intelligenceStatus() ?? { ok: false },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.intelligence.symbols',
      (req?: { query?: string; limit?: number }) => {
        const q = req?.query?.trim() ?? '';
        const eng = getIntelligenceEngine();
        if (!eng) {
          return { ok: true, symbols: [] };
        }
        return eng.symbolsAsync(q, req?.limit ?? 24).then((symbols) => ({ ok: true, symbols }));
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.architecture.review',
      async (req?: { id?: string; action?: 'accept' | 'reject' | 'edit'; edit?: Record<string, unknown> }) => {
        const arch = getArchitectureSubsystem();
        if (!arch || !req?.id || !req.action) {
          return { ok: false };
        }
        const adr = arch.review(req.id, req.action, req.edit as never);
        return { ok: Boolean(adr), adr };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.outcome.review',
      async (req?: {
        id?: string;
        action?: 'start' | 'approve' | 'reject' | 'request-changes';
        reason?: string;
      }) => {
        const outcome = getOutcomeSubsystem();
        if (!outcome || !req?.id || !req.action) {
          return { ok: false };
        }
        const identity = { id: vscode.env.machineId, roles: ['senior'] };
        try {
          if (req.action === 'start') {
            const review = outcome.startReview(req.id, identity);
            return { ok: true, review };
          }
          const decision =
            req.action === 'approve' ? 'APPROVE' : req.action === 'reject' ? 'REJECT' : 'REQUEST_CHANGES';
          const result = outcome.decideReview(req.id, decision, identity, req.reason);
          return { ok: !result.error, review: result.review, error: result.error };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
    ),
    vscode.commands.registerCommand('singularity.ai.architecture.decisions', () => {
      const arch = getArchitectureSubsystem();
      return { ok: true, decisions: arch?.store.list() ?? [] };
    }),
    vscode.commands.registerCommand(
      'singularity.ai.context.relevant',
      async (req?: { task?: string; includeIntelligence?: boolean }) => {
        const task = req?.task?.trim();
        if (!task) {
          return { ok: false, engines: [] };
        }
        emitArchitectureEvent('USER_INTENT_CAPTURED', { text: task.slice(0, 4_000) });
        emitOutcomeEvent('USER_INTENT_CAPTURED', { text: task.slice(0, 4_000) });
        const payload = buildRuntimeContextPayload(task);
        const intel = req?.includeIntelligence
          ? await intelligenceContext(task)
          : { prompt_block: '' as const, intelligence: undefined };
        const prompt_block = [payload.structuredContext ?? '', intel.prompt_block]
          .filter(Boolean)
          .join('\n\n');
        let relay: Awaited<ReturnType<typeof resolveNeuralRelay>>;
        try {
          relay = await resolveNeuralRelay(task);
        } catch (err) {
          singularityWarn('[singularity-ai] Neural Relay failed; using DeepSeek fallback', err);
          relay = undefined;
        }
        const structured =
          relay?.promptBlock
            ? [prompt_block, relay.promptBlock].filter(Boolean).join('\n\n')
            : prompt_block || payload.structuredContext;
        if (relay?.experiment) {
          const nIn = relay.experiment.tokens.nemotron_input_tokens;
          const nOut = relay.experiment.tokens.nemotron_output_tokens;
          void vscode.commands.executeCommand('singularity.ai.recordRelay', {
            inputTokens: nIn,
            outputTokens: nOut,
            modelId: relay.experiment.context_model,
          });
        }
        return {
          ok: true,
          ...payload,
          prompt_block: structured,
          structuredContext: structured,
          intelligence: intel.intelligence,
          neuralRelay: relay
            ? {
                enabled: relay.enabled,
                usedRelay: relay.usedRelay,
                experiment: relay.experiment,
                files: relay.built?.filesUsed ?? [],
              }
            : undefined,
          engines: uniqueEngines([
            ...(payload.engines ?? []),
            req?.includeIntelligence ? ENGINE.intelligence : undefined,
            relay?.usedRelay ? ENGINE.neuralRelay : undefined,
          ]),
        };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.runRuntime',
      async (req?: RunRuntimeRequest) => {
        if (!isMultiAgentEnabled()) {
          return {
            ok: false,
            summary: 'Multi-agent Runtime is disabled. Use Agent mode for sequential coding.',
            error: 'multi-agent-disabled',
            appliedPaths: [],
            events: [],
          };
        }
        if (!ai) {
          return {
            ok: false,
            summary: 'Singularity AI is not initialized',
            error: 'Singularity AI is not initialized',
            appliedPaths: [],
            events: [],
          };
        }
        if (!req?.goal) {
          return {
            ok: false,
            summary: 'Missing goal',
            error: 'Missing goal',
            appliedPaths: [],
            events: [],
          };
        }
        // Always attach Context Engine payload for Agent tool + DAG callers
        let enriched: RunRuntimeRequest = { ...req };
        try {
          const prepared = await prepareContextForPrompt(req.goal, ai, {
            messageId: `runtime-${Date.now()}`,
            intent: 'runtime',
          });
          enriched = {
            ...req,
            projectSummary: req.projectSummary ?? prepared.projectSummary,
            structuredContext:
              req.structuredContext ?? prepared.structuredContext,
            verificationChecklist:
              req.verificationChecklist ?? prepared.verificationChecklist,
          };
        } catch (e) {
          singularityWarn('[singularity-ai] runtime context prepare failed', e);
        }
        const channel = vscode.window.createOutputChannel('Singularity Runtime');
        channel.appendLine(`[runtime] goal=${enriched.goal}`);
        channel.show(true);
        openIntelligenceShell('tasks');
        const result = await runRuntimeInIde(ai, enriched, (ev) => {
          channel.appendLine(`[${ev.kind}] ${ev.message}`);
          IntelligenceShellPanel.handleRuntimeEvent(ev);
        }, undefined, (snap) => {
          IntelligenceShellPanel.handleRuntimeEvent({
            kind: 'workflow_progress',
            ts: Date.now(),
            message: snap.progress.label,
            data: { snapshot: snap },
          });
        });
        if (result.usage && tokenStore) {
          try {
            tokenStore.record({
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              cachedInputTokens: result.usage.cachedTokens,
              modelId: result.usage.model,
            });
          } catch {
            /* accounting best-effort */
          }
        }
        return result;
      },
    ),
    registerRuntimeChatParticipant(context, () => ai),
    // Level 1 — incremental indexer hooks
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void indexDocument(doc);
      notifyIntelligenceFile('FILE_MODIFIED', doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file') {
        return;
      }
      if (indexTimer) {
        clearTimeout(indexTimer);
      }
      indexTimer = setTimeout(() => {
        void indexDocument(e.document);
        notifyIntelligenceFile('FILE_MODIFIED', e.document);
      }, 750);
    }),
    vscode.workspace.onDidCreateFiles((e) => {
      for (const uri of e.files) {
        void vscode.workspace.openTextDocument(uri).then((doc) => {
          notifyIntelligenceFile('FILE_CREATED', doc);
        }, () => undefined);
      }
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      for (const uri of e.files) {
        notifyIntelligenceUriDeleted(uri);
        emitArchitectureEvent('FILE_DELETED', { changed_files: [uri.fsPath] });
        emitOutcomeEvent('FILE_DELETED', { changed_files: [uri.fsPath] });
      }
    }),
    { dispose: () => indexTimer && clearTimeout(indexTimer) },
  );

  // Seed active editor into the graph
  const active = vscode.window.activeTextEditor?.document;
  if (active) {
    void indexDocument(active);
  }

  // Background repo-map crawl (Context Economy Phase 2)
  void crawlWorkspaceIntoRepoMap();

  singularityLog(
    '[singularity-ai] Prompt Engine v2 + Runtime v4 + Context Economy ready',
    ai.status(),
    tokenStore.snapshot,
    gatewayKey ? `gateway=${gatewayUrl}` : 'gateway=unset',
  );

  const api: SingularityAiApi = {
    runRuntime: (
      req: RunRuntimeRequest & { signal?: AbortSignal },
      onEvent?: (ev: RuntimeEvent) => void,
      onWorkflowSnapshot?: (payload: unknown) => void,
    ) => {
      if (!ai) {
        return Promise.resolve({
          ok: false,
          summary: 'Singularity AI is not initialized',
          error: 'Singularity AI is not initialized',
          appliedPaths: [],
          events: [],
        });
      }
      return runRuntimeInIde(
        ai,
        req,
        onEvent as ((ev: RuntimeEvent) => void) | undefined,
        undefined,
        onWorkflowSnapshot
          ? (snap) => {
              const payload = {
                id: `agent-team-${snap.workflow.workflowId}`,
                workflowId: snap.workflow.workflowId,
                mission: snap.workflow.goal,
                expanded: false,
                summary: {
                  total: snap.progress.totalTasks,
                  completed: snap.progress.completedTasks,
                  working: snap.progress.runningTasks,
                  queued: snap.progress.queuedTasks,
                  blocked: snap.progress.blockedTasks,
                  failed: snap.progress.failedTasks,
                  percent: snap.progress.percent,
                  phaseLabel: snap.progress.label,
                },
                agents: snap.agents.map((a) => ({
                  agentId: a.agentId,
                  taskId: a.taskId,
                  role: a.role,
                  title: a.title,
                  deliverable: a.deliverable,
                  status: a.status,
                  progressLabel: a.progressLabel,
                  progressPercent: a.progressPercent,
                  model: a.model,
                  activity: a.activity,
                  blockedBy: a.blockedBy,
                })),
                verificationPhase: snap.workflow.phase === 'verifying',
              };
              onWorkflowSnapshot(payload);
            }
          : undefined,
      );
    },
  };
  return api;
}

async function indexDocument(doc: vscode.TextDocument): Promise<void> {
  if (!ai || doc.uri.scheme !== 'file') {
    return;
  }
  const text = doc.getText();
  if (text.length > 400_000) {
    return;
  }
  try {
    await ai.promptEngine.indexFiles([
      {
        uri: doc.uri.toString(),
        content: text,
        version: doc.version,
        languageId: doc.languageId,
      },
    ]);
  } catch (e) {
    singularityWarn('[singularity-ai] index failed', e);
  }
}

/** Index up to 200 workspace source files into the durable Repo Map. */
async function crawlWorkspaceIntoRepoMap(): Promise<void> {
  if (!ai) {
    return;
  }
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const pattern = new vscode.RelativePattern(
      folder,
      '**/*.{ts,tsx,js,jsx,py}',
    );
    const uris = await vscode.workspace.findFiles(
      pattern,
      '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.next/**}',
      200,
    );
    const batch: Array<{
      uri: string;
      content: string;
      version: number;
      languageId: string;
    }> = [];
    for (const uri of uris) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder().decode(data);
        if (text.length > 80_000) {
          continue;
        }
        const lang = uri.path.endsWith('.py')
          ? 'python'
          : uri.path.endsWith('x')
            ? 'typescriptreact'
            : 'typescript';
        batch.push({
          uri: uri.toString(),
          content: text,
          version: 1,
          languageId: lang,
        });
      } catch {
        /* skip unreadable */
      }
    }
    if (batch.length) {
      await ai.promptEngine.indexFiles(batch);
    }
    const n = batch.length;
    singularityLog(`[singularity-ai] Repo Map crawl indexed ${n} files`);
  } catch (e) {
    singularityWarn('[singularity-ai] Repo Map crawl failed', e);
  }
}

export function deactivate(): void {
  disposeBrainBridge();
  disposeIntelligenceDaemon();
  disposeContextEngine();
  disposeWikiEngine();
  ai = undefined;
  tokenStore = undefined;
  cobuildService = undefined;
  cobuildStatusItem = undefined;
}

/** @internal exported for tests / singularity bridge */
export function getSingularityAI(): SingularityAI | undefined {
  return ai;
}


/** Load repo-root `.env` into process.env if present (dev launches). */
function loadDotEnvIntoProcess(): void {
  const candidates = [
    process.env.SINGULARITY_ROOT,
    join(__dirname, '..', '..', '..', '..'),
    join(__dirname, '..', '..', '..', '..', '..'),
  ].filter(Boolean) as string[];

  for (const root of candidates) {
    const envPath = join(root, '.env');
    if (!existsSync(envPath)) {
      continue;
    }
    try {
      const text = readFileSync(envPath, 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }
        const eq = trimmed.indexOf('=');
        if (eq <= 0) {
          continue;
        }
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      singularityLog(`[singularity-ai] loaded env from ${envPath}`);
      return;
    } catch (e) {
      singularityWarn('[singularity-ai] failed to read .env', e);
    }
  }
}

async function resolveGatewayApiKey(
  context: vscode.ExtensionContext,
  getTokenRouterApiKey: () => string | undefined,
): Promise<string | undefined> {
  const { applySingularityBundledEnv, ensureFreshTokenRouterApiKey } = await import('@singularity/router');
  applySingularityBundledEnv();
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim()
    || (await ensureFreshTokenRouterApiKey())
    || getTokenRouterApiKey();
  if (fromEnv) {
    await context.secrets.store(SECRET_GATEWAY_KEY, fromEnv);
    return fromEnv;
  }
  return (await context.secrets.get(SECRET_GATEWAY_KEY)) || undefined;
}

/**
 * Register / refresh TokenRouter LM provider so Auto + model picker can use it.
 */
async function seedTokenRouterLanguageModelProvider(apiKey: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
      vendor: 'tokenrouter',
      name: 'TokenRouter',
      apiKey,
    });
    singularityLog('[singularity-ai] seeded TokenRouter language model provider');
  } catch (e) {
    singularityWarn(
      '[singularity-ai] could not seed TokenRouter LM provider:',
      e instanceof Error ? e.message : e,
    );
  }
}

/** Pull live $/1M rates from TokenRouter `/models` when the API exposes them. */
async function refreshTokenRouterPricing(apiKey: string, baseUrl: string): Promise<void> {
  try {
    const { getTokenRouterRequestHeaders } = await import('@singularity/router');
    const url = `${baseUrl.replace(/\/$/, '')}/models`;
    const res = await fetch(url, {
      headers: getTokenRouterRequestHeaders(apiKey),
    });
    if (!res.ok) {
      singularityWarn(`[singularity-ai] pricing refresh HTTP ${res.status}`);
      return;
    }
    const json = await res.json();
    const n = ingestModelsPricingPayload(json);
    if (n > 0) {
      singularityLog(`[singularity-ai] ingested ${n} live TokenRouter model prices`);
      updateStatusBar();
    }
  } catch (e) {
    singularityWarn(
      '[singularity-ai] pricing refresh failed:',
      e instanceof Error ? e.message : e,
    );
  }
}

let lastBetaQuota:
  | {
      emailRemaining: number;
      deviceRemaining: number;
      emailLimit: number;
      deviceLimit: number;
    }
  | undefined;

function updateStatusBar(): void {
  if (!statusItem || !tokenStore) {
    return;
  }
  const usage = tokenStore.snapshot;
  const folder = vscode.workspace.workspaceFolders?.[0]?.name ?? 'this project';
  statusItem.text = formatUsageStatusText(usage, lastBetaQuota);
  statusItem.tooltip = formatUsageTooltip(usage, folder, lastBetaQuota);
  void refreshBetaQuota();
}

function updateCobuildStatusBar(): void {
  if (!cobuildStatusItem || !cobuildService) {
    return;
  }
  const text = formatCobuildStatusText(cobuildService);
  if (!text) {
    cobuildStatusItem.hide();
    return;
  }
  cobuildStatusItem.text = text;
  cobuildStatusItem.tooltip = formatCobuildStatusTooltip(cobuildService);
  cobuildStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  cobuildStatusItem.show();
}

async function refreshBetaQuota(): Promise<void> {
  try {
    const { fetchBetaQuota } = await import('@singularity/router');
    const q = await fetchBetaQuota();
    if (!q) {
      return;
    }
    lastBetaQuota = {
      emailRemaining: q.emailRemaining,
      deviceRemaining: q.deviceRemaining,
      emailLimit: q.emailLimit,
      deviceLimit: q.deviceLimit,
    };
    if (statusItem && tokenStore) {
      const usage = tokenStore.snapshot;
      const folder = vscode.workspace.workspaceFolders?.[0]?.name ?? 'this project';
      statusItem.text = formatUsageStatusText(usage, lastBetaQuota);
      statusItem.tooltip = formatUsageTooltip(usage, folder, lastBetaQuota);
    }
  } catch {
    /* router may not export yet in older builds */
  }
}

function showStatus(): void {
  if (!tokenStore) {
    void vscode.window.showWarningMessage('Singularity AI is not initialized.');
    return;
  }
  const usage = tokenStore.snapshot;
  const total = usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
  const beta = lastBetaQuota
    ? ` · beta left email ${lastBetaQuota.emailRemaining.toLocaleString()} / device ${lastBetaQuota.deviceRemaining.toLocaleString()}`
    : '';
  void vscode.window.showInformationMessage(
    `Spent ${formatUsd(usage.spentUsd)} · input (cache miss) ${usage.inputTokens.toLocaleString()} (${formatUsd(usage.inputSpentUsd)}) · output ${usage.outputTokens.toLocaleString()} (${formatUsd(usage.outputSpentUsd)}) · cache ${usage.cachedInputTokens.toLocaleString()} (${formatUsd(usage.cacheSpentUsd)}) · total ${total.toLocaleString()}${beta}`,
  );
}

function showPerfTraces(): void {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const tracePath = root
    ? join(root, '.singularity', 'traces', 'requests.jsonl')
    : undefined;
  if (!tracePath || !existsSync(tracePath)) {
    void vscode.window.showInformationMessage(
      'No perf traces yet. Traces appear after the next request (timings only, no prompt content).',
    );
    return;
  }
  const channel =
    perfTraceChannel ?? vscode.window.createOutputChannel('Singularity Perf Traces');
  perfTraceChannel = channel;
  channel.clear();
  try {
    const lines = readFileSync(tracePath, 'utf8').trim().split('\n');
    const tail = lines.slice(-50);
    for (const line of tail) {
      try {
        const rec = JSON.parse(line) as {
          requestId: string;
          source?: string;
          modelId?: string;
          ttftMs?: number;
          totalRequestMs?: number;
          completionTokens?: number;
          modelTps?: number;
          effectiveTps?: number;
          routingLatencyMs?: number;
          planningLatencyMs?: number;
          contextLatencyMs?: number;
          verificationLatencyMs?: number;
        };
        const parts = [
          rec.requestId,
          rec.source ?? '',
          rec.modelId ?? '',
          `ttft=${rec.ttftMs ?? '—'}ms`,
          `total=${rec.totalRequestMs ?? '—'}ms`,
          `out=${rec.completionTokens ?? '—'}tok`,
          `tps=${rec.modelTps ? rec.modelTps.toFixed(1) : '—'}`,
          `effTps=${rec.effectiveTps ? rec.effectiveTps.toFixed(1) : '—'}`,
          `route=${rec.routingLatencyMs ?? '—'}ms`,
          `plan=${rec.planningLatencyMs ?? '—'}ms`,
          `ctx=${rec.contextLatencyMs ?? '—'}ms`,
          `verify=${rec.verificationLatencyMs ?? '—'}ms`,
        ];
        channel.appendLine(parts.filter(Boolean).join(' | '));
      } catch {
        /* skip malformed trace lines */
      }
    }
  } catch (err) {
    channel.appendLine(
      `Failed to read traces: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  channel.show(true);
}

async function runComplete(): Promise<void> {
  if (!ai) {
    void vscode.window.showWarningMessage('Singularity AI is not initialized.');
    return;
  }

  const prompt = await vscode.window.showInputBox({
    prompt: 'Prompt for routed + cached completion (OpenRouter)',
    placeHolder: 'Explain how authentication works in this project',
  });
  if (!prompt) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const selection = editor?.selection;
  const selectedText =
    editor && selection && !selection.isEmpty
      ? editor.document.getText(selection)
      : undefined;

  const diagnostics = editor
    ? vscode.languages.getDiagnostics(editor.document.uri).slice(0, 40).map((d) => ({
        uri: editor.document.uri.toString(),
        severity:
          d.severity === vscode.DiagnosticSeverity.Error
            ? ('error' as const)
            : d.severity === vscode.DiagnosticSeverity.Warning
              ? ('warning' as const)
              : d.severity === vscode.DiagnosticSeverity.Information
                ? ('info' as const)
                : ('hint' as const),
        message: d.message,
        line: d.range.start.line + 1,
        source: d.source,
      }))
    : [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Singularity AI…',
      cancellable: false,
    },
    async () => {
      let enrichedPrompt = prompt;
      try {
        const prepared = await prepareContextForPrompt(prompt, ai, {
          messageId: `complete-${Date.now()}`,
          intent: 'complete',
        });
        if (prepared.systemBlock) {
          enrichedPrompt = `${prepared.systemBlock}\n\nUser request:\n${prompt}`;
        }
      } catch {
        /* continue without context */
      }

      const result = await ai!.complete({
        prompt: enrichedPrompt,
        mode: 'chat',
        cacheable: true,
        temperature: 0,
        language: editor?.document.languageId,
        openFileCount: vscode.window.visibleTextEditors.length,
        sessionId: workspaceFolderKey(),
        context: {
          openFiles: vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()),
          activeUri: editor?.document.uri.toString(),
          settingsVersion: '1',
          branch: 'main',
          workspaceId: workspaceFolderKey(),
        },
        builderUpdate: {
          currentFileUri: editor?.document.uri.toString(),
          files: editor
            ? [
                {
                  uri: editor.document.uri.toString(),
                  content: editor.document.getText().slice(0, 80_000),
                  version: editor.document.version,
                  languageId: editor.document.languageId,
                },
              ]
            : undefined,
          selection:
            selectedText && editor && selection
              ? {
                  uri: editor.document.uri.toString(),
                  text: selectedText.slice(0, 16_000),
                  startLine: selection.start.line + 1,
                  endLine: selection.end.line + 1,
                  languageId: editor.document.languageId,
                }
              : undefined,
          diagnostics,
        },
      });

      const usage = result.result.usage;
      if (result.fromCache) {
        tokenStore?.record({
          cachedInputTokens: usage?.promptTokens ?? Math.ceil(prompt.length / 4),
          outputTokens: usage?.completionTokens ?? 0,
        });
      } else {
        const promptTotal = usage?.promptTokens ?? Math.ceil(prompt.length / 4);
        const cached = usage?.cachedPromptTokens ?? 0;
        const split = normalizePromptUsage(promptTotal, cached);
        tokenStore?.record({
          inputTokens: split.inputTokens,
          cachedInputTokens: split.cachedInputTokens,
          outputTokens:
            usage?.completionTokens ??
            Math.ceil((result.result.choices[0]?.message.content?.length ?? 0) / 4),
          modelId: result.decision.model.id,
          cacheReported: usage?.cachedPromptTokens !== undefined,
        });
        recordDeepSeekProviderUsage({
          modelId: result.decision.model.id,
          promptTokens: promptTotal,
          outputTokens:
            usage?.completionTokens ??
            Math.ceil((result.result.choices[0]?.message.content?.length ?? 0) / 4),
          cacheReadTokens: cached,
          cacheReported: usage?.cachedPromptTokens !== undefined,
        });
      }

      updateStatusBar();
      const text = result.result.choices[0]?.message.content ?? '';
      const channel = vscode.window.createOutputChannel('Singularity AI');
      const promptInfo = result.prompt
        ? ` ir=${result.prompt.irHash.slice(0, 8)} tokens≈${result.prompt.totalTokens}${result.prompt.fromIrCache ? ' (ir-cache)' : ''}`
        : '';
      channel.appendLine(
        `[${result.fromCache ? `cache:${result.cacheLayer}` : 'openrouter'}] model=${result.decision.model.id} intent=${result.decision.intent}${promptInfo}`,
      );
      if (result.economy) {
        const { formatEconomyMarkdown } = await import('@singularity/router');
        channel.appendLine(formatEconomyMarkdown(result.economy));
      }
      channel.appendLine(text);
      channel.show(true);
    },
  );
}
