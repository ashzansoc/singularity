/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getActiveWindow } from '../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IURLHandler, IURLService } from '../../../../platform/url/common/url.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import './media/singularityAccess.css';

export const SINGULARITY_ACCESS_STORAGE_KEY = 'singularity.access.granted';
export const SINGULARITY_ACCESS_EMAIL_KEY = 'singularity.access.email';
export const SINGULARITY_ACCESS_SETUP_DONE_KEY = 'singularity.access.setupDone';
export const SINGULARITY_ACCESS_DEVICE_ID_KEY = 'singularity.access.deviceId';

const SINGULARITY_MEDIA_ROOT = 'vs/workbench/contrib/welcomeGettingStarted/browser/media';

const DEFAULT_SUPABASE_URL = 'https://nuwsczuwyezpodtnouqf.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs';
const DEFAULT_ALLOWED_EMAIL_DOMAIN = 'zansoc.com';

type BetaAuthSession = {
	email: string;
	userId?: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	deviceId: string;
	openrouterApiKey?: string;
	openrouterBaseUrl?: string;
	openrouterKeyName?: string;
	subscriptionStartedAt?: string;
	githubUsername?: string;
};

/**
 * First-run fullscreen access gate with Supabase email OTP / magic-link.
 * Persists session to ~/.singularity/beta-auth.json for the LLM proxy.
 *
 * Free-tier Supabase emails are magic links (OTP body templates require custom SMTP).
 * Users can: enter a 6-digit code when available, paste the email link, or open
 * singularity://beta-auth#access_token=… from the hosted redirect page.
 */
export class SingularityAccessOverlayContribution extends Disposable implements IWorkbenchContribution, IURLHandler {

	static readonly ID = 'workbench.contrib.singularityAccessOverlay';

	private overlay: HTMLElement | undefined;
	private previouslyFocusedElement: HTMLElement | undefined;
	private otpSent = false;
	private completingSession = false;
	private pendingAccessError: string | undefined;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly productService: IProductService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@ILogService private readonly logService: ILogService,
		@IURLService urlService: IURLService,
	) {
		super();
		this._register(urlService.registerHandler(this));
		void this.maybeShow();
	}

	async handleURL(uri: URI): Promise<boolean> {
		const protocol = this.productService.urlProtocol || 'singularity';
		if (uri.scheme !== protocol) {
			return false;
		}
		const target = `${uri.authority}${uri.path}`.replace(/^\/+/, '');
		if (target !== 'beta-auth' && !target.startsWith('beta-auth/')) {
			return false;
		}
		const fragment = uri.fragment || uri.query || '';
		const tokens = this.parseAuthFragment(fragment.startsWith('access_token') ? fragment : (uri.fragment || uri.toString(true)));
		if (!tokens) {
			// Full URI string may still contain hash tokens
			const fromFull = this.parseAuthFragment(uri.toString(true));
			if (!fromFull) {
				return false;
			}
			try {
				await this.completeWithTokens(fromFull);
				return true;
			} catch (err) {
				this.logService.error('[singularityAccess] deep-link auth failed', err);
				this.pendingAccessError = err instanceof Error && err.message === 'email_domain_not_allowed'
					? this.domainAccessError()
					: localize('singularitySignIn.verifyFailed', "Invalid or expired code/link. Request a new one.");
				this.show();
				return true;
			}
		}
		try {
			await this.completeWithTokens(tokens);
			return true;
		} catch (err) {
			this.logService.error('[singularityAccess] deep-link auth failed', err);
			this.pendingAccessError = err instanceof Error && err.message === 'email_domain_not_allowed'
				? this.domainAccessError()
				: localize('singularitySignIn.verifyFailed', "Invalid or expired code/link. Request a new one.");
			this.show();
			return true;
		}
	}

	private parseAuthFragment(fragmentOrUrl: string): { accessToken: string; refreshToken?: string; expiresIn: number } | undefined {
		const raw = fragmentOrUrl.trim();
		if (!raw) {
			return undefined;
		}
		let fragment = raw;
		try {
			if (/^https?:\/\//i.test(raw) || /^singularity:/i.test(raw) || /^localhost[:/]/i.test(raw)) {
				const normalized = raw.startsWith('localhost') ? `http://${raw}` : raw;
				const uri = URI.parse(normalized);
				fragment = uri.fragment || uri.query;
			}
		} catch {
			/* treat as raw fragment */
		}
		if (fragment.startsWith('#')) {
			fragment = fragment.slice(1);
		}
		const params = new URLSearchParams(fragment);
		const accessToken = params.get('access_token') ?? undefined;
		if (!accessToken) {
			// pasted URL may keep tokens only after # in the string without URI parse succeeding
			const m = raw.match(/access_token=([^&]+)/);
			if (!m) {
				return undefined;
			}
			const refresh = raw.match(/refresh_token=([^&]+)/)?.[1];
			const expires = Number(raw.match(/expires_in=([^&]+)/)?.[1] ?? '3600');
			return { accessToken: decodeURIComponent(m[1]), refreshToken: refresh ? decodeURIComponent(refresh) : undefined, expiresIn: expires };
		}
		return {
			accessToken,
			refreshToken: params.get('refresh_token') ?? undefined,
			expiresIn: Number(params.get('expires_in') ?? '3600'),
		};
	}

	private async completeWithTokens(tokens: { accessToken: string; refreshToken?: string; expiresIn: number }, emailHint?: string): Promise<void> {
		if (this.completingSession) {
			return;
		}
		this.completingSession = true;
		try {
			const userRes = await fetch(`${this.supabaseUrl()}/auth/v1/user`, {
				headers: {
					apikey: this.supabaseAnonKey(),
					Authorization: `Bearer ${tokens.accessToken}`,
				},
			});
			if (!userRes.ok) {
				throw new Error(await userRes.text());
			}
			const user = await userRes.json() as {
				id?: string;
				email?: string;
				user_metadata?: Record<string, unknown>;
				identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> }>;
			};
			const email = (user.email ?? emailHint ?? '').toLowerCase();
			if (!email) {
				throw new Error('missing email');
			}
			if (!this.isAllowedEmail(email)) {
				throw new Error('email_domain_not_allowed');
			}
			let githubUsername: string | undefined;
			for (const id of user.identities ?? []) {
				if (id.provider === 'github') {
					const data = id.identity_data ?? {};
					githubUsername =
						(typeof data.user_name === 'string' && data.user_name)
						|| (typeof data.preferred_username === 'string' && data.preferred_username)
						|| githubUsername;
				}
			}
			if (!githubUsername) {
				const meta = user.user_metadata ?? {};
				githubUsername =
					(typeof meta.preferred_username === 'string' && meta.preferred_username)
					|| (typeof meta.user_name === 'string' && meta.user_name)
					|| undefined;
			}
			const deviceId = this.deviceId();
			const authPayload: BetaAuthSession = {
				email,
				userId: user.id,
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: Date.now() + Math.max(60, tokens.expiresIn || 3600) * 1000,
				deviceId,
				githubUsername,
			};
			await this.persistSession(authPayload);
			this.dismiss();
		} finally {
			this.completingSession = false;
		}
	}

	private async persistSession(authPayload: BetaAuthSession): Promise<void> {
		const home = await this.pathService.userHome({ preferLocal: true });
		const dir = joinPath(home, '.singularity');
		await this.fileService.createFolder(dir);
		const authFile = joinPath(dir, 'beta-auth.json');
		await this.fileService.writeFile(authFile, VSBuffer.fromString(JSON.stringify(authPayload, null, 2)));

		try {
			const proxyBase = this.productService.singularityLlmProxyUrl
				|| 'https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1';
			const regRes = await fetch(`${proxyBase}/register`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${authPayload.accessToken}`,
					apikey: this.supabaseAnonKey(),
					'X-Singularity-Device-Id': authPayload.deviceId,
					'Content-Type': 'application/json',
				},
				body: '{}',
			});
			if (regRes.ok) {
				const reg = await regRes.json() as {
					gateway?: { apiKey?: string; baseUrl?: string; keyName?: string };
					subscription?: { startedAt?: string };
					githubUsername?: string | null;
				};
				if (reg.gateway?.apiKey) {
					authPayload.openrouterApiKey = reg.gateway.apiKey;
					authPayload.openrouterBaseUrl = reg.gateway.baseUrl;
					authPayload.openrouterKeyName = reg.gateway.keyName;
				}
				if (reg.subscription?.startedAt) {
					authPayload.subscriptionStartedAt = reg.subscription.startedAt;
				}
				if (reg.githubUsername) {
					authPayload.githubUsername = reg.githubUsername;
				}
				await this.fileService.writeFile(authFile, VSBuffer.fromString(JSON.stringify(authPayload, null, 2)));
			}
		} catch (regErr) {
			this.logService.warn('[singularityAccess] beta register failed', regErr);
		}

		this.storageService.store(SINGULARITY_ACCESS_EMAIL_KEY, authPayload.email, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storageService.store(SINGULARITY_ACCESS_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storageService.store(SINGULARITY_ACCESS_SETUP_DONE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storageService.remove('singularity.access.forceShow', StorageScope.APPLICATION);
	}

	private allowedEmailDomain(): string {
		return (this.productService.singularityAllowedEmailDomain || DEFAULT_ALLOWED_EMAIL_DOMAIN).toLowerCase();
	}

	private isAllowedEmail(email: string): boolean {
		const normalized = email.trim().toLowerCase();
		const suffix = `@${this.allowedEmailDomain()}`;
		return normalized.endsWith(suffix) && normalized.length > suffix.length;
	}

	private domainAccessError(): string {
		return localize('singularitySignIn.domainOnly', "Only @{0} email addresses can access Singularity.", this.allowedEmailDomain());
	}

	private supabaseUrl(): string {
		return this.productService.singularitySupabaseUrl || DEFAULT_SUPABASE_URL;
	}

	private supabaseAnonKey(): string {
		return this.productService.singularitySupabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;
	}

	private deviceId(): string {
		let id = this.storageService.get(SINGULARITY_ACCESS_DEVICE_ID_KEY, StorageScope.APPLICATION, '');
		if (!id) {
			id = generateUuid();
			this.storageService.store(SINGULARITY_ACCESS_DEVICE_ID_KEY, id, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		return id;
	}

	private async maybeShow(): Promise<void> {
		const forceShow = this.storageService.getBoolean('singularity.access.forceShow', StorageScope.APPLICATION, false);
		if (forceShow) {
			this.show();
			return;
		}

		const granted = this.storageService.getBoolean(SINGULARITY_ACCESS_STORAGE_KEY, StorageScope.APPLICATION, false);
		const setupDone = this.storageService.getBoolean(SINGULARITY_ACCESS_SETUP_DONE_KEY, StorageScope.APPLICATION, false);
		if (granted && setupDone) {
			try {
				const home = await this.pathService.userHome({ preferLocal: true });
				const authFile = joinPath(home, '.singularity', 'beta-auth.json');
				if (await this.fileService.exists(authFile)) {
					const raw = JSON.parse((await this.fileService.readFile(authFile)).value.toString()) as Partial<BetaAuthSession>;
					if (raw.accessToken && raw.email && raw.deviceId && this.isAllowedEmail(raw.email)) {
						return;
					}
					if (raw.email && !this.isAllowedEmail(raw.email)) {
						await this.fileService.del(authFile);
						this.storageService.remove(SINGULARITY_ACCESS_STORAGE_KEY, StorageScope.APPLICATION);
						this.storageService.remove(SINGULARITY_ACCESS_SETUP_DONE_KEY, StorageScope.APPLICATION);
					}
				}
			} catch (err) {
				this.logService.warn('[singularityAccess] auth file check failed', err);
			}
		}

		this.show();
	}

	private ensureFont(): void {
		if (getActiveWindow().document.getElementById('singularity-signin-font')) {
			return;
		}
		const woff = FileAccess.asBrowserUri(`${SINGULARITY_MEDIA_ROOT}/AwesomeLathusca.woff`).toString(true);
		const ttf = FileAccess.asBrowserUri(`${SINGULARITY_MEDIA_ROOT}/AwesomeLathusca.ttf`).toString(true);
		const style = getActiveWindow().document.createElement('style');
		style.id = 'singularity-signin-font';
		style.textContent = `@font-face{font-family:'Awesome Lathusca';font-style:normal;font-weight:400;font-display:swap;src:url('${woff}') format('woff'),url('${ttf}') format('truetype');}`;
		getActiveWindow().document.head.appendChild(style);
	}

	private show(): void {
		if (this.overlay) {
			return;
		}

		const initialError = this.pendingAccessError;
		this.pendingAccessError = undefined;

		this.ensureFont();
		this.previouslyFocusedElement = getActiveWindow().document.activeElement as HTMLElement | undefined;

		const logoUri = FileAccess.asBrowserUri(`${SINGULARITY_MEDIA_ROOT}/singularity-logo-light.png`).toString(true);

		const container = this.layoutService.mainContainer;
		this.overlay = append(container, $('.singularity-access-overlay'));
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-modal', 'true');
		this.overlay.setAttribute('aria-label', localize('singularityAccess.aria', "Singularity access"));

		const logo = $('img.singularity-access-logo', {
			src: logoUri,
			alt: 'Singularity',
			draggable: 'false',
		});
		const wordmark = $('h1.singularity-access-wordmark', {}, 'SINGULARITY');
		const subtitle = $('p.singularity-access-subtitle', {}, this.domainAccessError());

		const emailInput = $('input.singularity-access-input', {
			type: 'email',
			placeholder: localize('singularitySignIn.emailPlaceholder', "you@{0}", this.allowedEmailDomain()),
			autocomplete: 'email',
			spellcheck: 'false',
			'aria-label': localize('singularitySignIn.emailAria', "Email"),
		}) as HTMLInputElement;
		emailInput.value = this.storageService.get(SINGULARITY_ACCESS_EMAIL_KEY, StorageScope.APPLICATION, '');

		const codeInput = $('input.singularity-access-input', {
			type: 'text',
			placeholder: localize('singularitySignIn.codePlaceholder', "Code or paste email link"),
			autocomplete: 'one-time-code',
			spellcheck: 'false',
			'aria-label': localize('singularitySignIn.codeAria', "Code or email link"),
		}) as HTMLInputElement;

		const sendBtn = $('button.singularity-access-button', {
			type: 'button',
		}, localize('singularitySignIn.sendCode', "Send code")) as HTMLButtonElement;

		const accessBtn = $('button.singularity-access-button', {
			type: 'button',
		}, localize('singularitySignIn.access', "Access")) as HTMLButtonElement;
		accessBtn.disabled = true;

		const errorEl = $('p.singularity-access-error', { role: 'alert' });
		errorEl.hidden = true;
		const hintEl = $('p.singularity-access-error', { role: 'status' });
		hintEl.hidden = true;
		hintEl.style.color = 'rgba(255,255,255,0.75)';

		const setError = (message: string | undefined) => {
			if (message) {
				errorEl.textContent = message;
				errorEl.hidden = false;
			} else {
				errorEl.textContent = '';
				errorEl.hidden = true;
			}
		};
		const setHint = (message: string | undefined) => {
			if (message) {
				hintEl.textContent = message;
				hintEl.hidden = false;
			} else {
				hintEl.textContent = '';
				hintEl.hidden = true;
			}
		};

		const sendCode = async () => {
			const email = emailInput.value.trim().toLowerCase();
			if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
				setError(localize('singularitySignIn.invalidEmail', "Enter a valid email address."));
				emailInput.focus();
				return;
			}
			if (!this.isAllowedEmail(email)) {
				setError(this.domainAccessError());
				emailInput.focus();
				return;
			}
			setError(undefined);
			sendBtn.disabled = true;
			sendBtn.textContent = localize('singularitySignIn.sending', "Sending…");
			try {
				const res = await fetch(`${this.supabaseUrl()}/auth/v1/otp`, {
					method: 'POST',
					headers: {
						apikey: this.supabaseAnonKey(),
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ email, create_user: true }),
				});
				if (!res.ok) {
					const detail = await res.text();
					throw new Error(detail || `HTTP ${res.status}`);
				}
				this.otpSent = true;
				accessBtn.disabled = false;
				setHint(localize('singularitySignIn.codeSent', "Open the link in your email (it returns here), or paste that link into the field below."));
				codeInput.focus();
			} catch (err) {
				this.logService.error('[singularityAccess] OTP send failed', err);
				setError(localize('singularitySignIn.sendFailed', "Could not send code. Check your email and try again."));
			} finally {
				sendBtn.disabled = false;
				sendBtn.textContent = localize('singularitySignIn.sendCode', "Send code");
			}
		};

		const tryAccess = async () => {
			const email = emailInput.value.trim().toLowerCase();
			const code = codeInput.value.trim();
			if (!code) {
				setError(localize('singularitySignIn.invalidCode', "Enter the code from your email, or paste the email link."));
				codeInput.focus();
				return;
			}

			setError(undefined);
			accessBtn.disabled = true;
			accessBtn.textContent = localize('singularitySignIn.verifying', "Verifying…");
			try {
				const linkTokens = this.parseAuthFragment(code);
				if (linkTokens) {
					await this.completeWithTokens(linkTokens, email || undefined);
					return;
				}

				if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
					setError(localize('singularitySignIn.invalidEmail', "Enter a valid email address."));
					emailInput.focus();
					accessBtn.disabled = false;
					accessBtn.textContent = localize('singularitySignIn.access', "Access");
					return;
				}
				if (!this.isAllowedEmail(email)) {
					setError(this.domainAccessError());
					emailInput.focus();
					accessBtn.disabled = false;
					accessBtn.textContent = localize('singularitySignIn.access', "Access");
					return;
				}
				if (!this.otpSent) {
					setError(localize('singularitySignIn.sendFirst', "Send a code to your email first."));
					accessBtn.disabled = false;
					accessBtn.textContent = localize('singularitySignIn.access', "Access");
					return;
				}

				const res = await fetch(`${this.supabaseUrl()}/auth/v1/verify`, {
					method: 'POST',
					headers: {
						apikey: this.supabaseAnonKey(),
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ email, token: code, type: 'email' }),
				});
				if (!res.ok) {
					const detail = await res.text();
					throw new Error(detail || `HTTP ${res.status}`);
				}
				const data = await res.json() as {
					access_token?: string;
					refresh_token?: string;
					expires_in?: number;
					user?: { id?: string; email?: string };
				};
				if (!data.access_token) {
					throw new Error('missing access_token');
				}
				const sessionEmail = (data.user?.email ?? email).toLowerCase();
				if (!this.isAllowedEmail(sessionEmail)) {
					setError(this.domainAccessError());
					accessBtn.disabled = false;
					accessBtn.textContent = localize('singularitySignIn.access', "Access");
					return;
				}
				await this.persistSession({
					email: sessionEmail,
					userId: data.user?.id,
					accessToken: data.access_token,
					refreshToken: data.refresh_token,
					expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
					deviceId: this.deviceId(),
				});
				this.dismiss();
			} catch (err) {
				this.logService.error('[singularityAccess] OTP verify failed', err);
				const message = err instanceof Error && err.message === 'email_domain_not_allowed'
					? this.domainAccessError()
					: localize('singularitySignIn.verifyFailed', "Invalid or expired code/link. Request a new one.");
				setError(message);
				accessBtn.disabled = false;
				accessBtn.textContent = localize('singularitySignIn.access', "Access");
			}
		};

		this._register(addDisposableListener(sendBtn, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void sendCode();
		}));
		this._register(addDisposableListener(accessBtn, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			void tryAccess();
		}));

		this._register(addDisposableListener(emailInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void sendCode();
			}
		}));
		this._register(addDisposableListener(codeInput, 'input', () => {
			if (codeInput.value.trim()) {
				accessBtn.disabled = false;
			}
		}));
		this._register(addDisposableListener(codeInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void tryAccess();
			}
		}));

		const form = $('.singularity-access-form', {}, emailInput, sendBtn, codeInput, accessBtn);
		const center = $('.singularity-access-center', {}, logo, wordmark, subtitle, form, hintEl, errorEl);
		append(this.overlay, center);

		if (initialError) {
			setError(initialError);
		}

		requestAnimationFrame(() => {
			this.overlay?.classList.add('visible');
			emailInput.focus();
		});
	}

	private dismiss(): void {
		if (!this.overlay) {
			return;
		}
		const el = this.overlay;
		el.classList.remove('visible');
		el.classList.add('exiting');
		let done = false;
		const finish = () => {
			if (done) {
				return;
			}
			done = true;
			el.remove();
			if (this.overlay === el) {
				this.overlay = undefined;
			}
			this.previouslyFocusedElement?.focus?.();
		};
		this._register(addDisposableListener(el, 'transitionend', finish));
		getActiveWindow().setTimeout(finish, 320);
	}
}

registerWorkbenchContribution2(SingularityAccessOverlayContribution.ID, SingularityAccessOverlayContribution, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.singularity.resetAccessGate',
			title: localize2('singularity.resetAccessGate', "Singularity: Reset Access Gate"),
			category: Categories.Developer,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const storage = accessor.get(IStorageService);
		const fileService = accessor.get(IFileService);
		const pathService = accessor.get(IPathService);
		storage.remove(SINGULARITY_ACCESS_STORAGE_KEY, StorageScope.APPLICATION);
		storage.remove(SINGULARITY_ACCESS_SETUP_DONE_KEY, StorageScope.APPLICATION);
		storage.store('singularity.access.forceShow', true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		try {
			const home = await pathService.userHome({ preferLocal: true });
			const authFile = joinPath(home, '.singularity', 'beta-auth.json');
			if (await fileService.exists(authFile)) {
				await fileService.del(authFile);
			}
		} catch {
			/* ignore */
		}
		await accessor.get(IHostService).reload();
	}
});
