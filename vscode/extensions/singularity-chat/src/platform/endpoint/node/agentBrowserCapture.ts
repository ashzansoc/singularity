/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent-mode visual capture — Playwright screenshots at desktop/laptop/mobile.
 * Falls back gracefully when no preview is listening.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

export const AGENT_VISUAL_VIEWPORTS = [
	{ width: 1440, height: 900, name: 'desktop' },
	{ width: 1024, height: 768, name: 'laptop' },
	{ width: 390, height: 844, name: 'mobile' },
] as const;

export interface AgentViewportCapture {
	url: string;
	viewport: { width: number; height: number; name: string };
	screenshotPath?: string;
	title?: string;
	domSummary?: string;
	consoleErrors: string[];
	runtimeErrors: string[];
}

export interface AgentCaptureResult {
	previewAvailable: boolean;
	url?: string;
	captures: AgentViewportCapture[];
	note?: string;
}

function probeUrl(url: string, timeoutMs = 1500): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const lib = url.startsWith('https') ? https : http;
			const req = lib.get(url, { timeout: timeoutMs }, (res) => {
				res.resume();
				resolve((res.statusCode ?? 500) < 500);
			});
			req.on('error', () => resolve(false));
			req.on('timeout', () => {
				req.destroy();
				resolve(false);
			});
		} catch {
			resolve(false);
		}
	});
}

function inferCandidateUrls(workspaceRoot: string): string[] {
	const urls = [
		'http://127.0.0.1:3000',
		'http://localhost:3000',
		'http://127.0.0.1:5173',
		'http://localhost:5173',
		'http://127.0.0.1:4173',
		'http://localhost:4173',
		'http://127.0.0.1:8080',
		'http://localhost:8080',
	];
	try {
		const pkgPath = path.join(workspaceRoot, 'package.json');
		if (fs.existsSync(pkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
				scripts?: Record<string, string>;
			};
			const scripts = Object.values(pkg.scripts ?? {}).join(' ');
			if (/next/i.test(scripts)) {
				urls.unshift('http://127.0.0.1:3000', 'http://localhost:3000');
			}
			if (/vite/i.test(scripts)) {
				urls.unshift('http://127.0.0.1:5173', 'http://localhost:5173');
			}
		}
	} catch {
		/* ignore */
	}
	return [...new Set(urls)];
}

function summarizeDom(html: string, title: string): string {
	const text = html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 2500);
	const svgCount = (html.match(/<svg[\s>]/gi) || []).length;
	const imgCount = (html.match(/<img[\s>]/gi) || []).length;
	const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
	return [
		`title=${title || '(none)'}`,
		`h1=${h1 || '(none)'}`,
		`svgCount=${svgCount}`,
		`imgCount=${imgCount}`,
		`bodyText=${text}`,
	].join('\n');
}

/**
 * Capture live preview at 3 viewports when a local dev server responds.
 */
export async function captureAgentPreview(options: {
	workspaceRoot: string;
	iteration: number;
	log?: (msg: string) => void;
}): Promise<AgentCaptureResult> {
	const log = options.log ?? (() => { });
	const candidates = inferCandidateUrls(options.workspaceRoot);
	let url: string | undefined;
	for (const candidate of candidates) {
		if (await probeUrl(candidate)) {
			url = candidate;
			break;
		}
	}

	if (!url) {
		log('[DesignIntelligence] No local preview responding — Visual Critic will use source scan');
		return {
			previewAvailable: false,
			captures: [],
			note: 'No preview at :3000/:5173/:4173. Keep `npm run dev` running so Visual Critic can screenshot.',
		};
	}

	const outDir = path.join(
		options.workspaceRoot,
		'.singularity',
		'visual-qa',
		`iter-${options.iteration}`,
	);
	fs.mkdirSync(outDir, { recursive: true });

	try {
		// Dynamic import — playwright is a dependency of the extension host
		const playwright = await import('playwright');
		const browser = await playwright.chromium.launch({ headless: true });
		const captures: AgentViewportCapture[] = [];
		try {
			for (const vp of AGENT_VISUAL_VIEWPORTS) {
				const page = await browser.newPage({
					viewport: { width: vp.width, height: vp.height },
				});
				const consoleErrors: string[] = [];
				const runtimeErrors: string[] = [];
				page.on('console', (msg) => {
					if (msg.type() === 'error') {
						consoleErrors.push(msg.text().slice(0, 400));
					}
				});
				page.on('pageerror', (err) => {
					runtimeErrors.push(String(err).slice(0, 400));
				});
				try {
					await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
					await page.waitForTimeout(400);
					const title = await page.title();
					const html = await page.content();
					const screenshotPath = path.join(outDir, `${vp.name}.png`);
					await page.screenshot({ path: screenshotPath, fullPage: false });
					captures.push({
						url,
						viewport: { width: vp.width, height: vp.height, name: vp.name },
						screenshotPath,
						title,
						domSummary: summarizeDom(html, title),
						consoleErrors,
						runtimeErrors,
					});
				} finally {
					await page.close().catch(() => { });
				}
			}
		} finally {
			await browser.close().catch(() => { });
		}

		const capturesMeta = path.join(outDir, 'captures.json');
		fs.writeFileSync(
			capturesMeta,
			`${JSON.stringify({ url, captures: captures.map(({ screenshotPath, ...rest }) => ({ ...rest, screenshotPath })) }, null, 2)}\n`,
			'utf8',
		);
		log(`[DesignIntelligence] Captured ${captures.length} viewports @ ${url}`);
		return { previewAvailable: true, url, captures };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		log(`[DesignIntelligence] Playwright capture failed: ${message}`);
		return {
			previewAvailable: false,
			url,
			captures: [],
			note: `Playwright capture failed (${message}); using source scan`,
		};
	}
}

/** Compact digest for the Visual Critic LLM (text-only path). */
export function formatCaptureDigest(result: AgentCaptureResult): string {
	if (!result.previewAvailable || !result.captures.length) {
		return result.note || 'No live browser captures available.';
	}
	return result.captures
		.map((c) => {
			const errs = [...c.consoleErrors, ...c.runtimeErrors].slice(0, 5).join(' | ') || 'none';
			return [
				`## ${c.viewport.name} ${c.viewport.width}x${c.viewport.height}`,
				`url=${c.url}`,
				`screenshot=${c.screenshotPath || '(none)'}`,
				`errors=${errs}`,
				c.domSummary || '',
			].join('\n');
		})
		.join('\n\n');
}
