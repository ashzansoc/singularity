/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { createSchema, schemaProperty } from './agentHostSchema.js';
import type { ModelSelection } from './state/protocol/state.js';

/**
 * Root-config keys consumed exclusively by the Singularity CLI provider
 * (`SingularitySessionLauncher` / `SingularityAgent`) — kept out of the
 * provider-agnostic `agentHostCustomizationConfigSchema`.
 */
export const enum SingularityCliConfigKey {
	/** Use Agent Host's custom terminal tool instead of the SDK's default. Off by default. */
	EnableCustomTerminalTool = 'enableCustomTerminalTool',
	/** Log level passed to the Singularity SDK client. */
	SingularitySdkLogLevel = 'singularitySdkLogLevel',
	/** Enable the rubber duck critic subagent. */
	RubberDuck = 'rubberDuck',
	/** Apply Opus 4.8-tuned system-prompt overrides on Opus 4.8 models. Off by default. */
	Opus48Prompt = 'opus48Prompt',
	/** Enable runtime tool search (deferred-tool loading) for Singularity SDK sessions. On by default. */
	ToolSearchEnabled = 'toolSearchEnabled',
	/** Minimum tool count before MCP/external tools are deferred behind tool search. 0 = always defer. */
	ToolSearchDeferThreshold = 'toolSearchDeferThreshold',
	/** Override reasoning effort regardless of the picker value; unsupported values are ignored. */
	ReasoningEffortOverride = 'reasoningEffortOverride',
	/** Per-model capability overrides (family aliases) keyed by model id. */
	ModelCapabilityOverrides = 'modelCapabilityOverrides',
}

// VS Code `chat.agentHost.*` setting IDs that feed the root-config keys above,
// kept beside the keys they forward to. Registered in `chat.shared.contribution.ts`
// and forwarded into the host's root config by `AgentHostSingularityCliSettingsContribution`
// (and, for the terminal-tool toggle, `AgentHostTerminalContribution`).

export const AgentHostCustomTerminalToolEnabledSettingId = 'chat.agentHost.customTerminalTool.enabled';

export const AgentHostSingularitySdkLogLevelSettingId = 'chat.agentHost.singularitySdk.logLevel';

export const AgentHostOpus48PromptEnabledSettingId = 'chat.agentHost.opus48Prompt.enabled';

export const AgentHostToolSearchEnabledSettingId = 'chat.agentHost.singularity.toolSearch.enabled';

export const AgentHostToolSearchDeferThresholdSettingId = 'chat.agentHost.singularity.toolSearch.deferThreshold';

export const AgentHostReasoningEffortOverrideSettingId = 'chat.agentHost.singularity.reasoningEffortOverride';

export const AgentHostModelCapabilityOverridesSettingId = 'chat.agentHost.modelCapabilityOverrides';

export const singularitySdkLogLevelSettingValues = ['info', 'trace'] as const;
export type SingularitySdkLogLevelSetting = typeof singularitySdkLogLevelSettingValues[number];

/** Floors valid tool-search thresholds and returns the default for invalid values. */
export function normalizeToolSearchDeferThreshold(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1;
}

/** Per-model capability override; the agent-host equivalent of the extension's `IModelCapabilityOverride`. */
interface ISingularityCliModelCapabilityOverride {
	/** Alias the model's family for prompt/capability routing (e.g. `"claude-opus-4-8"`). */
	readonly family?: string;
}

/** Map of model id → capability override. */
export type SingularityCliModelCapabilityOverrides = Record<string, ISingularityCliModelCapabilityOverride>;

/** OpenRouter DeepSeek V4 Flash 0731 via TokenRouter BYOK — sole agent-host coding model. */
export const PINNED_BYOK_FLASH_MODEL_ID = 'tokenrouter/deepseek/deepseek-v4-flash-0731';
export const PINNED_FLASH_CATALOG_ID = 'deepseek/deepseek-v4-flash-0731';

/**
 * Remap CAPI Auto / Claude / GPT picks to the pinned OpenRouter Flash BYOK id.
 * Without this, `auto` routes through GitHub CAPI (claude-haiku) instead of OpenRouter.
 */
export function coercePinnedFlashModelId(rawModelId: string | undefined): string | undefined {
	if (!rawModelId) {
		return PINNED_BYOK_FLASH_MODEL_ID;
	}
	const id = rawModelId.trim().toLowerCase();
	if (id === 'auto' || /(^|\/)(claude|gpt-|haiku|sonnet|opus|gemini|nemotron)/.test(id)) {
		return PINNED_BYOK_FLASH_MODEL_ID;
	}
	if (id === PINNED_FLASH_CATALOG_ID || id.endsWith(`/${PINNED_FLASH_CATALOG_ID}`)) {
		return PINNED_BYOK_FLASH_MODEL_ID;
	}
	if (/deepseek-v4-flash-0731/.test(id) && !id.startsWith('tokenrouter/')) {
		return PINNED_BYOK_FLASH_MODEL_ID;
	}
	return rawModelId;
}

export const singularityCliConfigSchema = createSchema({
	[SingularityCliConfigKey.EnableCustomTerminalTool]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.enableCustomTerminalTool.title', "Use Agent Host Terminal Tool"),
		description: localize('agentHost.config.enableCustomTerminalTool.description', "When enabled, Singularity SDK sessions use Agent Host's terminal tool override instead of the SDK's default terminal behavior."),
		default: false,
	}),
	[SingularityCliConfigKey.SingularitySdkLogLevel]: schemaProperty<SingularitySdkLogLevelSetting>({
		type: 'string',
		title: localize('agentHost.config.singularitySdkLogLevel.title', "Singularity SDK Log Level"),
		description: localize('agentHost.config.singularitySdkLogLevel.description', "Controls logging from the Singularity SDK runtime. Agent host trace logging always enables trace output."),
		enum: [...singularitySdkLogLevelSettingValues],
		enumLabels: [
			localize('agentHost.config.singularitySdkLogLevel.info', "Info"),
			localize('agentHost.config.singularitySdkLogLevel.trace', "Trace"),
		],
		default: 'info',
	}),
	[SingularityCliConfigKey.RubberDuck]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.rubberDuck.title', "Rubber Duck Agent"),
		description: localize('agentHost.config.rubberDuck.description', "When enabled, the coding agent uses a rubber duck critic subagent to review code changes using a complementary model."),
		default: false,
	}),
	[SingularityCliConfigKey.Opus48Prompt]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.opus48Prompt.title', "Opus 4.8 Agent Prompt"),
		description: localize('agentHost.config.opus48Prompt.description', "When enabled, Singularity SDK sessions running a Claude Opus 4.8 model apply Opus 4.8-tuned system-prompt section overrides on top of the default system message."),
		default: false,
	}),
	[SingularityCliConfigKey.ToolSearchEnabled]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.toolSearchEnabled.title', "Agent Host Tool Search"),
		description: localize('agentHost.config.toolSearchEnabled.description', "When enabled, Singularity SDK sessions defer MCP and non-core VS Code tools behind a tool-search tool so the model discovers them on demand instead of loading every tool definition up front."),
		default: true,
	}),
	[SingularityCliConfigKey.ToolSearchDeferThreshold]: schemaProperty<number>({
		type: 'number',
		title: localize('agentHost.config.toolSearchDeferThreshold.title', "Tool Search Defer Threshold"),
		description: localize('agentHost.config.toolSearchDeferThreshold.description', "Minimum number of tools before MCP and external tools are deferred behind tool search. Set to 0 to always defer external tools. Only effective when tool search is enabled."),
		default: 1,
	}),
	[SingularityCliConfigKey.ReasoningEffortOverride]: schemaProperty<string>({
		type: 'string',
		title: localize('agentHost.config.reasoningEffortOverride.title', "Reasoning Effort Override"),
		description: localize('agentHost.config.reasoningEffortOverride.description', "Overrides the reasoning effort for Singularity SDK sessions regardless of the per-model picker value. Set it to a level the selected model supports (e.g. `low`, `medium`, `high`, `xhigh`, `max`); a value that isn't a recognized effort level is ignored and the session falls back to the picker value. Only affects Singularity SDK sessions; intended for experimentation."),
		default: '',
	}),
	[SingularityCliConfigKey.ModelCapabilityOverrides]: schemaProperty<SingularityCliModelCapabilityOverrides>({
		type: 'object',
		title: localize('agentHost.config.modelCapabilityOverrides.title', "Model Capability Overrides"),
		description: localize('agentHost.config.modelCapabilityOverrides.description', "Per-model capability overrides for Singularity SDK sessions, keyed by model id. Aliasing a model id to a known `family` routes it to that family's tuned system prompt without changing the model id sent to the runtime. Only affects Singularity SDK sessions; intended for experimentation."),
		additionalProperties: {
			type: 'object',
			title: localize('agentHost.config.modelCapabilityOverrides.entry.title', "Capability Override"),
			description: localize('agentHost.config.modelCapabilityOverrides.entry.description', "A single capability override. The property key is the model id."),
			properties: {
				family: {
					type: 'string',
					title: localize('agentHost.config.modelCapabilityOverrides.family.title', "Family"),
					description: localize('agentHost.config.modelCapabilityOverrides.family.description', "Alias the model's family for prompt/capability routing (e.g. `claude-opus-4-8`)."),
				},
			},
		},
		default: {},
	}),
});

/** Returns the configured family alias for `modelId`, or `undefined`. Malformed entries are treated as unset. */
function getModelFamilyAlias(overrides: SingularityCliModelCapabilityOverrides | undefined, modelId: string): string | undefined {
	const family = overrides?.[modelId]?.family;
	return typeof family === 'string' && family.length > 0 ? family : undefined;
}

/**
 * Substitutes a configured family alias for the model id so an aliased preview model
 * routes to a known family's prompt contributor. `model.config` picker values are
 * preserved; returns the input unchanged when no alias applies.
 */
export function applyModelFamilyAlias(model: ModelSelection | undefined, overrides: SingularityCliModelCapabilityOverrides | undefined): ModelSelection | undefined {
	if (!model) {
		return undefined;
	}
	const family = getModelFamilyAlias(overrides, model.id);
	return family ? { ...model, id: family } : model;
}
