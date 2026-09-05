/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SingularityTelemetryReporter } from '../telemetry';

export class NoopSingularityTelemetryReporter implements SingularityTelemetryReporter {
	sendTelemetryEvent(): void {
		// noop
	}
	sendTelemetryErrorEvent(): void {
		// noop
	}
	dispose(): Promise<void> {
		return Promise.resolve();
	}
}
