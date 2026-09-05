/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogger } from '../../../../../platform/log/common/logService';
import { ISingularityCLISessionTracker } from '../singularityCLISessionTracker';
import { InProcHttpServer } from '../inProcHttpServer';
import { sendEditorContextToSession, sendUriToSession } from './sendContext';

export const ADD_FILE_REFERENCE_COMMAND = 'singularity.chat.chat.singularityCLI.addFileReference';

export function registerAddFileReferenceCommand(logger: ILogger, httpServer: InProcHttpServer, sessionTracker: ISingularityCLISessionTracker): vscode.Disposable {
	return vscode.commands.registerCommand(ADD_FILE_REFERENCE_COMMAND, async (uri?: vscode.Uri) => {
		logger.debug('Add file reference command executed');

		if (uri) {
			await sendUriToSession(logger, httpServer, sessionTracker, uri);
		} else {
			await sendEditorContextToSession(logger, httpServer, sessionTracker);
		}
	});
}
