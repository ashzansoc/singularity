/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { Color } from '../../../../base/common/color.js';
import { IColorTheme, IThemeService, IFileIconTheme, IProductIconTheme } from '../../../../platform/theme/common/themeService.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { isBoolean, isString } from '../../../../base/common/types.js';
import { IconContribution, IconDefinition } from '../../../../platform/theme/common/iconRegistry.js';
import { ColorScheme, ThemeTypeSelector } from '../../../../platform/theme/common/theme.js';

export const IWorkbenchThemeService = refineServiceDecorator<IThemeService, IWorkbenchThemeService>(IThemeService);

export const THEME_SCOPE_OPEN_PAREN = '[';
export const THEME_SCOPE_CLOSE_PAREN = ']';
export const THEME_SCOPE_WILDCARD = '*';

export const themeScopeRegex = /\[(.+?)\]/g;

export enum ThemeSettings {
	COLOR_THEME = 'workbench.colorTheme',
	FILE_ICON_THEME = 'workbench.iconTheme',
	PRODUCT_ICON_THEME = 'workbench.productIconTheme',
	COLOR_CUSTOMIZATIONS = 'workbench.colorCustomizations',
	TOKEN_COLOR_CUSTOMIZATIONS = 'editor.tokenColorCustomizations',
	SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS = 'editor.semanticTokenColorCustomizations',

	PREFERRED_DARK_THEME = 'workbench.preferredDarkColorTheme',
	PREFERRED_LIGHT_THEME = 'workbench.preferredLightColorTheme',
	PREFERRED_HC_DARK_THEME = 'workbench.preferredHighContrastColorTheme', /* id kept for compatibility reasons */
	PREFERRED_HC_LIGHT_THEME = 'workbench.preferredHighContrastLightColorTheme',
	DETECT_COLOR_SCHEME = 'window.autoDetectColorScheme',
	DETECT_HC = 'window.autoDetectHighContrast',

	SYSTEM_COLOR_THEME = 'window.systemColorTheme'
}

export namespace ThemeSettingDefaults {
	export const COLOR_THEME_DARK = 'Singularity Dark';
	export const COLOR_THEME_LIGHT = 'Singularity Light';
	export const COLOR_THEME_HC_DARK = 'Default High Contrast';
	export const COLOR_THEME_HC_LIGHT = 'Default High Contrast Light';

	export const FILE_ICON_THEME = 'material-icon-theme';
	export const PRODUCT_ICON_THEME = 'material-product-icons';
}

/**
 * Migrates legacy theme settings IDs to their current equivalents.
 * Theme IDs were simplified: "Default" prefix was removed from built-in themes,
 * and "Experimental" prefix was replaced when VS Code themes became GA.
 */
export function migrateThemeSettingsId(settingsId: string): string {
	switch (settingsId) {
		case 'Default Dark Modern': return 'Dark Modern';
		case 'Default Light Modern': return 'Light Modern';
		case 'Default Dark+': return 'Dark+';
		case 'Default Light+': return 'Light+';
		case 'Experimental Dark':
		case 'VS Code Dark':
			return ThemeSettingDefaults.COLOR_THEME_DARK;
		case 'Experimental Light':
		case 'VS Code Light':
			return ThemeSettingDefaults.COLOR_THEME_LIGHT;
	}
	return settingsId;
}

export function migrateFileIconThemeSettingsId(settingsId: string): string {
	switch (settingsId) {
		case 'vs-seti':
			return ThemeSettingDefaults.FILE_ICON_THEME;
	}
	return settingsId;
}

export function migrateProductIconThemeSettingsId(settingsId: string): string {
	switch (settingsId) {
		case 'Default':
			return ThemeSettingDefaults.PRODUCT_ICON_THEME;
	}
	return settingsId;
}

export const COLOR_THEME_DARK_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#FFFFFF22',
	'activityBar.activeBorder': '#00000000',
	'activityBar.background': '#0F0F0F',
	'activityBar.border': '#FFFFFF14',
	'activityBar.foreground': '#D6D6D6',
	'activityBar.inactiveForeground': '#7A7A7A',
	'activityBarBadge.background': '#1A1A1A',
	'activityBarBadge.foreground': '#FFFFFF',
	'badge.background': '#1A1A1A',
	'badge.foreground': '#FFFFFF',
	'button.background': '#2A2A2A',
	'button.border': '#383838',
	'button.foreground': '#FFFFFF',
	'button.hoverBackground': '#383838',
	'button.secondaryBackground': '#FFFFFF14',
	'button.secondaryForeground': '#D6D6D6',
	'button.secondaryHoverBackground': '#FFFFFF22',
	'chat.slashCommandBackground': '#FFFFFF22',
	'chat.slashCommandForeground': '#D6D6D6',
	'chat.editedFileForeground': '#E2C08D',
	'checkbox.background': '#0F0F0FCC',
	'checkbox.border': '#FFFFFF33',
	'debugToolBar.background': '#0F0F0F',
	'descriptionForeground': '#9E9E9E',
	'dropdown.background': '#0F0F0FE6',
	'dropdown.border': '#FFFFFF1F',
	'dropdown.foreground': '#D6D6D6',
	'dropdown.listBackground': '#0F0F0FF2',
	'editor.background': '#0F0F0F',
	'editor.findMatchBackground': '#FFFFFF33',
	'editor.foreground': '#C8C8C8',
	'editor.inactiveSelectionBackground': '#FFFFFF18',
	'editor.selectionHighlightBackground': '#FFFFFF14',
	'editorGroup.border': '#FFFFFF14',
	'editorGroupHeader.tabsBackground': '#0F0F0F',
	'editorGroupHeader.tabsBorder': '#0F0F0F00',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#888888',
	'editorIndentGuide.activeBackground1': '#707070',
	'editorIndentGuide.background1': '#404040',
	'editorLineNumber.activeForeground': '#9A9A9A',
	'editorLineNumber.foreground': '#1A1A1A',
	'editorOverviewRuler.border': '#0F0F0F',
	'editorWidget.background': '#141414',
	'errorForeground': '#FF6B7A',
	'focusBorder': '#FFFFFF18',
	'foreground': '#D6D6D6',
	'icon.foreground': '#9A9A9A',
	'input.background': '#0F0F0F',
	'input.border': '#FFFFFF22',
	'input.foreground': '#D6D6D6',
	'input.placeholderForeground': '#6E6E6E',
	'inputOption.activeBackground': '#FFFFFF1F',
	'inputOption.activeBorder': '#888888',
	'keybindingLabel.foreground': '#D6D6D6',
	'list.activeSelectionIconForeground': '#FFF',
	'list.dropBackground': '#FFFFFF18',
	'menu.background': '#141414',
	'menu.border': '#0F0F0F00',
	'menu.foreground': '#D6D6D6',
	'menu.selectionBackground': '#2A2A2A',
	'menu.separatorBackground': '#FFFFFF1A',
	'notificationCenterHeader.background': '#0F0F0FE6',
	'notificationCenterHeader.foreground': '#D6D6D6',
	'notifications.background': '#141414',
	'notifications.border': '#0F0F0F00',
	'notifications.foreground': '#D6D6D6',
	'panel.background': '#0F0F0F',
	'panel.border': '#FFFFFF14',
	'panelInput.border': '#0F0F0F00',
	'panelTitle.activeBorder': '#0F0F0F00',
	'panelTitle.activeForeground': '#D6D6D6',
	'panelTitle.inactiveForeground': '#7A7A7A',
	'peekViewEditor.background': '#0F0F0F',
	'peekViewEditor.matchHighlightBackground': '#FFFFFF22',
	'peekViewResult.background': '#0F0F0F',
	'peekViewResult.matchHighlightBackground': '#FFFFFF22',
	'pickerGroup.border': '#FFFFFF1F',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#787878',
	'quickInput.background': '#141414',
	'quickInput.foreground': '#D6D6D6',
	'settings.dropdownBackground': '#0F0F0FE6',
	'settings.dropdownBorder': '#FFFFFF1F',
	'settings.headerForeground': '#FFFFFF',
	'settings.modifiedItemIndicator': '#FFFFFF33',
	'sideBar.background': '#0F0F0F48',
	'sideBar.border': '#FFFFFF14',
	'sideBar.foreground': '#D6D6D6',
	'sideBarSectionHeader.background': '#0F0F0F30',
	'sideBarSectionHeader.border': '#FFFFFF14',
	'sideBarSectionHeader.foreground': '#D6D6D6',
	'sideBarTitle.foreground': '#D6D6D6',
	'statusBar.background': '#0F0F0F73',
	'statusBar.border': '#FFFFFF14',
	'statusBar.debuggingBackground': '#1A1A1A',
	'statusBar.debuggingForeground': '#FFFFFF',
	'statusBar.focusBorder': '#888888',
	'statusBar.foreground': '#9A9A9A',
	'statusBar.noFolderBackground': '#0F0F0F73',
	'statusBarItem.focusBorder': '#888888',
	'statusBarItem.prominentBackground': '#FFFFFF33',
	'statusBarItem.remoteBackground': '#1A1A1A',
	'statusBarItem.remoteForeground': '#FFFFFF',
	'tab.activeBackground': '#0F0F0F',
	'tab.activeBorder': '#0F0F0F',
	'tab.activeBorderTop': '#0F0F0F00',
	'tab.activeForeground': '#FFFFFF',
	'tab.border': '#0F0F0F00',
	'tab.hoverBackground': '#141414',
	'tab.inactiveBackground': '#0F0F0F',
	'tab.inactiveForeground': '#7A7A7A',
	'tab.lastPinnedBorder': '#FFFFFF22',
	'tab.selectedBackground': '#FFFFFF18',
	'tab.selectedBorderTop': '#B0B0B0',
	'tab.selectedForeground': '#FFFFFF',
	'tab.unfocusedActiveBorder': '#0F0F0F',
	'tab.unfocusedActiveBorderTop': '#FFFFFF14',
	'tab.unfocusedHoverBackground': '#141414',
	'terminal.foreground': '#C8C8C8',
	'terminal.inactiveSelectionBackground': '#FFFFFF18',
	'terminal.tab.activeBorder': '#0F0F0F00',
	'textBlockQuote.background': '#0F0F0F',
	'textBlockQuote.border': '#FFFFFF33',
	'textCodeBlock.background': '#0F0F0F',
	'textLink.activeForeground': '#D6D6D6',
	'textLink.foreground': '#B0B0B0',
	'textPreformat.background': '#141414',
	'textPreformat.foreground': '#C0C0C0',
	'textSeparator.foreground': '#FFFFFF1A',
	'titleBar.activeBackground': '#0F0F0F',
	'titleBar.activeForeground': '#D6D6D6',
	'titleBar.border': '#FFFFFF14',
	'titleBar.inactiveBackground': '#0F0F0F',
	'titleBar.inactiveForeground': '#7A7A7A',
	'welcomePage.progress.foreground': '#888888',
	'welcomePage.tileBackground': '#0F0F0F',
	'widget.border': '#0F0F0F00'
};

export const COLOR_THEME_LIGHT_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#0F0F0F14',
	'activityBar.activeBorder': '#5A5A5A',
	'activityBar.background': '#F3F3F3E6',
	'activityBar.border': '#00000014',
	'activityBar.foreground': '#1E1E1E',
	'activityBar.inactiveForeground': '#6E6E6E',
	'activityBarBadge.background': '#5A5A5A',
	'activityBarBadge.foreground': '#FFFFFF',
	'badge.background': '#5A5A5A',
	'badge.foreground': '#FFFFFF',
	'button.background': '#3A3A3A',
	'button.border': '#3A3A3A',
	'button.foreground': '#FFFFFF',
	'button.hoverBackground': '#404040',
	'button.secondaryBackground': '#0000000F',
	'button.secondaryForeground': '#1E1E1E',
	'button.secondaryHoverBackground': '#00000014',
	'chat.slashCommandBackground': '#00000014',
	'chat.slashCommandForeground': '#404040',
	'chat.editedFileForeground': '#895503',
	'checkbox.background': '#FFFFFFCC',
	'checkbox.border': '#00000022',
	'descriptionForeground': '#5A5A5A',
	'diffEditor.unchangedRegionBackground': '#F3F3F3',
	'dropdown.background': '#FFFFFFE6',
	'dropdown.border': '#0000001A',
	'dropdown.foreground': '#1E1E1E',
	'dropdown.listBackground': '#FFFFFFF2',
	'editor.background': '#FFFFFF',
	'editor.foreground': '#252525',
	'editor.inactiveSelectionBackground': '#00000014',
	'editor.selectionHighlightBackground': '#00000012',
	'editorGroup.border': '#00000014',
	'editorGroupHeader.tabsBackground': '#EEEEEEE6',
	'editorGroupHeader.tabsBorder': '#00000014',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#5A5A5A',
	'editorIndentGuide.activeBackground1': '#939393',
	'editorIndentGuide.background1': '#D3D3D3',
	'editorLineNumber.activeForeground': '#5A5A5A',
	'editorLineNumber.foreground': '#6E7681',
	'editorOverviewRuler.border': '#E5E5E5',
	'editorSuggestWidget.background': '#FFFFFFF2',
	'editorWidget.background': '#FFFFFFF2',
	'errorForeground': '#C62828',
	'focusBorder': '#5A5A5A',
	'foreground': '#1E1E1E',
	'icon.foreground': '#4A4A4A',
	'input.background': '#FFFFFFD9',
	'input.border': '#0000001A',
	'input.foreground': '#1E1E1E',
	'input.placeholderForeground': '#7A7A7A',
	'inputOption.activeBackground': '#00000018',
	'inputOption.activeBorder': '#5A5A5A',
	'inputOption.activeForeground': '#000000',
	'keybindingLabel.foreground': '#1E1E1E',
	'list.activeSelectionBackground': '#00000014',
	'list.activeSelectionForeground': '#1E1E1E',
	'list.activeSelectionIconForeground': '#1E1E1E',
	'list.focusAndSelectionOutline': '#5A5A5A',
	'list.hoverBackground': '#0000000A',
	'menu.border': '#0000001A',
	'menu.selectionBackground': '#3A3A3A',
	'menu.selectionForeground': '#FFFFFF',
	'notebook.cellBorderColor': '#00000014',
	'notebook.selectedCellBackground': '#0000000F',
	'notificationCenterHeader.background': '#FFFFFFF2',
	'notificationCenterHeader.foreground': '#1E1E1E',
	'notifications.background': '#FFFFFFF2',
	'notifications.border': '#0000001A',
	'notifications.foreground': '#1E1E1E',
	'panel.background': '#EEEEEEE6',
	'panel.border': '#00000014',
	'panelInput.border': '#00000014',
	'panelTitle.activeBorder': '#5A5A5A',
	'panelTitle.activeForeground': '#1E1E1E',
	'panelTitle.inactiveForeground': '#6E6E6E',
	'peekViewEditor.matchHighlightBackground': '#0000001A',
	'peekViewResult.background': '#FFFFFFF2',
	'peekViewResult.matchHighlightBackground': '#0000001A',
	'pickerGroup.border': '#0000001A',
	'pickerGroup.foreground': '#606060',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#5A5A5A',
	'quickInput.background': '#FFFFFFF2',
	'quickInput.foreground': '#1E1E1E',
	'settings.dropdownBackground': '#FFFFFFE6',
	'settings.dropdownBorder': '#0000001A',
	'settings.headerForeground': '#1E1E1E',
	'settings.modifiedItemIndicator': '#80808066',
	'sideBar.background': '#EEEEEEE6',
	'sideBar.border': '#00000014',
	'sideBar.foreground': '#1E1E1E',
	'sideBarSectionHeader.background': '#EEEEEECC',
	'sideBarSectionHeader.border': '#00000014',
	'sideBarSectionHeader.foreground': '#1E1E1E',
	'sideBarTitle.foreground': '#1E1E1E',
	'statusBar.background': '#F3F3F3E6',
	'statusBar.border': '#00000014',
	'statusBar.debuggingBackground': '#5A5A5A',
	'statusBar.debuggingForeground': '#FFFFFF',
	'statusBar.focusBorder': '#5A5A5A',
	'statusBar.foreground': '#4A4A4A',
	'statusBar.noFolderBackground': '#F3F3F3E6',
	'statusBarItem.focusBorder': '#5A5A5A',
	'statusBarItem.prominentBackground': '#80808066',
	'statusBarItem.remoteBackground': '#5A5A5A',
	'statusBarItem.remoteForeground': '#FFFFFF',
	'tab.activeBackground': '#FFFFFF',
	'tab.activeBorder': '#FFFFFF',
	'tab.activeBorderTop': '#5A5A5A',
	'tab.activeForeground': '#1E1E1E',
	'tab.border': '#00000014',
	'tab.hoverBackground': '#FFFFFF',
	'tab.inactiveBackground': '#EEEEEECC',
	'tab.inactiveForeground': '#6E6E6E',
	'tab.lastPinnedBorder': '#0000001A',
	'tab.selectedBackground': '#0000000F',
	'tab.selectedBorderTop': '#606060',
	'tab.selectedForeground': '#1E1E1E',
	'tab.unfocusedActiveBorder': '#FFFFFF',
	'tab.unfocusedActiveBorderTop': '#00000014',
	'tab.unfocusedHoverBackground': '#FFFFFF',
	'terminal.foreground': '#252525',
	'terminal.inactiveSelectionBackground': '#00000014',
	'terminal.tab.activeBorder': '#5A5A5A',
	'textBlockQuote.background': '#F0F0F0E6',
	'textBlockQuote.border': '#80808066',
	'textCodeBlock.background': '#F0F0F0E6',
	'textLink.activeForeground': '#404040',
	'textLink.foreground': '#404040',
	'textPreformat.background': '#EBEBEB',
	'textPreformat.foreground': '#3A3A3A',
	'textSeparator.foreground': '#00000014',
	'titleBar.activeBackground': '#F3F3F3E6',
	'titleBar.activeForeground': '#1E1E1E',
	'titleBar.border': '#00000014',
	'titleBar.inactiveBackground': '#F3F3F3CC',
	'titleBar.inactiveForeground': '#6E6E6E',
	'welcomePage.progress.foreground': '#5A5A5A',
	'welcomePage.tileBackground': '#F0F0F0E6',
	'widget.border': '#0000001A'
};

export interface IWorkbenchTheme {
	readonly id: string;
	readonly label: string;
	readonly extensionData?: ExtensionData;
	readonly description?: string;
	readonly settingsId: string | null;
}

export interface IWorkbenchColorTheme extends IWorkbenchTheme, IColorTheme {
	readonly settingsId: string;
	readonly tokenColors: ITextMateThemingRule[];
}

export interface IColorMap {
	[id: string]: Color;
}

export interface IWorkbenchFileIconTheme extends IWorkbenchTheme, IFileIconTheme {
}

export interface IWorkbenchProductIconTheme extends IWorkbenchTheme, IProductIconTheme {
	readonly settingsId: string;

	getIcon(icon: IconContribution): IconDefinition | undefined;
}

export type ThemeSettingTarget = ConfigurationTarget | undefined | 'auto' | 'preview';


export interface IWorkbenchThemeService extends IThemeService {
	readonly _serviceBrand: undefined;
	setColorTheme(themeId: string | undefined | IWorkbenchColorTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchColorTheme | null>;
	getColorTheme(): IWorkbenchColorTheme;
	getColorThemes(): Promise<IWorkbenchColorTheme[]>;
	getMarketplaceColorThemes(publisher: string, name: string, version: string): Promise<IWorkbenchColorTheme[]>;
	readonly onDidColorThemeChange: Event<IWorkbenchColorTheme>;

	getPreferredColorScheme(): ColorScheme | undefined;

	setFileIconTheme(iconThemeId: string | undefined | IWorkbenchFileIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchFileIconTheme>;
	getFileIconTheme(): IWorkbenchFileIconTheme;
	getFileIconThemes(): Promise<IWorkbenchFileIconTheme[]>;
	getMarketplaceFileIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchFileIconTheme[]>;
	readonly onDidFileIconThemeChange: Event<IWorkbenchFileIconTheme>;

	setProductIconTheme(iconThemeId: string | undefined | IWorkbenchProductIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchProductIconTheme>;
	getProductIconTheme(): IWorkbenchProductIconTheme;
	getProductIconThemes(): Promise<IWorkbenchProductIconTheme[]>;
	getMarketplaceProductIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchProductIconTheme[]>;
	readonly onDidProductIconThemeChange: Event<IWorkbenchProductIconTheme>;
}

export interface IThemeScopedColorCustomizations {
	[colorId: string]: string;
}

export interface IColorCustomizations {
	[colorIdOrThemeScope: string]: IThemeScopedColorCustomizations | string;
}

export interface IThemeScopedTokenColorCustomizations {
	[groupId: string]: ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface ITokenColorCustomizations {
	[groupIdOrThemeScope: string]: IThemeScopedTokenColorCustomizations | ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface IThemeScopedSemanticTokenColorCustomizations {
	[styleRule: string]: ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface ISemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedSemanticTokenColorCustomizations | ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface IThemeScopedExperimentalSemanticTokenColorCustomizations {
	[themeScope: string]: ISemanticTokenRules | undefined;
}

export interface IExperimentalSemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedExperimentalSemanticTokenColorCustomizations | ISemanticTokenRules | undefined;
}

export type IThemeScopedCustomizations =
	IThemeScopedColorCustomizations
	| IThemeScopedTokenColorCustomizations
	| IThemeScopedExperimentalSemanticTokenColorCustomizations
	| IThemeScopedSemanticTokenColorCustomizations;

export type IThemeScopableCustomizations =
	IColorCustomizations
	| ITokenColorCustomizations
	| IExperimentalSemanticTokenColorCustomizations
	| ISemanticTokenColorCustomizations;

export interface ISemanticTokenRules {
	[selector: string]: string | ISemanticTokenColorizationSetting | undefined;
}

export interface ITextMateThemingRule {
	name?: string;
	scope?: string | string[];
	settings: ITokenColorizationSetting;
}

export interface ITokenColorizationSetting {
	foreground?: string;
	background?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
}

export interface ISemanticTokenColorizationSetting {
	foreground?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	bold?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	italic?: boolean;
}

export interface ExtensionData {
	extensionId: string;
	extensionPublisher: string;
	extensionName: string;
	extensionIsBuiltin: boolean;
}

export namespace ExtensionData {
	export function toJSONObject(d: ExtensionData | undefined): any {
		return d && { _extensionId: d.extensionId, _extensionIsBuiltin: d.extensionIsBuiltin, _extensionName: d.extensionName, _extensionPublisher: d.extensionPublisher };
	}
	export function fromJSONObject(o: any): ExtensionData | undefined {
		if (o && isString(o._extensionId) && isBoolean(o._extensionIsBuiltin) && isString(o._extensionName) && isString(o._extensionPublisher)) {
			return { extensionId: o._extensionId, extensionIsBuiltin: o._extensionIsBuiltin, extensionName: o._extensionName, extensionPublisher: o._extensionPublisher };
		}
		return undefined;
	}
	export function fromName(publisher: string, name: string, isBuiltin = false): ExtensionData {
		return { extensionPublisher: publisher, extensionId: `${publisher}.${name}`, extensionName: name, extensionIsBuiltin: isBuiltin };
	}
}

export interface IThemeExtensionPoint {
	id: string;
	label?: string;
	description?: string;
	path: string;
	uiTheme?: ThemeTypeSelector;
	_watch: boolean; // unsupported options to watch location
}
