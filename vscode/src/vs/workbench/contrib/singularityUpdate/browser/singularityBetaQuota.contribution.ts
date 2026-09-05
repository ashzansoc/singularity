/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { isWeb } from '../../../../base/common/platform.js';

const DEFAULT_PROXY = 'https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1';
const DEFAULT_ANON =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs';

/**
 * Polls the Singularity LLM proxy for remaining beta quota (informational).
 * Hard 10M blocking is disabled server-side.
 */
export class SingularityBetaQuotaContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.singularityBetaQuota';

	private readonly poll = this._register(new MutableDisposable());

	constructor(
		@IProductService private readonly productService: IProductService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		if (!isWeb) {
			void this.refresh();
			const handle = setInterval(() => void this.refresh(), 60_000);
			this.poll.value = { dispose: () => clearInterval(handle) };
		}
	}

	private async readAuth(): Promise<{
		accessToken: string;
		deviceId: string;
		email?: string;
		openrouterApiKey?: string;
	} | undefined> {
		try {
			const home = await this.pathService.userHome({ preferLocal: true });
			const authFile = joinPath(home, '.singularity', 'beta-auth.json');
			if (!(await this.fileService.exists(authFile))) {
				return undefined;
			}
			const raw = JSON.parse((await this.fileService.readFile(authFile)).value.toString()) as {
				accessToken?: string;
				deviceId?: string;
				email?: string;
				openrouterApiKey?: string;
			};
			if (!raw.accessToken || !raw.deviceId) {
				return undefined;
			}
			return {
				accessToken: raw.accessToken,
				deviceId: raw.deviceId,
				email: raw.email,
				openrouterApiKey: raw.openrouterApiKey,
			};
		} catch {
			return undefined;
		}
	}

	/** Sync profile + provision OpenRouter key when session exists but gateway is missing. */
	private async ensureRegistered(auth: {
		accessToken: string;
		deviceId: string;
		email?: string;
		openrouterApiKey?: string;
	}): Promise<void> {
		if (auth.openrouterApiKey?.startsWith('sk-or-')) {
			return;
		}
		const proxy = this.productService.singularityLlmProxyUrl || DEFAULT_PROXY;
		const anon = this.productService.singularitySupabaseAnonKey || DEFAULT_ANON;
		try {
			const res = await fetch(`${proxy}/register`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${auth.accessToken}`,
					apikey: anon,
					'X-Singularity-Device-Id': auth.deviceId,
					'Content-Type': 'application/json',
				},
				body: '{}',
			});
			if (!res.ok) {
				this.logService.trace('[singularityQuota] register failed', res.status);
				return;
			}
			const reg = await res.json() as {
				gateway?: { apiKey?: string; baseUrl?: string; keyName?: string };
				subscription?: { startedAt?: string };
				githubUsername?: string | null;
			};
			if (!reg.gateway?.apiKey) {
				return;
			}
			const home = await this.pathService.userHome({ preferLocal: true });
			const authFile = joinPath(home, '.singularity', 'beta-auth.json');
			const existing = JSON.parse((await this.fileService.readFile(authFile)).value.toString()) as Record<string, unknown>;
			const next = {
				...existing,
				openrouterApiKey: reg.gateway.apiKey,
				openrouterBaseUrl: reg.gateway.baseUrl,
				openrouterKeyName: reg.gateway.keyName,
				subscriptionStartedAt: reg.subscription?.startedAt ?? existing.subscriptionStartedAt,
				githubUsername: reg.githubUsername ?? existing.githubUsername,
			};
			await this.fileService.writeFile(authFile, VSBuffer.fromString(JSON.stringify(next, null, 2)));
			this.logService.info('[singularityQuota] provisioned OpenRouter key', reg.gateway.keyName);
		} catch (err) {
			this.logService.trace('[singularityQuota] register error', err);
		}
	}

	private async refresh(): Promise<void> {
		const auth = await this.readAuth();
		if (!auth) {
			return;
		}
		await this.ensureRegistered(auth);
		const proxy = this.productService.singularityLlmProxyUrl || DEFAULT_PROXY;
		const anon = this.productService.singularitySupabaseAnonKey || DEFAULT_ANON;
		try {
			const res = await fetch(`${proxy}/quota`, {
				headers: {
					Authorization: `Bearer ${auth.accessToken}`,
					apikey: anon,
					'X-Singularity-Device-Id': auth.deviceId,
				},
			});
			if (res.status === 401) {
				return;
			}
			if (res.status === 402) {
				// Quota enforcement is off; treat as informational only.
				this.logService.trace('[singularityQuota] proxy returned 402 (ignored)');
				return;
			}
			if (!res.ok) {
				return;
			}
			const data = await res.json() as { emailRemaining?: number; deviceRemaining?: number };
			if ((data.emailRemaining ?? 1) <= 0 || (data.deviceRemaining ?? 1) <= 0) {
				this.logService.trace('[singularityQuota] remaining reported as 0 (enforcement disabled)');
			}
		} catch (err) {
			this.logService.trace('[singularityQuota] refresh failed', err);
		}
	}
}

registerWorkbenchContribution2(SingularityBetaQuotaContribution.ID, SingularityBetaQuotaContribution, WorkbenchPhase.AfterRestored);
