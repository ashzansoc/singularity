/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../../base/common/observable.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { AgentHostSingularitySdkLogLevelSettingId, AgentHostModelCapabilityOverridesSettingId, AgentHostOpus48PromptEnabledSettingId, AgentHostReasoningEffortOverrideSettingId, AgentHostToolSearchDeferThresholdSettingId, AgentHostToolSearchEnabledSettingId, SingularityCliConfigKey } from '../../../../../../platform/agentHost/common/singularityCliConfig.js';
import { IAgentSubscription } from '../../../../../../platform/agentHost/common/state/agentSubscription.js';
import type { ClientAnnotationsAction, INotification, IRootConfigChangedAction, SessionAction, TerminalAction } from '../../../../../../platform/agentHost/common/state/sessionActions.js';
import type { ConfigPropertySchema, RootState } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { AgentHostSingularityCliSettingsContribution } from '../../../browser/agentSessions/agentHost/agentHostSingularityCliSettingsContribution.js';

class MockAgentHostService extends mock<IAgentHostService>() {
	declare readonly _serviceBrand: undefined;

	private readonly _onAgentHostStart = new Emitter<void>();
	override readonly onAgentHostStart = this._onAgentHostStart.event;
	override readonly onAgentHostExit = Event.None;
	override readonly onDidAction = Event.None;
	override readonly onDidNotification: Event<INotification> = Event.None;

	public dispatchedActions: { channel: string; action: SessionAction | TerminalAction | ClientAnnotationsAction | IRootConfigChangedAction }[] = [];

	override dispatch(channel: string, action: SessionAction | TerminalAction | ClientAnnotationsAction | IRootConfigChangedAction): void {
		this.dispatchedActions.push({ channel, action });
	}

	private _rootStateValue: RootState | undefined = undefined;
	private readonly _rootStateOnDidChange = new Emitter<RootState>();
	override readonly rootState: IAgentSubscription<RootState> = (() => {
		const self = this;
		return {
			get value() { return self._rootStateValue; },
			get verifiedValue() { return self._rootStateValue; },
			onDidChange: this._rootStateOnDidChange.event,
			onWillApplyAction: Event.None,
			onDidApplyAction: Event.None,
		};
	})();

	setRootState(state: RootState): void {
		this._rootStateValue = state;
		this._rootStateOnDidChange.fire(state);
	}

	dispose(): void {
		this._onAgentHostStart.dispose();
		this._rootStateOnDidChange.dispose();
	}
}

function makeRootStateWithSchema(properties: Record<string, ConfigPropertySchema>, values: Record<string, unknown> = {}): RootState {
	return {
		agents: [],
		config: {
			schema: { type: 'object', properties },
			values,
		},
	};
}

/** The full schema an up-to-date host advertises for the forwarded keys. */
const fullSchema: Record<string, ConfigPropertySchema> = {
	[SingularityCliConfigKey.SingularitySdkLogLevel]: { type: 'string', title: 'Singularity SDK Log Level' },
	[SingularityCliConfigKey.Opus48Prompt]: { type: 'boolean', title: 'Opus 4.8 Agent Prompt' },
	[SingularityCliConfigKey.ToolSearchEnabled]: { type: 'boolean', title: 'Agent Host Tool Search' },
	[SingularityCliConfigKey.ToolSearchDeferThreshold]: { type: 'number', title: 'Tool Search Defer Threshold' },
	[SingularityCliConfigKey.ReasoningEffortOverride]: { type: 'string', title: 'Reasoning Effort Override' },
	[SingularityCliConfigKey.ModelCapabilityOverrides]: { type: 'object', title: 'Model Capability Overrides' },
};

/** Two microtask hops: one for the await on computeValue, one for the dispatch. */
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function setup(disposables: DisposableStore, settings: Record<string, unknown>) {
	const instantiationService = disposables.add(new TestInstantiationService());
	const agentHostService = new MockAgentHostService();
	disposables.add({ dispose: () => agentHostService.dispose() });
	const configurationService = new TestConfigurationService(settings);
	instantiationService.stub(IAgentHostService, agentHostService);
	instantiationService.stub(IConfigurationService, configurationService);
	instantiationService.stub(IAgentHostEnablementService, { _serviceBrand: undefined, enabled: constObservable(true) });
	disposables.add(instantiationService.createInstance(AgentHostSingularityCliSettingsContribution));
	return { agentHostService };
}

suite('AgentHostSingularityCliSettingsContribution', () => {

	const disposables = new DisposableStore();

	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('forwards the experimentation settings into root config once the schema advertises them', async () => {
		const { agentHostService } = setup(disposables, {
			[AgentHostSingularitySdkLogLevelSettingId]: 'trace',
			[AgentHostOpus48PromptEnabledSettingId]: true,
			[AgentHostToolSearchEnabledSettingId]: true,
			[AgentHostToolSearchDeferThresholdSettingId]: 5.9,
			[AgentHostReasoningEffortOverrideSettingId]: 'xhigh',
			[AgentHostModelCapabilityOverridesSettingId]: { 'preview-model-x': { family: 'claude-opus-4-8' } },
		});
		agentHostService.setRootState(makeRootStateWithSchema(fullSchema));
		await flush();

		// The shared forwarder dispatches one RootConfigChanged per key; merge them
		// and assert the full forwarded set (order-independent).
		assert.strictEqual(agentHostService.dispatchedActions.length, 6);
		const merged = Object.assign({}, ...agentHostService.dispatchedActions.map(a => (a.action as IRootConfigChangedAction).config));
		assert.deepStrictEqual(merged, {
			[SingularityCliConfigKey.SingularitySdkLogLevel]: 'trace',
			[SingularityCliConfigKey.Opus48Prompt]: true,
			[SingularityCliConfigKey.ToolSearchEnabled]: true,
			[SingularityCliConfigKey.ToolSearchDeferThreshold]: 5,
			[SingularityCliConfigKey.ReasoningEffortOverride]: 'xhigh',
			[SingularityCliConfigKey.ModelCapabilityOverrides]: { 'preview-model-x': { family: 'claude-opus-4-8' } },
		});
	});

	test('forwards only the keys an older host advertises', async () => {
		const { agentHostService } = setup(disposables, {
			[AgentHostSingularitySdkLogLevelSettingId]: 'trace',
			[AgentHostOpus48PromptEnabledSettingId]: true,
			[AgentHostReasoningEffortOverrideSettingId]: 'xhigh',
		});
		agentHostService.setRootState(makeRootStateWithSchema({
			[SingularityCliConfigKey.Opus48Prompt]: { type: 'boolean', title: 'Opus 4.8 Agent Prompt' },
		}));
		await flush();

		assert.strictEqual(agentHostService.dispatchedActions.length, 1);
		assert.deepStrictEqual((agentHostService.dispatchedActions[0].action as IRootConfigChangedAction).config, {
			[SingularityCliConfigKey.Opus48Prompt]: true,
		});
	});

	test('does not dispatch to a host whose schema does not advertise any key', async () => {
		const { agentHostService } = setup(disposables, {
			[AgentHostSingularitySdkLogLevelSettingId]: 'trace',
			[AgentHostOpus48PromptEnabledSettingId]: true,
		});
		agentHostService.setRootState(makeRootStateWithSchema({}));
		await flush();

		assert.deepStrictEqual(agentHostService.dispatchedActions as readonly unknown[], []);
	});

	test('does not re-dispatch when the root config already carries structurally equal values', async () => {
		const { agentHostService } = setup(disposables, {
			[AgentHostSingularitySdkLogLevelSettingId]: 'trace',
			[AgentHostOpus48PromptEnabledSettingId]: true,
			[AgentHostReasoningEffortOverrideSettingId]: 'xhigh',
			[AgentHostModelCapabilityOverridesSettingId]: { 'preview-model-x': { family: 'claude-opus-4-8' } },
		});
		agentHostService.setRootState(makeRootStateWithSchema(fullSchema, {
			[SingularityCliConfigKey.SingularitySdkLogLevel]: 'trace',
			[SingularityCliConfigKey.Opus48Prompt]: true,
			[SingularityCliConfigKey.ToolSearchEnabled]: false,
			[SingularityCliConfigKey.ToolSearchDeferThreshold]: 1,
			[SingularityCliConfigKey.ReasoningEffortOverride]: 'xhigh',
			[SingularityCliConfigKey.ModelCapabilityOverrides]: { 'preview-model-x': { family: 'claude-opus-4-8' } },
		}));
		await flush();

		assert.deepStrictEqual(agentHostService.dispatchedActions as readonly unknown[], []);
	});
});
