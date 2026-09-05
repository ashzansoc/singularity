/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { ChatRequest, ChatRequestTurn2, ChatResponseStream, ChatResult, Location } from 'vscode';
import { IAuthenticationChatUpgradeService } from '../../../platform/authentication/common/authenticationUpgrade';
import { getChatParticipantNameFromId } from '../../../platform/chat/common/chatAgents';
import { IChatQuotaService } from '../../../platform/chat/common/chatQuotaService';
import { CanceledMessage, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IIgnoreService } from '../../../platform/ignore/common/ignoreService';
import { ILogService } from '../../../platform/log/common/logService';
import { FilterReason } from '../../../platform/networking/common/openai';
import { ITabsAndEditorsService } from '../../../platform/tabs/common/tabsAndEditorsService';
import { getWorkspaceFileDisplayPath, IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { fileTreePartToMarkdown } from '../../../util/common/fileTree';
import { isLocation, isSymbolInformation } from '../../../util/common/types';
import { coalesce } from '../../../util/vs/base/common/arrays';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Schemas } from '../../../util/vs/base/common/network';
import { mixin } from '../../../util/vs/base/common/objects';
import { isEqual } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService, ServicesAccessor } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatRequestEditorData, ChatRequestNotebookData, ChatRequestTurn, ChatResponseAnchorPart, ChatResponseFileTreePart, ChatResponseMarkdownPart, ChatResponseProgressPart2, ChatResponseReferencePart, ChatResponseTurn, ChatLocation as VSChatLocation } from '../../../vscodeTypes';
import { ICommandService } from '../../commands/node/commandService';
import { getAgentForIntent, Intent } from '../../common/constants';
import { IConversationStore } from '../../conversationStore/node/conversationStore';
import { IIntentService } from '../../intents/node/intentService';
import { UnknownIntent } from '../../intents/node/unknownIntent';
import { ContributedToolName } from '../../tools/common/toolNames';
import { ChatVariablesCollection } from '../common/chatVariablesCollection';
import { Conversation, getGlobalContextCacheKey, GlobalContextMessageMetadata, ISingularityChatResult, ISingularityChatResultIn, normalizeSummariesOnRounds, RenderedUserMessageMetadata, Turn, TurnStatus, TurnTokenUsageMetadata } from '../common/conversation';
import { InternalToolReference } from '../common/intents';
import { ChatTelemetryBuilder } from './chatParticipantTelemetry';
import { DefaultIntentRequestHandler } from './defaultIntentRequestHandler';
import { IDocumentContext } from './documentContext';
import { IntentDetector } from './intentDetector';
import { CommandDetails } from './intentRegistry';
import { IIntent } from './intents';
import { bindChatTurnStatus, reportChatTurnStatus, reportChecklistPhase, startChatTurnStatusHeartbeat } from '../../../platform/endpoint/node/chatTurnStatus';
import { promptNeedsDesignIntelligence } from '../../../platform/endpoint/node/designIntelligence';
import { isTrivialChatPrompt, localTrivialChatReply } from '../../../platform/endpoint/node/singularityPromptEngineBridge';

export interface IChatAgentArgs {
	agentName: string;
	agentId: string;
	intentId?: string;
}

/**
 * Handles a single chat request:
 * 1) selects intent
 * 2) invoke intent via `IIntentRequestHandler/AbstractIntentRequestHandler`
 */
export class ChatParticipantRequestHandler {

	public readonly conversation: Conversation;

	private readonly location: ChatLocation;
	private readonly stream: ChatResponseStream;
	private readonly documentContext: IDocumentContext | undefined;
	private readonly intentDetector: IntentDetector;
	private readonly turn: Turn;

	private readonly chatTelemetry: ChatTelemetryBuilder;

	constructor(
		private readonly rawHistory: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>,
		private request: ChatRequest,
		stream: ChatResponseStream,
		private readonly token: CancellationToken,
		private readonly chatAgentArgs: IChatAgentArgs,
		private readonly yieldRequested: () => boolean,
		telemetryMessageId: string | undefined,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICommandService private readonly _commandService: ICommandService,
		@IIgnoreService private readonly _ignoreService: IIgnoreService,
		@IIntentService private readonly _intentService: IIntentService,
		@IConversationStore private readonly _conversationStore: IConversationStore,
		@ITabsAndEditorsService tabsAndEditorsService: ITabsAndEditorsService,
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationChatUpgradeService private readonly _authenticationUpgradeService: IAuthenticationChatUpgradeService,
		@IChatQuotaService private readonly _chatQuotaService: IChatQuotaService,
	) {
		this.location = this.getLocation(request);

		this.intentDetector = this._instantiationService.createInstance(IntentDetector);

		this.stream = stream;

		if (request.location2 instanceof ChatRequestEditorData) {

			// don't send back references that are the same as the document as the one from which
			// the request has been made

			const documentUri = request.location2.document.uri;

			this.stream = ChatResponseStreamImpl.filter(stream, part => {
				if (part instanceof ChatResponseReferencePart || part instanceof ChatResponseProgressPart2) {
					const uri = URI.isUri(part.value) ? part.value : (<Location>part.value).uri;
					return !isEqual(uri, documentUri);
				}
				return true;
			});
		}

		const { turns, sessionId } = _instantiationService.invokeFunction(accessor => addHistoryToConversation(accessor, rawHistory));
		normalizeSummariesOnRounds(turns);
		// Use session ID from history, then VS Code's request.sessionId, then fallback to UUID
		const actualSessionId = sessionId ?? request.sessionId ?? generateUuid();

		this.documentContext = IDocumentContext.inferDocumentContext(request, tabsAndEditorsService.activeTextEditor, turns);

		this.chatTelemetry = this._instantiationService.createInstance(ChatTelemetryBuilder,
			Date.now(),
			actualSessionId,
			this.documentContext,
			turns.length === 0,
			this.request,
			telemetryMessageId
		);

		const latestTurn = Turn.fromRequest(
			this.chatTelemetry.telemetryMessageId,
			this.request);

		this.conversation = new Conversation(actualSessionId, turns.concat(latestTurn));

		this.turn = latestTurn;
	}

	private getLocation(request: ChatRequest) {
		if (request.location2 instanceof ChatRequestEditorData) {
			return ChatLocation.Editor;
		} else if (request.location2 instanceof ChatRequestNotebookData) {
			return ChatLocation.Notebook;
		}
		switch (request.location) { // deprecated, but location2 does not yet allow to distinguish between panel, editing session and others
			case VSChatLocation.Editor:
				return ChatLocation.Editor;
			case VSChatLocation.Panel:
				return ChatLocation.Panel;
			case VSChatLocation.Terminal:
				return ChatLocation.Terminal;
			default:
				return ChatLocation.Other;
		}
	}

	private async sanitizeVariables(): Promise<ChatRequest> {
		const variablePromises = this.request.references.map(async (ref) => {
			const uri = isLocation(ref.value) ? ref.value.uri : URI.isUri(ref.value) ? ref.value : undefined;
			if (!uri) {
				return ref;
			}

			if (uri.scheme === Schemas.untitled) {
				return ref;
			}

			let removeVariable;
			try {
				// Filter out variables which contain paths which are ignored
				removeVariable = await this._ignoreService.isSingularityIgnored(uri);
			} catch {
				// Non-existent files will be handled elsewhere. This might be a virtual document so it's ok if the fs service can't find it.
			}

			if (removeVariable && ref.range) {
				// Also sanitize the user message since file paths are sensitive
				this.turn.request.message = this.turn.request.message.slice(0, ref.range[0]) + this.turn.request.message.slice(ref.range[1]);
			}

			return removeVariable ? null : ref;
		});

		const newVariables = coalesce(await Promise.all(variablePromises));

		return { ...this.request, references: newVariables };
	}

	private async _shouldAskForPermissiveAuth(): Promise<boolean> {
		// The user has confirmed that they want to auth, so prompt them.
		const findConfirmRequest = this.request.acceptedConfirmationData?.find(ref => ref?.authPermissionPrompted);
		if (findConfirmRequest) {
			this.request = await this._authenticationUpgradeService.handleConfirmationRequest(this.stream, this.request, this.rawHistory);
			this.turn.request.message = this.request.prompt;
			return false;
		}

		// Only ask for confirmation if we're invoking the codebase tool or workspace chat participant
		const isWorkspaceCall = this.request.toolReferences.some(ref => ref.name === ContributedToolName.Codebase);
		// and only if we can't access all repos in the workspace
		if (isWorkspaceCall && await this._authenticationUpgradeService.shouldRequestPermissiveSessionUpgrade()) {
			this._authenticationUpgradeService.showPermissiveSessionUpgradeInChat(this.stream, this.request);
			return true;
		}
		return false;
	}

	async getResult(): Promise<ISingularityChatResult> {
		if (await this._shouldAskForPermissiveAuth()) {
			// Return a random response
			return {
				metadata: {
					modelMessageId: this.turn.responseId ?? '',
					responseId: this.turn.id,
					sessionId: this.conversation.sessionId,
					agentId: this.chatAgentArgs.agentId,
					command: this.request.command,
				}
			};
		}
		this._logService.trace(`[${ChatLocation.toStringShorter(this.location)}] chat request received from extension host`);
		const trivialPrompt = isTrivialChatPrompt(this.request.prompt ?? '');
		// Always bind status for non-trivial turns so the UI never sits on a
		// random "Evaluating" placeholder while engines / runtime work.
		const unbindTurnStatus = trivialPrompt
			? () => { }
			: (() => {
				const unbind = bindChatTurnStatus(({ title, detail }) => {
					// Live updates only — heartbeat ticks must not append new checklist rows.
					try {
						this.stream.thinkingProgress({
							id: 'singularity-turn-status',
							text: detail ? `**${title}**\n${detail}` : `**${title}**`,
						});
					} catch {
						/* ignore — thinkingProgress may be unavailable in some hosts */
					}
				});
				// Surface elapsed time while routing / context / tools run so the
				// sessions chat view never looks frozen before the first token.
				const unbindHeartbeat = startChatTurnStatusHeartbeat(
					l10n.t('Starting'),
					l10n.t('Looking at the workspace…'),
					3_000,
				);
				return () => {
					unbind();
					unbindHeartbeat();
				};
			})();
		try {
			// Greetings / small talk: local reply only — no agent, tools, engines, or Flash round-trip.
			if (trivialPrompt) {
				const reply = this._streamLocalTrivialReply(this.request.prompt);
				this.turn.setResponse(
					TurnStatus.Success,
					{ type: 'model', message: reply },
					this.turn.id,
					undefined,
				);
				const trivialResult: ISingularityChatResult = {
					metadata: {
						modelMessageId: this.turn.responseId ?? '',
						responseId: this.turn.id,
						sessionId: this.conversation.sessionId,
						agentId: this.chatAgentArgs.agentId,
						command: this.request.command,
					}
				};
				this._conversationStore.addConversation(this.turn.id, this.conversation);
				return trivialResult;
			}

			reportChecklistPhase(this.stream, l10n.t('Starting'), l10n.t('Looking at the workspace…'));

			// sanitize the variables of all requests
			// this is done here because all intents must honor ignored files
			this.request = await this.sanitizeVariables();

			const executionResult = await this.maybeRunExecutionEngine();
			if (executionResult) {
				this._conversationStore.addConversation(this.turn.id, this.conversation);
				mixin(executionResult, {
					metadata: {
						modelMessageId: this.turn.responseId ?? '',
						responseId: this.turn.id,
						sessionId: this.conversation.sessionId,
						agentId: this.chatAgentArgs.agentId,
						command: this.request.command,
					}
				} satisfies ISingularityChatResult, true);
				return executionResult as ISingularityChatResult;
			}

			const command = this.chatAgentArgs.intentId ?
				this._commandService.getCommand(this.chatAgentArgs.intentId, this.location) :
				undefined;

			let result = this.checkCommandUsage(command);

			if (!result) {
				// this is norm-case, e.g checkCommandUsage didn't produce an error-result
				// and we proceed with the actual intent invocation

				reportChecklistPhase(this.stream, l10n.t('Routing'), l10n.t('Choosing how to handle this request…'));
				const history = this.conversation.turns.slice(0, -1);
				const intent = await this.selectIntent(command, history);

				const userPrompt = this.request.prompt ?? '';
				const isFrontendUi =
					intent.id === 'editAgent'
					&& promptNeedsDesignIntelligence(userPrompt)
					&& !isTrivialChatPrompt(userPrompt);
				if (isFrontendUi) {
					reportChecklistPhase(
						this.stream,
						l10n.t('Design Intelligence'),
						l10n.t('Fetching skills and composing art direction…'),
					);
				} else {
					reportChecklistPhase(this.stream, l10n.t('Working'), l10n.t('Running {0}…', intent.id));
				}
				let chatResult: Promise<ChatResult>;
				if (typeof intent.handleRequest === 'function') {
					chatResult = intent.handleRequest(this.conversation, this.request, this.stream, this.token, this.documentContext, this.chatAgentArgs.agentName, this.location, this.chatTelemetry, this.yieldRequested);
				} else {
					const intentHandler = this._instantiationService.createInstance(DefaultIntentRequestHandler, intent, this.conversation, this.request, this.stream, this.token, this.documentContext, this.location, this.chatTelemetry, undefined, this.yieldRequested);
					chatResult = intentHandler.getResult();
				}

				if (!this.request.isParticipantDetected) {
					this.intentDetector.collectIntentDetectionContextInternal(
						this.turn.request.message,
						this.request.enableCommandDetection ? intent.id : 'none',
						new ChatVariablesCollection(this.request.references),
						this.location,
						history,
						this.documentContext?.document
					);
				}

				result = await chatResult;
			}

			this._conversationStore.addConversation(this.turn.id, this.conversation);

			// mixin fixed metadata shape into result. Modified in place because the object is already
			// cached in the conversation store and we want the full information when looking this up
			// later
			mixin(result, {
				metadata: {
					modelMessageId: this.turn.responseId ?? '',
					responseId: this.turn.id,
					sessionId: this.conversation.sessionId,
					agentId: this.chatAgentArgs.agentId,
					command: this.request.command
				}
			} satisfies ISingularityChatResult, true);

			return <ISingularityChatResult>result;

		} catch (err) {
			// TODO This method should not throw at all, but return a result with errorDetails, and call the IConversationStore
			throw err;
		} finally {
			unbindTurnStatus();
			this._chatQuotaService.resetTurnCredits(this.turn.id);
		}
	}

	private resolveParentSessionResource(): string | undefined {
		const fromRequest = (this.request as { sessionResource?: { toString(): string } }).sessionResource?.toString();
		if (fromRequest) {
			return fromRequest;
		}
		const token = this.request.toolInvocationToken as { sessionResource?: { toString(): string } } | undefined;
		return token?.sessionResource?.toString();
	}

	private async maybeRunExecutionEngine(): Promise<ChatResult | undefined> {
		if (this.chatAgentArgs.intentId !== Intent.Agent) {
			return undefined;
		}
		// Execution-engine workers are launched via RunSubagentTool; never recurse into the engine.
		const subAgentInvocationId = (this.request as { subAgentInvocationId?: string }).subAgentInvocationId;
		if (subAgentInvocationId) {
			return undefined;
		}
		const goal = this.request.prompt ?? '';
		if (!goal) {
			return undefined;
		}
		if (/^# Task:/m.test(goal) && /\bExecution ID:\s*\S+/m.test(goal) && /\bTask ID:\s*\S+/m.test(goal)) {
			return undefined;
		}

		let shouldUse = false;
		try {
			shouldUse = Boolean(await vscode.commands.executeCommand('singularity.execution.shouldUseEngine', goal));
		} catch {
			return undefined;
		}
		if (!shouldUse) {
			return undefined;
		}

		const parentSessionResource = this.resolveParentSessionResource();
		if (!parentSessionResource) {
			this._logService.warn('[ExecutionEngine] Skipping engine: missing parentSessionResource');
			return undefined;
		}

		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return undefined;
		}

		reportChecklistPhase(this.stream, l10n.t('Execution Engine'), l10n.t('Running dependency-aware execution…'));

		const requestId = (this.request as { id?: string }).id ?? this.turn.id;
		const result = await vscode.commands.executeCommand<{
			ok: boolean;
			executionId: string;
			summary: string;
		}>('singularity.execution.run', {
			goal,
			sessionId: this.conversation.sessionId,
			workspaceRoot: folder.uri.fsPath,
			parentSessionResource,
			parentRequestId: requestId,
			executorKind: 'extensionHost',
		});

		const summary = result?.summary ?? (result?.ok ? 'Execution completed.' : 'Execution failed.');
		this.stream.markdown(summary);
		this.turn.setResponse(TurnStatus.Success, { type: 'model', message: summary }, this.turn.id, undefined);

		return {
			metadata: {
				modelMessageId: this.turn.responseId ?? '',
				responseId: this.turn.id,
				sessionId: this.conversation.sessionId,
				agentId: this.chatAgentArgs.agentId,
				command: this.request.command,
			},
		};
	}

	private async selectIntent(command: CommandDetails | undefined, history: Turn[]): Promise<IIntent> {
		if (!command?.intent && this.location === ChatLocation.Editor) { // TODO@jrieken do away with location specific code

			let preferredIntent: Intent | undefined;
			if (this.documentContext && this.request.attempt === 0 && history.length === 0) {
				if (this.documentContext.selection.isEmpty && this.documentContext.document.lineAt(this.documentContext.selection.start.line).text.trim() === '') {
					preferredIntent = Intent.Generate;
				} else if (!this.documentContext.selection.isEmpty && this.documentContext.selection.start.line !== this.documentContext.selection.end.line) {
					preferredIntent = Intent.Edit;
				}
			}
			if (preferredIntent) {
				return this._intentService.getIntent(preferredIntent, this.location) ?? this._intentService.unknownIntent;
			}
		}

		return command?.intent ?? this._intentService.unknownIntent;
	}

	private checkCommandUsage(command: CommandDetails | undefined): ChatResult | undefined {
		if (command?.intent && !(command.intent.commandInfo?.allowsEmptyArgs ?? true) && !this.turn.request.message) {
			const commandAgent = getAgentForIntent(command.intent.id as Intent, this.location);
			let usage = '';
			if (commandAgent) {
				// If the command was used, it must have an agent
				usage = `@${commandAgent.agent} `;
				if (commandAgent.command) {
					usage += ` /${commandAgent.command}`;
				}
				usage += ` ${command.details}`;

			}

			const message = l10n.t(`Please specify a question when using this command.\n\nUsage: {0}`, usage);
			const chatResult = { errorDetails: { message } };
			this.turn.setResponse(TurnStatus.Error, { type: 'meta', message }, undefined, chatResult);
			return chatResult;
		}
	}

	/** Instant local reply for hi / thanks / who-are-you — no model round-trip. */
	private _streamLocalTrivialReply(prompt: string): string {
		const reply = localTrivialChatReply(prompt);
		this._logService.info(`[trivialChat] local reply (${prompt.trim().slice(0, 40)})`);
		this.stream.markdown(reply);
		return reply;
	}
}


export function addHistoryToConversation(accessor: ServicesAccessor, history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>): { turns: Turn[]; sessionId: string | undefined } {
	const instaService = accessor.get(IInstantiationService);

	const turns: Turn[] = [];
	let sessionId: string | undefined;
	let previousChatRequestTurn: ChatRequestTurn | undefined;

	for (const entry of history) {
		// The extension API model technically supports arbitrary requests/responses not in pairs, but this isn't used anywhere,
		// so we can just fit this to our Conversation model for now.
		if (entry instanceof ChatRequestTurn) {
			previousChatRequestTurn = entry;
		} else {
			const existingTurn = instaService.invokeFunction(findExistingTurnFromVSCodeChatHistoryTurn, entry);
			if (existingTurn) {
				turns.push(existingTurn);
			} else {
				if (previousChatRequestTurn) {
					const deserializedTurn = instaService.invokeFunction(createTurnFromVSCodeChatHistoryTurns, previousChatRequestTurn, entry);
					previousChatRequestTurn = undefined;
					turns.push(deserializedTurn);
				}
			}

			const singularityResult = entry.result as ISingularityChatResultIn;
			if (typeof singularityResult.metadata?.sessionId === 'string') {
				sessionId = singularityResult.metadata.sessionId;
			}
		}
	}

	return { turns, sessionId };
}

/**
 * Try to find an existing `Turn` instance that we created previously based on the responseId of a vscode turn.
 */
function findExistingTurnFromVSCodeChatHistoryTurn(accessor: ServicesAccessor, turn: ChatRequestTurn | ChatResponseTurn): Turn | undefined {
	const conversationStore = accessor.get(IConversationStore);
	const responseId = getResponseIdFromVSCodeChatHistoryTurn(turn);
	const conversation = responseId ? conversationStore.getConversation(responseId) : undefined;
	return conversation?.turns.find(turn => turn.id === responseId);
}

function getResponseIdFromVSCodeChatHistoryTurn(turn: ChatRequestTurn | ChatResponseTurn): string | undefined {
	if (turn instanceof ChatResponseTurn) {
		const lastEntryResult = turn.result as ISingularityChatResultIn | undefined;
		return lastEntryResult?.metadata?.responseId;
	}
	return undefined;
}

/**
 * Try as best as possible to create a `Turn` object from data that comes from vscode.
 */
function createTurnFromVSCodeChatHistoryTurns(
	accessor: ServicesAccessor,
	chatRequestTurn: ChatRequestTurn,
	chatResponseTurn: ChatResponseTurn
): Turn {
	const commandService = accessor.get(ICommandService);
	const workspaceService = accessor.get(IWorkspaceService);
	const instaService = accessor.get(IInstantiationService);

	const chatRequestAsTurn2 = chatRequestTurn as ChatRequestTurn2;
	const currentTurn = new Turn(
		undefined,
		{ message: chatRequestTurn.prompt, type: 'user' },
		new ChatVariablesCollection(chatRequestTurn.references),
		chatRequestTurn.toolReferences.map(InternalToolReference.from),
		chatRequestAsTurn2.editedFileEvents,
		undefined,
		false,
		chatRequestAsTurn2.modeInstructions2,
	);

	// Take just the content messages
	const content = chatResponseTurn.response.map(r => {
		if (r instanceof ChatResponseMarkdownPart) {
			return r.value.value;
		} else if (r instanceof ChatResponseFileTreePart) {
			return fileTreePartToMarkdown(r);
		} else if ('content' in r) {
			return r.content;
		} else if (r instanceof ChatResponseAnchorPart) {
			return anchorPartToMarkdown(workspaceService, r);
		} else {
			return null;
		}
	}).filter(Boolean).join('');
	const intentId = chatResponseTurn.command || getChatParticipantNameFromId(chatResponseTurn.participant);
	const command = commandService.getCommand(intentId, ChatLocation.Panel);
	let status: TurnStatus;
	if (!chatResponseTurn.result.errorDetails) {
		status = TurnStatus.Success;
	} else if (chatResponseTurn.result.errorDetails?.responseIsFiltered) {
		if (chatResponseTurn.result.metadata?.category === FilterReason.Prompt) {
			status = TurnStatus.PromptFiltered;
		} else {
			status = TurnStatus.Filtered;
		}
	} else if (chatResponseTurn.result.errorDetails.message === 'Cancelled' || chatResponseTurn.result.errorDetails.message === CanceledMessage.message) {
		status = TurnStatus.Cancelled;
	} else {
		status = TurnStatus.Error;
	}

	currentTurn.setResponse(status, { message: content, type: 'model', name: command?.commandId || UnknownIntent.ID }, undefined, chatResponseTurn.result);
	const turnMetadata = (chatResponseTurn.result as ISingularityChatResultIn).metadata;
	if (turnMetadata?.renderedGlobalContext) {
		const cacheKey = turnMetadata.globalContextCacheKey ?? instaService.invokeFunction(getGlobalContextCacheKey);
		currentTurn.setMetadata(new GlobalContextMessageMetadata(turnMetadata?.renderedGlobalContext, cacheKey));
	}
	if (turnMetadata?.renderedUserMessage) {
		currentTurn.setMetadata(new RenderedUserMessageMetadata(turnMetadata.renderedUserMessage));
	}
	if (turnMetadata?.promptTokens && turnMetadata?.outputTokens) {
		currentTurn.setMetadata(new TurnTokenUsageMetadata(turnMetadata.promptTokens, turnMetadata.outputTokens));
	}

	return currentTurn;
}

function anchorPartToMarkdown(workspaceService: IWorkspaceService, anchor: ChatResponseAnchorPart): string {
	let text: string;
	let path: string;

	if (URI.isUri(anchor.value)) {
		path = getWorkspaceFileDisplayPath(workspaceService, anchor.value);
		const label = anchor.title ?? path;
		text = `\`${label}\``;
	} else if (isLocation(anchor.value)) {
		path = getWorkspaceFileDisplayPath(workspaceService, anchor.value.uri);
		const label = anchor.title ?? `${path}#L${anchor.value.range.start.line + 1}${anchor.value.range.start.line === anchor.value.range.end.line ? '' : `-${anchor.value.range.end.line + 1}`}`;
		text = `\`${label}\``;
	} else if (isSymbolInformation(anchor.value)) {
		path = getWorkspaceFileDisplayPath(workspaceService, anchor.value.location.uri);
		text = `\`${anchor.value.name}\``;
	} else {
		// Unknown anchor type
		return '';
	}

	return `[${text}](${path} ${anchor.title ? `"${anchor.title}"` : ''})`;
}
