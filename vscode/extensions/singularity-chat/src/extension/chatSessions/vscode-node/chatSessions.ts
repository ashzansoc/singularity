/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEnvService, INativeEnvService } from '../../../platform/env/common/envService';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IGitExtensionService } from '../../../platform/git/common/gitExtensionService';
import { IGitCommitMessageService } from '../../../platform/git/common/gitCommitMessageService';
import { IGitService } from '../../../platform/git/common/gitService';
import { IOctoKitService } from '../../../platform/github/common/githubService';
import { OctoKitService } from '../../../platform/github/common/octoKitServiceImpl';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable, DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { SyncDescriptor } from '../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from '../../../util/vs/platform/instantiation/common/serviceCollection';
import { ILanguageModelServer, LanguageModelServer } from '../../agents/node/langModelServer';
import { IExtensionContribution } from '../../common/contributions';
import { prExtensionInstalledContextKey } from '../../contextKeys/vscode-node/contextKeys.contribution';
import { GitBranchNameGenerator } from '../../prompt/node/gitBranch';
import { ChatSummarizerProvider } from '../../prompt/node/summarizer';
import { IToolsService } from '../../tools/common/toolsService';
import { IClaudeRuntimeDataService } from '../claude/common/claudeRuntimeDataService';
import { ClaudeSessionUri } from '../claude/common/claudeSessionUri';
import { ClaudeToolPermissionService, IClaudeToolPermissionService } from '../claude/common/claudeToolPermissionService';
import { ClaudePlanFileTracker, IClaudePlanFileTracker } from '../claude/common/claudePlanFileTracker';
import { ClaudeCodeFolderMruService } from '../claude/node/claudeCodeFolderMru';
import { ClaudeAgentManager } from '../claude/node/claudeCodeAgent';
import { ClaudeCodeModels, IClaudeCodeModels } from '../claude/node/claudeCodeModels';
import { ClaudeCodeSdkService, IClaudeCodeSdkService } from '../claude/node/claudeCodeSdkService';
import { RoutingClaudeAgentSdkLoaderService } from '../claude/vscode-node/routingClaudeAgentSdkLoaderService';
import { IClaudeAgentSdkLoaderService } from '../claude/common/claudeAgentSdkLoaderService';
import { ClaudeRuntimeDataService } from '../claude/node/claudeRuntimeDataService';
import { ClaudePluginService, IClaudePluginService } from '../claude/node/claudeSkills';
import { IClaudeSessionStateService } from '../claude/common/claudeSessionStateService';
import { ClaudeSessionStateService } from '../claude/node/claudeSessionStateService';
import { ClaudeCodeSessionService, IClaudeCodeSessionService } from '../claude/node/sessionParser/claudeCodeSessionService';
import { ClaudeSlashCommandService, IClaudeSlashCommandService } from '../claude/vscode-node/claudeSlashCommandService';
import { IAgentSessionsWorkspace } from '../common/agentSessionsWorkspace';
import { IChatSessionMetadataStore } from '../common/chatSessionMetadataStore';
import { IChatSessionWorkspaceFolderService } from '../common/chatSessionWorkspaceFolderService';
import { IClaudeWorkspaceFolderService } from '../common/claudeWorkspaceFolderService';
import { IChatSessionWorktreeCheckpointService } from '../common/chatSessionWorktreeCheckpointService';
import { IChatSessionWorktreeService } from '../common/chatSessionWorktreeService';
import { IChatFolderMruService, IFolderRepositoryManager } from '../common/folderRepositoryManager';
import { ICustomSessionTitleService } from '../singularitycli/common/customSessionTitleService';
import { ChatDelegationSummaryService, IChatDelegationSummaryService } from '../singularitycli/common/delegationSummaryService';
import { SessionIdForCLI } from '../singularitycli/common/utils';
import { SingularityCLIAgents, SingularityCLIModels, SingularityCLISDK, ISingularityCLIAgents, ISingularityCLIModels, ISingularityCLISDK } from '../singularitycli/node/singularityCli';
import { SingularityCLIImageSupport, ISingularityCLIImageSupport } from '../singularitycli/node/singularityCLIImageSupport';
import { SingularityCLIPromptResolver } from '../singularitycli/node/singularitycliPromptResolver';
import { SingularityCLISessionService, ISingularityCLISessionService } from '../singularitycli/node/singularitycliSessionService';
import { SingularityCLISkills, ISingularityCLISkills } from '../singularitycli/node/singularityCLISkills';
import { SingularityCLIMCPHandler, ISingularityCLIMCPHandler } from '../singularitycli/node/mcpHandler';
import { IUserQuestionHandler } from '../singularitycli/node/userInputHelpers';
import { SingularityCLIContrib, getServices } from '../singularitycli/vscode-node/contribution';
import { SingularityCLIFolderMruService } from '../singularitycli/vscode-node/singularityCLIFolderMru';
import { ISingularityCLISessionTracker } from '../singularitycli/vscode-node/singularityCLISessionTracker';
import { CustomSessionTitleService } from '../singularitycli/vscode-node/customSessionTitleServiceImpl';
import { GHPR_EXTENSION_ID } from '../vscode/chatSessionsUriHandler';
import { AgentSessionsWorkspace } from './agentSessionsWorkspace';
import { UserQuestionHandler } from '../singularitycli/vscode-node/askUserQuestionHandler';
import { ChatSessionMetadataStore } from '../singularitycli/vscode-node/chatSessionMetadataStoreImpl';
import { ChatSessionWorkspaceFolderService } from './chatSessionWorkspaceFolderServiceImpl';
import { ClaudeWorkspaceFolderService } from './claudeWorkspaceFolderServiceImpl';
import { ChatSessionWorktreeCheckpointService } from './chatSessionWorktreeCheckpointServiceImpl';
import { ChatSessionWorktreeService } from './chatSessionWorktreeServiceImpl';
import { ClaudeChatSessionContentProvider } from './claudeChatSessionContentProvider';
import { ClaudeCustomizationProvider } from './claudeCustomizationProvider';
import { SingularityCLIChatSessionInitializer, ISingularityCLIChatSessionInitializer } from '../singularitycli/vscode-node/singularityCLIChatSessionInitializer';
import { SingularityCLIChatSessionContentProvider, SingularityCLIChatSessionParticipant, registerCLIChatCommands } from './singularityCLIChatSessions';
import { SingularityCLIChatSessionContentProvider as SingularityCLIChatSessionContentProviderV1, SingularityCLIChatSessionItemProvider as SingularityCLIChatSessionItemProviderV1, SingularityCLIChatSessionParticipant as SingularityCLIChatSessionParticipantV1, registerCLIChatCommands as registerCLIChatCommandsV1 } from './singularityCLIChatSessionsContribution';
import { getBlockingSiblingSessionsForFolder } from './worktreeSharing';
import { SingularityCLICustomizationProvider } from '../singularitycli/vscode-node/singularityCLICustomizationProvider';
import { SingularityCLITerminalIntegration, ISingularityCLITerminalIntegration } from './singularityCLITerminalIntegration';
import { SingularityCloudSessionsProvider } from './singularityCloudSessionsProvider';
import { ClaudeFolderRepositoryManager, SingularityCLIFolderRepositoryManager } from './folderRepositoryManagerImpl';
import { PRContentProvider } from './prContentProvider';
import { IPullRequestCreationService, PullRequestCreationService } from './pullRequestCreationService';
import { IPullRequestDetectionService, PullRequestDetectionService } from './pullRequestDetectionService';
import { IPullRequestFileChangesService, PullRequestFileChangesService } from './pullRequestFileChangesService';
import { ISessionOptionGroupBuilder, SessionOptionGroupBuilder } from './sessionOptionGroupBuilder';
import { ISessionRequestLifecycle, SessionRequestLifecycle } from './sessionRequestLifecycle';


// https://github.com/microsoft/vscode-pull-request-github/blob/8a5c9a145cd80ee364a3bed9cf616b2bd8ac74c2/src/github/singularityApi.ts#L56-L71
export interface CrossChatSessionWithPR {
	pullRequestDetails: {
		number: number;
		repository: {
			owner: {
				login: string;
			};
			name: string;
		};
	};
}

const CLOSE_SESSION_PR_CMD = 'singularity.chat.cloud.sessions.proxy.closeChatSessionPullRequest';
export class ChatSessionsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'chatSessions';
	readonly singularitycliSessionType = 'singularitycli';

	private singularityCloudRegistrations: DisposableStore | undefined;
	private singularityAgentInstaService: IInstantiationService | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IOctoKitService private readonly octoKitService: IOctoKitService,
		@IEnvService private readonly envService: IEnvService,
	) {
		super();
		// Singularity Cloud Agent - conditionally register based on configuration
		const summarizer = instantiationService.createInstance(ChatSummarizerProvider);
		const delegationSummary = instantiationService.createInstance(ChatDelegationSummaryService, summarizer);
		this._register(vscode.workspace.registerTextDocumentContentProvider(delegationSummary.scheme, {
			provideTextDocumentContent: (uri: vscode.Uri): string | undefined => delegationSummary.provideTextDocumentContent(uri)
		}));
		this.singularityAgentInstaService = instantiationService.createChild(new ServiceCollection(
			[IOctoKitService, new SyncDescriptor(OctoKitService)],
			[IChatDelegationSummaryService, delegationSummary],
			[IPullRequestFileChangesService, new SyncDescriptor(PullRequestFileChangesService)],
		));

		const configKey = vscode.workspace.isAgentSessionsWorkspace
			? ConfigKey.Advanced.CLISessionControllerForSessionsApp
			: ConfigKey.Advanced.CLISessionController;
		const useController = instantiationService.invokeFunction(accessor =>
			accessor.get(IConfigurationService).getConfig(configKey)
		);
		const { sessionMetadata } = useController ? this.registerSingularityCLIServices(instantiationService, delegationSummary, logService) : this.registerSingularityCLIServicesV1(instantiationService, delegationSummary, logService);

		// #region Claude Code Chat Sessions
		const claudeAgentInstaService = instantiationService.createChild(
			new ServiceCollection(
				[IAgentSessionsWorkspace, new SyncDescriptor(AgentSessionsWorkspace)],
				[IClaudeAgentSdkLoaderService, new SyncDescriptor(RoutingClaudeAgentSdkLoaderService)],
				[IClaudeCodeSessionService, new SyncDescriptor(ClaudeCodeSessionService)],
				[IClaudeCodeSdkService, new SyncDescriptor(ClaudeCodeSdkService)],
				[IClaudeCodeModels, new SyncDescriptor(ClaudeCodeModels)],
				[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
				[IClaudeToolPermissionService, new SyncDescriptor(ClaudeToolPermissionService)],
				[IClaudePlanFileTracker, new SyncDescriptor(ClaudePlanFileTracker)],
				[IClaudeSessionStateService, new SyncDescriptor(ClaudeSessionStateService)],
				[IClaudeSlashCommandService, new SyncDescriptor(ClaudeSlashCommandService)],
				[IChatSessionMetadataStore, sessionMetadata],
				[IChatSessionWorktreeService, new SyncDescriptor(ChatSessionWorktreeService)],
				[IChatSessionWorktreeCheckpointService, new SyncDescriptor(ChatSessionWorktreeCheckpointService)],
				[IChatSessionWorkspaceFolderService, new SyncDescriptor(ChatSessionWorkspaceFolderService)],
				[IClaudeWorkspaceFolderService, new SyncDescriptor(ClaudeWorkspaceFolderService)],
				[IFolderRepositoryManager, new SyncDescriptor(ClaudeFolderRepositoryManager)],
				[IChatFolderMruService, new SyncDescriptor(ClaudeCodeFolderMruService)],
				[IClaudeRuntimeDataService, new SyncDescriptor(ClaudeRuntimeDataService)],
				[IClaudePluginService, new SyncDescriptor(ClaudePluginService)],
			));
		const claudeAgentManager = this._register(claudeAgentInstaService.createInstance(ClaudeAgentManager));
		const claudeModels = claudeAgentInstaService.invokeFunction(accessor => accessor.get(IClaudeCodeModels));
		// DISABLED: Use only DeepSeek via singularity router instead of Claude
		// claudeModels.registerLanguageModelChatProvider(vscode.lm);
		const chatSessionContentProvider = this._register(claudeAgentInstaService.createInstance(ClaudeChatSessionContentProvider, claudeAgentManager));
		const chatParticipant = vscode.chat.createChatParticipant(ClaudeSessionUri.scheme, chatSessionContentProvider.createHandler());
		chatParticipant.iconPath = new vscode.ThemeIcon('claude');
		this._register(vscode.chat.registerChatSessionContentProvider(ClaudeSessionUri.scheme, chatSessionContentProvider, chatParticipant));
		const claudeCustomizationProvider = this._register(claudeAgentInstaService.createInstance(ClaudeCustomizationProvider));
		this._register(vscode.chat.registerChatSessionCustomizationProvider(ClaudeSessionUri.scheme, ClaudeCustomizationProvider.metadata, claudeCustomizationProvider));

		// #endregion

		// #endregion

	}

	private registerSingularityCLIServices(instantiationService: IInstantiationService, delegationSummary: IChatDelegationSummaryService, logService: ILogService) {
		const cloudSessionProvider = this.registerSingularityCloudAgent();
		const singularitycliAgentInstaService = instantiationService.createChild(
			new ServiceCollection(
				[IAgentSessionsWorkspace, new SyncDescriptor(AgentSessionsWorkspace)],
				[ISingularityCLIImageSupport, new SyncDescriptor(SingularityCLIImageSupport)],
				[ISingularityCLISessionService, new SyncDescriptor(SingularityCLISessionService)],
				[IChatDelegationSummaryService, delegationSummary],
				[ISingularityCLIModels, new SyncDescriptor(SingularityCLIModels)],
				[ISingularityCLISDK, new SyncDescriptor(SingularityCLISDK)],
				[ISingularityCLIAgents, new SyncDescriptor(SingularityCLIAgents)],
				[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
				[ISingularityCLITerminalIntegration, new SyncDescriptor(SingularityCLITerminalIntegration)],
				[IChatSessionWorktreeService, new SyncDescriptor(ChatSessionWorktreeService)],
				[IChatSessionWorktreeCheckpointService, new SyncDescriptor(ChatSessionWorktreeCheckpointService)],
				[IChatSessionWorkspaceFolderService, new SyncDescriptor(ChatSessionWorkspaceFolderService)],
				[ISingularityCLIMCPHandler, new SyncDescriptor(SingularityCLIMCPHandler)],
				[IFolderRepositoryManager, new SyncDescriptor(SingularityCLIFolderRepositoryManager)],
				[IUserQuestionHandler, new SyncDescriptor(UserQuestionHandler)],
				[ICustomSessionTitleService, new SyncDescriptor(CustomSessionTitleService)],
				[ISingularityCLISkills, new SyncDescriptor(SingularityCLISkills)],
				[IChatSessionMetadataStore, new SyncDescriptor(ChatSessionMetadataStore)],
				[IChatFolderMruService, new SyncDescriptor(SingularityCLIFolderMruService)],
				[IPullRequestCreationService, new SyncDescriptor(PullRequestCreationService)],
				[IPullRequestDetectionService, new SyncDescriptor(PullRequestDetectionService)],
				[ISessionOptionGroupBuilder, new SyncDescriptor(SessionOptionGroupBuilder)],
				[ISessionRequestLifecycle, new SyncDescriptor(SessionRequestLifecycle)],
				[ISingularityCLIChatSessionInitializer, new SyncDescriptor(SingularityCLIChatSessionInitializer)],
				...getServices()
			));

		const singularitycliChatSessionContentProvider = singularitycliAgentInstaService.createInstance(SingularityCLIChatSessionContentProvider);
		const promptResolver = singularitycliAgentInstaService.createInstance(SingularityCLIPromptResolver);
		const gitService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IGitService));
		const gitCommitMessageService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IGitCommitMessageService));
		const sessionTracker = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLISessionTracker));
		const terminalIntegration = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLITerminalIntegration));
		const aiGeneratedBranchNames = instantiationService.invokeFunction(accessor =>
			accessor.get(IConfigurationService).getConfig(ConfigKey.Advanced.CLIAIGenerateBranchNames)
		);
		const branchNameGenerator = aiGeneratedBranchNames ? singularitycliAgentInstaService.createInstance(GitBranchNameGenerator) : undefined;

		const singularitycliChatSessionParticipant = this._register(singularitycliAgentInstaService.createInstance(
			SingularityCLIChatSessionParticipant,
			singularitycliChatSessionContentProvider,
			promptResolver,
			cloudSessionProvider,
			branchNameGenerator,
		));
		const singularityCLISessionService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLISessionService));
		const singularityCLIWorktreeManagerService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeService));
		const singularityCLIWorktreeCheckpointService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeCheckpointService));
		const singularityCLIWorkspaceFolderSessions = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorkspaceFolderService));
		const folderRepositoryManager = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IFolderRepositoryManager));
		const nativeEnvService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(INativeEnvService));
		const fileSystemService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IFileSystemService));
		const singularityModels = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLIModels));
		const singularityCLIFolderMruService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatFolderMruService));
		const pullRequestCreationService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IPullRequestCreationService));
		const sessionMetadata = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionMetadataStore));

		this._register(singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLISessionTracker)));
		this._register(singularitycliAgentInstaService.createInstance(SingularityCLIContrib));

		singularityModels.registerLanguageModelChatProvider(vscode.lm);

		const singularitycliParticipant = vscode.chat.createChatParticipant(this.singularitycliSessionType, singularitycliChatSessionParticipant.createHandler());
		this._register(vscode.chat.registerChatSessionContentProvider(this.singularitycliSessionType, singularitycliChatSessionContentProvider, singularitycliParticipant));
		const singularitycliCustomizationProvider = this._register(singularitycliAgentInstaService.createInstance(SingularityCLICustomizationProvider));
		this._register(vscode.chat.registerChatSessionCustomizationProvider(this.singularitycliSessionType, SingularityCLICustomizationProvider.metadata, singularitycliCustomizationProvider));
		this._register(registerCLIChatCommands(singularityCLISessionService, singularityCLIWorktreeManagerService, singularityCLIWorktreeCheckpointService, gitService, gitCommitMessageService, singularityCLIWorkspaceFolderSessions, singularitycliChatSessionContentProvider, folderRepositoryManager, singularityCLIFolderMruService, nativeEnvService, fileSystemService, sessionTracker, terminalIntegration, pullRequestCreationService, sessionMetadata, logService));
		// #endregion

		return { sessionMetadata };
	}

	private registerSingularityCLIServicesV1(instantiationService: IInstantiationService, delegationSummary: IChatDelegationSummaryService, logService: ILogService) {
		const cloudSessionProvider = this.registerSingularityCloudAgent();
		const singularitycliAgentInstaService = instantiationService.createChild(
			new ServiceCollection(
				[IAgentSessionsWorkspace, new SyncDescriptor(AgentSessionsWorkspace)],
				[ISingularityCLIImageSupport, new SyncDescriptor(SingularityCLIImageSupport)],
				[ISingularityCLISessionService, new SyncDescriptor(SingularityCLISessionService)],
				[IChatDelegationSummaryService, delegationSummary],
				[ISingularityCLIModels, new SyncDescriptor(SingularityCLIModels)],
				[ISingularityCLISDK, new SyncDescriptor(SingularityCLISDK)],
				[ISingularityCLIAgents, new SyncDescriptor(SingularityCLIAgents)],
				[ILanguageModelServer, new SyncDescriptor(LanguageModelServer)],
				[ISingularityCLITerminalIntegration, new SyncDescriptor(SingularityCLITerminalIntegration)],
				[IChatSessionWorktreeService, new SyncDescriptor(ChatSessionWorktreeService)],
				[IChatSessionWorktreeCheckpointService, new SyncDescriptor(ChatSessionWorktreeCheckpointService)],
				[IChatSessionWorkspaceFolderService, new SyncDescriptor(ChatSessionWorkspaceFolderService)],
				[ISingularityCLIMCPHandler, new SyncDescriptor(SingularityCLIMCPHandler)],
				[IFolderRepositoryManager, new SyncDescriptor(SingularityCLIFolderRepositoryManager)],
				[IUserQuestionHandler, new SyncDescriptor(UserQuestionHandler)],
				[ICustomSessionTitleService, new SyncDescriptor(CustomSessionTitleService)],
				[ISingularityCLISkills, new SyncDescriptor(SingularityCLISkills)],
				[IChatSessionMetadataStore, new SyncDescriptor(ChatSessionMetadataStore)],
				[IChatFolderMruService, new SyncDescriptor(SingularityCLIFolderMruService)],
				[IPullRequestCreationService, new SyncDescriptor(PullRequestCreationService)],
				...getServices()
			));

		const singularitycliSessionItemProvider = this._register(singularitycliAgentInstaService.createInstance(SingularityCLIChatSessionItemProviderV1));
		const providerRegistration = vscode.chat.registerChatSessionItemProvider(this.singularitycliSessionType, singularitycliSessionItemProvider);
		this._register(providerRegistration);
		const singularitycliChatSessionContentProvider = singularitycliAgentInstaService.createInstance(SingularityCLIChatSessionContentProviderV1, singularitycliSessionItemProvider);
		const promptResolver = singularitycliAgentInstaService.createInstance(SingularityCLIPromptResolver);
		const gitService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IGitService));
		const gitCommitMessageService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IGitCommitMessageService));
		const gitExtensionService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IGitExtensionService));
		const toolsService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IToolsService));
		const aiGeneratedBranchNamesV1 = instantiationService.invokeFunction(accessor =>
			accessor.get(IConfigurationService).getConfig(ConfigKey.Advanced.CLIAIGenerateBranchNames)
		);
		const branchNameGeneratorV1 = aiGeneratedBranchNamesV1 ? singularitycliAgentInstaService.createInstance(GitBranchNameGenerator) : undefined;

		const singularitycliChatSessionParticipant = this._register(singularitycliAgentInstaService.createInstance(
			SingularityCLIChatSessionParticipantV1,
			singularitycliChatSessionContentProvider,
			promptResolver,
			singularitycliSessionItemProvider,
			cloudSessionProvider,
			branchNameGeneratorV1,
		));
		const singularityCLISessionService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLISessionService));
		const singularityCLIWorktreeManagerService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeService));
		const singularityCLIWorktreeCheckpointService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorktreeCheckpointService));
		const singularityCLIWorkspaceFolderSessions = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionWorkspaceFolderService));
		const singularityCLIMetadataStore = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionMetadataStore));

		// Handle worktree cleanup/recreation when archive state changes
		const onDidChangeChatSessionItemState = (providerRegistration as { onDidChangeChatSessionItemState?: vscode.Event<vscode.ChatSessionItem> }).onDidChangeChatSessionItemState;
		if (onDidChangeChatSessionItemState) {
			this._register(onDidChangeChatSessionItemState(async (item) => {
				const sessionId = SessionIdForCLI.parse(item.resource);
				// Persist archived state first so worktree-sharing checks (delete/archive)
				// can ignore archived siblings — their worktrees are reconstructed on
				// un-archive via `recreateWorktreeOnUnarchive`.
				try {
					await singularityCLIMetadataStore.setSessionArchived(sessionId, !!item.archived);
				} catch (error) {
					logService.error(`[SingularityCLI] Failed to persist archived state for session ${sessionId}:`, error);
				}
				if (item.archived) {
					// Skip worktree cleanup if other live sessions still depend on this worktree.
					const worktreePath = await singularityCLIWorktreeManagerService.getWorktreePath(sessionId);
					if (worktreePath) {
						const siblings = await getBlockingSiblingSessionsForFolder(worktreePath, sessionId, singularityCLIMetadataStore, singularityCLIWorkspaceFolderSessions);
						if (siblings.length > 0) {
							logService.trace(`[SingularityCLI] Skipping worktree cleanup for archived session ${sessionId}: ${siblings.length} other session(s) still use the worktree`);
							return;
						}
					}
					try {
						const result = await singularityCLIWorktreeManagerService.cleanupWorktreeOnArchive(sessionId);
						logService.trace(`[SingularityCLI] Worktree cleanup for session ${sessionId}: ${result.cleaned ? 'cleaned' : result.reason}`);
					} catch (error) {
						logService.error(`[SingularityCLI] Failed to cleanup worktree for archived session ${sessionId}:`, error);
					}
				} else {
					try {
						const result = await singularityCLIWorktreeManagerService.recreateWorktreeOnUnarchive(sessionId);
						logService.trace(`[SingularityCLI] Worktree recreation for session ${sessionId}: ${result.recreated ? 'recreated' : result.reason}`);
						if (result.recreated) {
							singularitycliSessionItemProvider.refreshSession({ reason: 'update', sessionId });
						}
					} catch (error) {
						logService.error(`[SingularityCLI] Failed to recreate worktree for unarchived session ${sessionId}:`, error);
					}
				}
			}));
		}

		const folderRepositoryManager = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IFolderRepositoryManager));
		const nativeEnvService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(INativeEnvService));
		const fileSystemService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IFileSystemService));
		const singularityModels = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLIModels));
		const singularityFolderMruService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatFolderMruService));
		const pullRequestCreationService = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IPullRequestCreationService));

		this._register(singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(ISingularityCLISessionTracker)));
		this._register(singularitycliAgentInstaService.createInstance(SingularityCLIContrib));

		singularityModels.registerLanguageModelChatProvider(vscode.lm);

		const singularitycliParticipant = vscode.chat.createChatParticipant(this.singularitycliSessionType, singularitycliChatSessionParticipant.createHandler());
		this._register(vscode.chat.registerChatSessionContentProvider(this.singularitycliSessionType, singularitycliChatSessionContentProvider, singularitycliParticipant));
		const singularitycliCustomizationProvider = this._register(singularitycliAgentInstaService.createInstance(SingularityCLICustomizationProvider));
		this._register(vscode.chat.registerChatSessionCustomizationProvider(this.singularitycliSessionType, SingularityCLICustomizationProvider.metadata, singularitycliCustomizationProvider));
		this._register(registerCLIChatCommandsV1(singularitycliSessionItemProvider, singularityCLISessionService, singularityCLIWorktreeManagerService, singularityCLIWorktreeCheckpointService, gitService, gitCommitMessageService, gitExtensionService, toolsService, singularityCLIWorkspaceFolderSessions, singularitycliChatSessionContentProvider, folderRepositoryManager, singularityFolderMruService, nativeEnvService, fileSystemService, pullRequestCreationService, singularityCLIMetadataStore, logService));
		// #endregion

		const sessionMetadata = singularitycliAgentInstaService.invokeFunction(accessor => accessor.get(IChatSessionMetadataStore));
		return { sessionMetadata };
	}

	private registerSingularityCloudAgent() {
		if (!this.singularityAgentInstaService) {
			return;
		}
		if (this.singularityCloudRegistrations) {
			this.singularityCloudRegistrations.dispose();
			this.singularityCloudRegistrations = undefined;
		}
		this.singularityCloudRegistrations = new DisposableStore();
		this.singularityCloudRegistrations.add(
			this.singularityAgentInstaService.createInstance(PRContentProvider)
		);
		const cloudSessionsProvider = this.singularityCloudRegistrations.add(
			this.singularityAgentInstaService.createInstance(SingularityCloudSessionsProvider)
		);
		this.singularityCloudRegistrations.add(
			vscode.chat.registerChatSessionItemProvider(SingularityCloudSessionsProvider.TYPE, cloudSessionsProvider)
		);
		this.singularityCloudRegistrations.add(
			vscode.chat.registerChatSessionContentProvider(
				SingularityCloudSessionsProvider.TYPE,
				cloudSessionsProvider,
				cloudSessionsProvider.chatParticipant,
				{ supportsInterruptions: true }
			)
		);
		this.singularityCloudRegistrations.add(
			vscode.commands.registerCommand('singularity.chat.cloud.resetWorkspaceConfirmations', () => {
				cloudSessionsProvider.resetWorkspaceContext();
			})
		);
		this.singularityCloudRegistrations.add(
			vscode.commands.registerCommand('singularity.chat.cloud.sessions.openInBrowser', async (chatSessionItem: vscode.ChatSessionItem) => {
				cloudSessionsProvider.openSessionInBrowser(chatSessionItem);
			})
		);
		this.singularityCloudRegistrations.add(
			vscode.commands.registerCommand(CLOSE_SESSION_PR_CMD, async (ctx: CrossChatSessionWithPR) => {
				try {
					const success = await this.octoKitService.closePullRequest(
						ctx.pullRequestDetails.repository.owner.login,
						ctx.pullRequestDetails.repository.name,
						ctx.pullRequestDetails.number,
						{ createIfNone: { detail: l10n.t('Sign in to GitHub to access Singularity cloud sessions.') } });
					if (!success) {
						this.logService.error(`${CLOSE_SESSION_PR_CMD}: Failed to close PR #${ctx.pullRequestDetails.number}`);
					}
					cloudSessionsProvider.refresh();
				} catch (e) {
					this.logService.error(`${CLOSE_SESSION_PR_CMD}: Exception ${e}`);
				}
			})
		);
		this.singularityCloudRegistrations.add(
			vscode.commands.registerCommand('singularity.chat.cloud.sessions.installPRExtension', async () => {
				await this.installPullRequestExtension();
			})
		);
		return cloudSessionsProvider;
	}

	private isPullRequestExtensionInstalled(): boolean {
		return vscode.extensions.getExtension(GHPR_EXTENSION_ID) !== undefined;
	}

	private async installPullRequestExtension(): Promise<void> {
		if (this.isPullRequestExtensionInstalled()) {
			return;
		}
		try {
			const isInsiders = this.envService.getEditorInfo().version.includes('insider');
			const installOptions = { enable: true, installPreReleaseVersion: isInsiders, justification: vscode.l10n.t('Enable additional pull request features, such as checking out and applying changes.') };
			await vscode.commands.executeCommand('workbench.extensions.installExtension', GHPR_EXTENSION_ID, installOptions);
			const maxWaitTime = 10_000; // 10 seconds
			const pollInterval = 100; // 100ms
			let elapsed = 0;
			while (elapsed < maxWaitTime) {
				if (this.isPullRequestExtensionInstalled()) {
					vscode.window.showInformationMessage(vscode.l10n.t('GitHub Pull Request extension installed successfully.'));
					break;
				}
				await new Promise(resolve => setTimeout(resolve, pollInterval));
				elapsed += pollInterval;
			}
			if (!this.isPullRequestExtensionInstalled()) {
				vscode.window.showWarningMessage(vscode.l10n.t('GitHub Pull Request extension is taking longer than expected to install.'));
			}
			await vscode.commands.executeCommand('setContext', prExtensionInstalledContextKey, true);
		} catch (error) {
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to install GitHub Pull Request extension: {0}', error instanceof Error ? error.message : String(error)));
		}
	}
}
