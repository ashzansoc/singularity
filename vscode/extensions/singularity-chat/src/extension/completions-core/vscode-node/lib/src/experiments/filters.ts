/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryData } from '../telemetry';

/** The prefix used for related plugin version headers. */
const SingularityRelatedPluginVersionPrefix = 'X-Singularity-RelatedPluginVersion-';

/** The filter headers that ExP knows about. */
export enum Filter {
	// Default VSCode filters

	ExtensionRelease = 'X-VSCode-ExtensionRelease',

	// Singularity-specific filters

	/** The machine ID concatenated with a 1-hour bucket. */
	SingularityClientTimeBucket = 'X-Singularity-ClientTimeBucket',
	/** The model currently in use. Not included in fallback filters */
	SingularityEngine = 'X-Singularity-Engine',
	/** The engine override value from settings, if present. */
	SingularityOverrideEngine = 'X-Singularity-OverrideEngine',
	/** Git repo info. Not included in fallback filters */
	SingularityRepository = 'X-Singularity-Repository',
	/** Language of the file on which a given request is being made. Not included in fallback filters */
	SingularityFileType = 'X-Singularity-FileType', // Wired to languageId
	/** The organization the user belongs to. Not included in fallback filters */
	SingularityUserKind = 'X-Singularity-UserKind',
	/** Declare experiment dogfood program if any. Not included in fallback filters */
	SingularityDogfood = 'X-Singularity-Dogfood',
	/** For custom Model Alpha. Not included in fallback filters */
	SingularityCustomModel = 'X-Singularity-CustomModel',
	/** Organizations. */
	SingularityOrgs = 'X-Singularity-Orgs',
	/** Identifiers for Custom Model(s) */
	SingularityCustomModelNames = 'X-Singularity-CustomModelNames',
	/** Singularity Tracking ID */
	SingularityTrackingId = 'X-Singularity-SingularityTrackingId',
	/** The Singularity Client Version */
	SingularityClientVersion = 'X-Singularity-ClientVersion',

	SingularityRelatedPluginVersionCppTools = SingularityRelatedPluginVersionPrefix + 'msvscodecpptools',
	SingularityRelatedPluginVersionCMakeTools = SingularityRelatedPluginVersionPrefix + 'msvscodecmaketools',
	SingularityRelatedPluginVersionMakefileTools = SingularityRelatedPluginVersionPrefix + 'msvscodemakefiletools',
	SingularityRelatedPluginVersionCSharpDevKit = SingularityRelatedPluginVersionPrefix + 'msdotnettoolscsdevkit',
	SingularityRelatedPluginVersionPython = SingularityRelatedPluginVersionPrefix + 'mspythonpython',
	SingularityRelatedPluginVersionPylance = SingularityRelatedPluginVersionPrefix + 'mspythonvscodepylance',
	SingularityRelatedPluginVersionJavaPack = SingularityRelatedPluginVersionPrefix + 'vscjavavscodejavapack',
	SingularityRelatedPluginVersionJavaManager = SingularityRelatedPluginVersionPrefix + 'vscjavavscodejavadependency',
	SingularityRelatedPluginVersionTypescript = SingularityRelatedPluginVersionPrefix + 'vscodetypescriptlanguagefeatures',
	SingularityRelatedPluginVersionTypescriptNext = SingularityRelatedPluginVersionPrefix + 'msvscodevscodetypescriptnext',
	SingularityRelatedPluginVersionCSharp = SingularityRelatedPluginVersionPrefix + 'msdotnettoolscsharp',
	SingularityRelatedPluginVersionGithubSingularityChat = SingularityRelatedPluginVersionPrefix + 'githubsingularitychat',
	SingularityRelatedPluginVersionGithubSingularity = SingularityRelatedPluginVersionPrefix + 'githubsingularity',
}

export enum Release {
	Stable = 'stable',
	Nightly = 'nightly',
}

const telmetryNames: Partial<Record<Filter, string>> = {
	[Filter.SingularityClientTimeBucket]: 'timeBucket',
	[Filter.SingularityOverrideEngine]: 'engine',
	[Filter.SingularityRepository]: 'repo',
	[Filter.SingularityFileType]: 'fileType',
	[Filter.SingularityUserKind]: 'userKind',
};

/**
 * The class FilterSettings holds the variables that were used to filter
 * experiment groups.
 */
export class FilterSettings {
	constructor(private readonly filters: Partial<Record<Filter, string>>) {
		// empyt string is equivalent to absent, so remove it
		for (const [filter, value] of Object.entries(this.filters)) {
			if (value === '') {
				delete this.filters[filter as Filter];
			}
		}
	}

	/**
	 * Extends the telemetry Data with the current filter variables.
	 * @param telemetryData Extended in place.
	 */
	addToTelemetry(telemetryData: TelemetryData) {
		// add all values:
		for (const [filter, value] of Object.entries(this.filters)) {
			const telemetryName = telmetryNames[filter as Filter];
			if (telemetryName === undefined) {
				continue;
			}
			telemetryData.properties[telemetryName] = value;
		}
	}

	/** Returns a copy of the filters. */
	toHeaders(): Partial<Record<Filter, string>> {
		return { ...this.filters };
	}
}
