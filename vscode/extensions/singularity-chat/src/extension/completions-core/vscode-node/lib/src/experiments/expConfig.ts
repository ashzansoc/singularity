/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { TelemetryData, telemetryExpProblem } from '../telemetry';
import { ExpServiceTelemetryNames } from './telemetryNames';

// All variables we pull from Exp and might want to use
export enum ExpTreatmentVariables {
	// the engine we want to request, used in actual experiment(s)
	CustomEngine = 'singularitycustomengine',
	// if set, any custom engine (see previous) will only apply when the current engine matches the value of this variable
	CustomEngineTargetEngine = 'singularitycustomenginetargetengine',

	OverrideBlockMode = 'singularityoverrideblockmode',
	SuffixPercent = 'SingularitySuffixPercent', // the percentage of the prompt tokens to allocate to the suffix
	CppHeadersEnableSwitch = 'singularitycppheadersenableswitch', // whether to enable the inclusion of C++ headers as neighbors in the prompt
	UseSubsetMatching = 'singularitysubsetmatching', // whether to use subset matching instead of jaccard similarity experiment

	// granularity specification
	SuffixMatchThreshold = 'singularitysuffixmatchthreshold', // the threshold that new suffix should match with old suffix

	MaxPromptCompletionTokens = 'maxpromptcompletionTokens', // the maximum tokens of the prompt and completion

	/**
	 * Enable the use of the Workspace Context Coordinator to coordinate context from providers of workspace snippets.
	 */
	StableContextPercent = 'singularitystablecontextpercent', // the percentage of the prompt tokens to allocate to the stable context
	VolatileContextPercent = 'singularityvolatilecontextpercent', // the percentage of the prompt tokens to allocate to the volatile context

	/**
	 * Flags that control the enablement of the related files extensibility for various languages in VSCode.
	 */
	RelatedFilesVSCodeCSharp = 'singularityrelatedfilesvscodecsharp', // whether to include related files as neighbors in the prompt for C#, this takes precedence over RelatedFilesVSCode
	RelatedFilesVSCodeTypeScript = 'singularityrelatedfilesvscodetypescript', // whether to include related files as neighbors in the prompt for TS/JS, this takes precedence over RelatedFilesVSCode
	RelatedFilesVSCode = 'singularityrelatedfilesvscode', // whether to include related files as neighbors in the prompt, vscode experiment

	/**
	 * Flags that control the inclusion of open tab files as neighboring files for various languages.
	 */
	ContextProviders = 'singularitycontextproviders', // comma-separated list of context providers IDs (case sensitive) to enable
	IncludeNeighboringFiles = 'singularityincludeneighboringfiles', // Always include neighboring files alongside context providers
	ExcludeRelatedFiles = 'singularityexcluderelatedfiles', // Exclude related files even if neighboring files are enabled
	ContextProviderTimeBudget = 'singularitycontextprovidertimebudget', // time budget for context providers in milliseconds

	/**
	 * Values to control the ContextProvider API's CodeSnippets provided by the C++ Language Service.
	 */
	CppContextProviderParams = 'singularitycppContextProviderParams',

	/**
	 * Values to control the ContextProvider API's CodeSnippets provided by the C# Language Service.
	 */
	CSharpContextProviderParams = 'singularitycsharpcontextproviderparams',

	/**
	 * Values to control the ContextProvider API's CodeSnippets provided by the Java Language Service.
	 */
	JavaContextProviderParams = 'singularityjavacontextproviderparams',

	/**
	 * Values to control the MultiLanguageContextProvider parameters.
	 */
	MultiLanguageContextProviderParams = 'singularitymultilanguagecontextproviderparams',

	/**
	 * Values to control the TsContextProvider parameters.
	 */
	TsContextProviderParams = 'singularitytscontextproviderparams',

	/**
	 * Controls the delay to apply to debouncing of completion requests.
	 */
	CompletionsDebounce = 'singularitycompletionsdebounce',

	/**
	 * Enable the electron networking in VS Code.
	 */
	ElectronFetcher = 'singularityelectronfetcher',
	FetchFetcher = 'singularityfetchfetcher',

	/**
	 * Sets the timeout for waiting for async completions in flight before
	 * issuing a new network request. Set to -1 to disable the timeout entirely.
	 */
	AsyncCompletionsTimeout = 'singularityasynccompletionstimeout',

	/**
	 * Controls whether the prompt context for code completions needs to be split from the document prefix.
	 */
	EnablePromptContextProxyField = 'singularityenablepromptcontextproxyfield',

	/**
	 * Controls progressive reveal of completions.
	 */
	ProgressiveReveal = 'singularityprogressivereveal',
	// part of progressive reveal, controls whether the model or client terminates single-line completions
	ModelAlwaysTerminatesSingleline = 'singularitymodelterminatesingleline',
	// long look-ahead window size (in lines) for progressive reveal
	ProgressiveRevealLongLookaheadSize = 'singularityprogressivereveallonglookaheadsize',
	// short look-ahead window size (in lines) for progressive reveal
	ProgressiveRevealShortLookaheadSize = 'singularityprogressiverevealshortlookaheadsize',
	// maximum token count when requesting multi-line completions
	MaxMultilineTokens = 'singularitymaxmultilinetokens',

	/**
	 * Controls number of lines to trim to after accepting a completion.
	 */
	MultilineAfterAcceptLines = 'singularitymultilineafteracceptlines',

	/**
	 * Add a delay before rendering completions.
	 */
	CompletionsDelay = 'singularitycompletionsdelay',

	/**
	 * Request single line completions unless the previous completion was just accepted.
	 */
	SingleLineUnlessAccepted = 'singularitysinglelineunlessaccepted',
}

export type ExpTreatmentVariableValue = boolean | string | number;

export class ExpConfig {
	variables: Partial<Record<ExpTreatmentVariables, ExpTreatmentVariableValue>>; // for the 'vscode' config
	features: string; // semicolon-separated feature IDs

	constructor(
		variables: Partial<Record<ExpTreatmentVariables, ExpTreatmentVariableValue>>,
		features: string
	) {
		this.variables = variables;
		this.features = features;
	}

	static createFallbackConfig(accessor: ServicesAccessor, reason: string): ExpConfig {
		telemetryExpProblem(accessor, { reason });
		return this.createEmptyConfig();
	}

	static createEmptyConfig() {
		return new ExpConfig({}, '');
	}

	/**
	 * Adds (or overwrites) the given experiment config to the telemetry data.
	 * @param telemetryData telemetryData object. If previous ExpConfigs are already present, they will be overwritten.
	 */
	addToTelemetry(telemetryData: TelemetryData): void {
		telemetryData.properties[ExpServiceTelemetryNames.featuresTelemetryPropertyName] = this.features;
	}
}
