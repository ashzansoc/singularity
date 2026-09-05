/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
"use strict";
const fs = require('fs');
const path = require('path');
process.env.DEBUG = 'pw:install'; // enable logging for this (https://github.com/microsoft/playwright/issues/17394)

/**
 * Some installs leave playwright-core/lib/utilsBundle.js missing while keeping
 * the sibling .LICENSE file. Browser tools then fail with:
 *   Cannot find module './utilsBundle'
 * Restore from a nested playwright-core copy or re-extract from the npm tarball.
 */
function ensureUtilsBundle() {
	const root = path.join(__dirname, '..', '..', '..');
	const target = path.join(root, 'node_modules', 'playwright-core', 'lib', 'utilsBundle.js');
	if (fs.existsSync(target)) {
		return;
	}
	const candidates = [
		path.join(root, 'node_modules', 'playwright', 'node_modules', 'playwright-core', 'lib', 'utilsBundle.js'),
		path.join(root, 'node_modules', '@playwright', 'browser-chromium', 'node_modules', 'playwright-core', 'lib', 'utilsBundle.js'),
	];
	for (const src of candidates) {
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, target);
			console.log(`[installPlaywright] Restored missing utilsBundle.js from ${src}`);
			return;
		}
	}
	console.warn('[installPlaywright] WARNING: playwright-core/lib/utilsBundle.js is missing; open_browser_page will fail until you reinstall playwright-core');
}

ensureUtilsBundle();
const { installDefaultBrowsersForNpmInstall } = require('playwright-core/lib/server');
async function install() {
	await installDefaultBrowsersForNpmInstall();
}
install();
//# sourceMappingURL=installPlaywright.js.map
