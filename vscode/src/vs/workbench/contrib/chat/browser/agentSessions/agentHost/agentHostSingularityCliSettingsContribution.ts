/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { isObject } from '../../../../../../base/common/types.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { AgentHostSingularitySdkLogLevelSettingId, AgentHostModelCapabilityOverridesSettingId, AgentHostOpus48PromptEnabledSettingId, AgentHostReasoningEffortOverrideSettingId, AgentHostToolSearchDeferThresholdSettingId, AgentHostToolSearchEnabledSettingId, SingularityCliConfigKey, normalizeToolSearchDeferThreshold, type SingularityCliModelCapabilityOverrides, type SingularitySdkLogLevelSetting } from '../../../../../../platform/agentHost/common/singularityCliConfig.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../../../../workbench/common/contributions.js';
import { AgentHostRootConfigForwarder, type IForwardedRootConfigKey } from './agentHostRootConfigForwarder.js';

/**
 * Forwards Singularity-CLI settings into the **local** agent host's root config so
 * `SingularityAgent` and `SingularitySessionLauncher` can read them. Gated on
 * Agent Host runtime availability. The schema-gate / hydration-retry / loop-guard
 * machinery lives in the shared
 * {@link AgentHostRootConfigForwarder}; this contribution only declares the keys.
 */
export class AgentHostSingularityCliSettingsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentHostSingularityCliSettings';

	private readonly _forwarder: AgentHostRootConfigForwarder;

	constructor(
		@IAgentHostService agentHostService: IAgentHostService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAgentHostEnablementService private readonly _agentHostEnablementService: IAgentHostEnablementService,
	) {
		super();

		const keys: readonly IForwardedRootConfigKey[] = [
			{
				key: SingularityCliConfigKey.SingularitySdkLogLevel,
				computeValue: () => this._configurationService.getValue<SingularitySdkLogLevelSetting>(AgentHostSingularitySdkLogLevelSettingId) ?? 'info',
				registerTriggers: (store, push) => this._pushOnSettingChange(store, push, AgentHostSingularitySdkLogLevelSettingId),
			},
			{
				key: SingularityCliConfigKey.Opus48Prompt,
				computeValue: () => this._configurationService.getValue<boolean>(AgentHostOpus48PromptEnabledSettingId) === true,
				registerTriggers: (store, push) => this._pushOnSettingChange(store, push, AgentHostOpus48PromptEnabledSettingId),
			},
			{
				key: SingularityCliConfigKey.ToolSearchEnabled,
				computeValue: () => this._configurationService.getValue<boolean>(AgentHostToolSearchEnabledSettingId) === true,
				registerTriggers: (store, push) => this._pushOnSettingChange(store, push, AgentHostToolSearchEnabledSettingId),
			},
			{
				key: SingularityCliConfigKey.ToolSearchDeferThreshold,
				computeValue: () => normalizeToolSearchDeferThreshold(this._configurationService.getValue<number>(AgentHostToolSearchDeferThresholdSettingId)),
				registerTriggers: (store, push) => this._pushOnSettingChange(store, push, AgentHostToolSearchDeferThresholdSettingId),
			},
			{
				key: SingularityCliConfigKey.ReasoningEffortOverride,
				computeValue: () => {
					const value = this._configurationService.getValue<string>(AgentHostReasoningEffortOverrideSettingId);
					// '' is the schema's unset marker, so clearing the setting clears the override.
					return typeof value === 'string' ? value : '';
				},
				registerTriggers: (store, push) => this._pushOnSettingChange(store, push, AgentHostReasoningEffortOverrideSettingId),
			},
			{
				key: SingularityCliConfigKey.ModelCapabilityOverrides,
				computeValue: () => {
					const value = this._configurationService.getValue<SingularityCliModelCapabilityOverrides>(AgentHostModelCapabilityOverridesSettingId);
					return isObject(value) ? value : {};
				},
				registerTriggers: (store, push) => this._pushOnSettingChange(store, push, AgentHostModelCapabilityOverridesSettingId),
			},
		];
		this._forwarder = this._register(new AgentHostRootConfigForwarder(keys, agentHostService));

		this._register(autorun(reader => {
			if (this._agentHostEnablementService.enabled.read(reader)) {
				this._forwarder.start();
			}
		}));
	}

	private _pushOnSettingChange(store: DisposableStore, push: () => void, settingId: string): void {
		store.add(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(settingId)) {
				push();
			}
		}));
	}
}
