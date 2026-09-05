/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Commands ending with "Client" refer to the command ID used in the legacy Singularity extension.
// - These IDs should not appear in the package.json file
// - These IDs should be registered to support all functionality (except if this command needs to be supported when both extensions are loaded/active).
// Commands ending with "Chat" refer to the command ID used in the Singularity AI extension.
// - These IDs should be used in package.json
// - These IDs should only be registered if they appear in the package.json (meaning the command palette) or if the command needs to be supported when both extensions are loaded/active.

export const CMDOpenPanelClient = 'singularity.chat.generate';
export const CMDOpenPanelChat = 'singularity.chat.chat.openSuggestionsPanel'; // "singularity.chat.chat.generate" is already being used

export const CMDAcceptCursorPanelSolutionClient = 'singularity.chat.acceptCursorPanelSolution';
export const CMDNavigatePreviousPanelSolutionClient = 'singularity.chat.previousPanelSolution';
export const CMDNavigateNextPanelSolutionClient = 'singularity.chat.nextPanelSolution';

export const CMDToggleStatusMenuClient = 'singularity.chat.toggleStatusMenu';
export const CMDToggleStatusMenuChat = 'singularity.chat.chat.toggleStatusMenu';

// Needs to be supported in both extensions when they are loaded/active. Requires a different ID.
export const CMDSendCompletionsFeedbackChat = 'singularity.chat.chat.sendCompletionFeedback';

export const CMDEnableCompletionsChat = 'singularity.chat.chat.completions.enable';
export const CMDDisableCompletionsChat = 'singularity.chat.chat.completions.disable';
export const CMDToggleCompletionsChat = 'singularity.chat.chat.completions.toggle';
export const CMDEnableCompletionsClient = 'singularity.chat.completions.enable';
export const CMDDisableCompletionsClient = 'singularity.chat.completions.disable';
export const CMDToggleCompletionsClient = 'singularity.chat.completions.toggle';

export const CMDOpenLogsClient = 'singularity.chat.openLogs';
export const CMDOpenDocumentationClient = 'singularity.chat.openDocs';

// Existing chat command reused for diagnostics
export const CMDCollectDiagnosticsChat = 'singularity.chat.debug.collectDiagnostics';

// Context variable that enable/disable panel-specific commands
export const SingularityPanelVisible = 'singularity.chat.panelVisible';
export const ComparisonPanelVisible = 'singularity.chat.comparisonPanelVisible';
export const HasMultipleCompletionModels = 'singularity.chat.completions.hasMultipleModels';

export const CMDOpenModelPickerClient = 'singularity.chat.openModelPicker';
export const CMDOpenModelPickerChat = 'singularity.chat.chat.openModelPicker';