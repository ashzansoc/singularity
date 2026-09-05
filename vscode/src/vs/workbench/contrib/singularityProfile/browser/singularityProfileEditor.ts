/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/singularityProfileEditor.css';
import * as DOM from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { DEFAULT_ACCOUNT_SIGN_IN_COMMAND } from '../../../services/accounts/browser/defaultAccount.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { ISingularityBillingService, ISingularityBillingSnapshot, SINGULARITY_MONTHLY_USD, SINGULARITY_TRIAL_DAYS } from '../../../services/singularityBilling/common/singularityBilling.js';
import { SingularityProfileEditorInput, SINGULARITY_PROFILE_EDITOR_ID } from './singularityProfileEditorInput.js';

const $ = DOM.$;

export class SingularityProfileEditor extends EditorPane {

	static readonly ID = SINGULARITY_PROFILE_EDITOR_ID;

	private readonly editorDisposables = this._register(new DisposableStore());
	private root: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ISingularityBillingService private readonly billingService: ISingularityBillingService,
		@ICommandService private readonly commandService: ICommandService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
	) {
		super(SingularityProfileEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, $('.singularity-profile-editor'));
		this._register(this.billingService.onDidChange(() => this.render()));
	}

	override async setInput(input: SingularityProfileEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.render();
	}

	override layout(): void {
		// Fluid layout via CSS.
	}

	private render(): void {
		if (!this.root) {
			return;
		}

		this.editorDisposables.clear();
		DOM.clearNode(this.root);

		const snapshot = this.billingService.getSnapshot();
		const shell = DOM.append(this.root, $('.singularity-profile-shell'));
		DOM.append(shell, this.createHero(snapshot));
		DOM.append(shell, this.createPlanCard(snapshot));
		DOM.append(shell, this.createBillingCard(snapshot));
	}

	private createHero(snapshot: ISingularityBillingSnapshot): HTMLElement {
		const hero = $('.singularity-profile-hero');
		const avatar = DOM.append(hero, $('.singularity-profile-avatar', { 'aria-hidden': 'true' }));
		this.renderAvatar(avatar, snapshot);

		const copy = DOM.append(hero, $('.singularity-profile-hero-copy'));
		const kicker = DOM.append(copy, $('div.singularity-profile-kicker'));
		kicker.textContent = localize('singularity.profile.kicker', "Singularity account");

		const title = DOM.append(copy, $('h1.singularity-profile-title'));
		title.textContent = snapshot.githubLogin
			? snapshot.githubLogin
			: snapshot.kind === 'restoring'
				? localize('singularity.profile.restoringTitle', "Restoring your account")
				: localize('singularity.profile.signedOutTitle', "Sign in to continue");

		const subtitle = DOM.append(copy, $('p.singularity-profile-subtitle'));
		if (snapshot.kind === 'restoring') {
			subtitle.textContent = localize('singularity.profile.restoringBody', "Using the GitHub session saved on this machine.");
		} else if (snapshot.kind === 'signedOut') {
			subtitle.textContent = localize('singularity.profile.signedOutBody', "Singularity requires a GitHub login. New accounts get {0} days of unlimited usage.", SINGULARITY_TRIAL_DAYS);
		} else if (snapshot.kind === 'trial') {
			subtitle.textContent = localize('singularity.profile.trialBody', "Logged in with GitHub. {0} of {1} trial days remaining.", snapshot.trialDaysRemaining, snapshot.trialDaysTotal);
		} else if (snapshot.kind === 'subscribed') {
			subtitle.textContent = localize('singularity.profile.subscribedBody', "Unlimited usage is active on this GitHub account.");
		} else {
			subtitle.textContent = localize('singularity.profile.expiredBody', "Your trial has ended. Subscribe to keep unlimited usage.");
		}

		const actions = DOM.append(copy, $('.singularity-profile-hero-actions'));
		if (snapshot.kind === 'signedOut') {
			this.addButton(actions, localize('singularity.profile.signIn', "Continue with GitHub"), false, () => this.signInWithGitHub());
		} else if (snapshot.kind !== 'restoring') {
			this.addButton(actions, localize('singularity.profile.viewGithub', "View on GitHub"), true, () => {
				void this.openerService.open(URI.parse(`https://github.com/${encodeURIComponent(snapshot.githubLogin!)}`));
			});
			this.addButton(actions, localize('singularity.profile.signOut', "Sign out"), true, () => this.defaultAccountService.signOut());
		}

		return hero;
	}

	private createPlanCard(snapshot: ISingularityBillingSnapshot): HTMLElement {
		const card = $('.singularity-profile-card');
		const header = DOM.append(card, $('.singularity-profile-card-header'));
		DOM.append(header, $('h2')).textContent = localize('singularity.profile.planTitle', "Usage plan");
		const pill = DOM.append(header, $(`span.singularity-profile-pill.${snapshot.kind}`));
		pill.textContent = planLabel(snapshot);

		if (snapshot.kind === 'restoring') {
			DOM.append(card, $('p.singularity-profile-muted')).textContent = localize('singularity.profile.planRestoring', "Checking the saved GitHub login…");
			return card;
		}

		if (snapshot.kind === 'signedOut') {
			DOM.append(card, $('p.singularity-profile-muted')).textContent = localize('singularity.profile.planSignedOut', "Sign in with GitHub to start your {0}-day unlimited trial.", SINGULARITY_TRIAL_DAYS);
			return card;
		}

		const meter = DOM.append(card, $('.singularity-profile-meter'));
		const used = snapshot.kind === 'subscribed' ? 1 : (snapshot.trialDaysTotal - snapshot.trialDaysRemaining) / snapshot.trialDaysTotal;
		meter.style.setProperty('--singularity-trial-progress', String(Math.min(1, Math.max(0, used))));

		const meterCopy = DOM.append(meter, $('.singularity-profile-meter-copy'));
		if (snapshot.kind === 'subscribed') {
			const until = snapshot.subscribedUntil ? new Date(snapshot.subscribedUntil).toLocaleDateString() : '';
			meterCopy.textContent = localize('singularity.profile.renews', "Unlimited · renews {0}", until);
		} else if (snapshot.kind === 'trial') {
			meterCopy.textContent = localize('singularity.profile.daysLeft', "{0} day{1} left in trial", snapshot.trialDaysRemaining, snapshot.trialDaysRemaining === 1 ? '' : 's');
		} else {
			meterCopy.textContent = localize('singularity.profile.trialEnded', "Trial ended");
		}

		const meta = DOM.append(card, $('dl.singularity-profile-meta'));
		this.addMeta(meta, localize('singularity.profile.githubId', "GitHub ID"), `@${snapshot.githubLogin}`);
		this.addMeta(meta, localize('singularity.profile.alias', "Alias"), snapshot.alias);
		if (snapshot.trialEndsAt && snapshot.kind !== 'subscribed') {
			this.addMeta(meta, localize('singularity.profile.trialEnds', "Trial ends"), new Date(snapshot.trialEndsAt).toLocaleDateString());
		}

		return card;
	}

	private createBillingCard(snapshot: ISingularityBillingSnapshot): HTMLElement {
		const card = $('.singularity-profile-card.singularity-profile-billing');
		DOM.append(card, $('h2')).textContent = localize('singularity.profile.billingTitle', "After the trial");

		const price = DOM.append(card, $('.singularity-profile-price'));
		DOM.append(price, $('span.singularity-profile-price-amount')).textContent = `$${SINGULARITY_MONTHLY_USD}`;
		DOM.append(price, $('span.singularity-profile-price-period')).textContent = localize('singularity.profile.perMonth', " / month");
		DOM.append(price, $('span.singularity-profile-price-gst')).textContent = localize('singularity.profile.plusGst', " + GST");

		DOM.append(card, $('p.singularity-profile-muted')).textContent = localize(
			'singularity.profile.billingBody',
			"Unlimited usage after the {0}-day trial. GST is added at checkout (typically 18%, about ${1} total).",
			SINGULARITY_TRIAL_DAYS,
			snapshot.monthlyTotalUsd.toFixed(2),
		);

		if (snapshot.kind === 'subscribed') {
			DOM.append(card, $('p.singularity-profile-ok')).textContent = localize('singularity.profile.alreadySubscribed', "This account is subscribed for unlimited usage.");
			return card;
		}

		if (snapshot.kind === 'restoring' || snapshot.kind === 'signedOut') {
			return card;
		}

		const label = snapshot.kind === 'expired'
			? localize('singularity.profile.subscribeNow', "Subscribe for unlimited usage")
			: localize('singularity.profile.subscribeLater', "Subscribe now");
		this.addButton(card, label, snapshot.kind !== 'expired', async () => {
			const confirmed = await this.dialogService.confirm({
				message: localize('singularity.profile.subscribeConfirmTitle', "Subscribe to Singularity"),
				detail: localize('singularity.profile.subscribeConfirmBody', "Unlimited usage is ${0} plus GST per month (about ${1} with 18% GST). Continue?", SINGULARITY_MONTHLY_USD, snapshot.monthlyTotalUsd.toFixed(2)),
				primaryButton: localize('singularity.profile.subscribeConfirmAction', "Subscribe"),
			});
			if (confirmed.confirmed) {
				await this.billingService.activateSubscription();
			}
		});

		return card;
	}

	private signInPromise: Promise<unknown> | undefined;

	private async signInWithGitHub(): Promise<void> {
		if (this.signInPromise) {
			await this.signInPromise;
			return;
		}
		this.signInPromise = this.commandService.executeCommand(DEFAULT_ACCOUNT_SIGN_IN_COMMAND).finally(() => {
			this.signInPromise = undefined;
		});
		await this.signInPromise;
	}

	private renderAvatar(container: HTMLElement, snapshot: ISingularityBillingSnapshot): void {
		const initials = DOM.append(container, $('span.singularity-profile-initials'));
		initials.textContent = snapshot.alias;
		if (!snapshot.avatarUrl) {
			return;
		}
		const img = DOM.append(container, $('img.singularity-profile-avatar-img')) as HTMLImageElement;
		img.alt = '';
		img.referrerPolicy = 'no-referrer';
		img.src = snapshot.avatarUrl;
		this.editorDisposables.add(DOM.addDisposableListener(img, 'error', () => img.remove()));
	}

	private addMeta(list: HTMLElement, label: string, value: string): void {
		DOM.append(list, $('dt')).textContent = label;
		DOM.append(list, $('dd')).textContent = value;
	}

	private addButton(parent: HTMLElement, label: string, secondary: boolean, run: () => void | Promise<void>): void {
		const button = this.editorDisposables.add(new Button(parent, { ...defaultButtonStyles, secondary }));
		button.label = label;
		this.editorDisposables.add(button.onDidClick(() => void run()));
	}
}

function planLabel(snapshot: ISingularityBillingSnapshot): string {
	switch (snapshot.kind) {
		case 'trial':
			return localize('singularity.profile.pill.trial', "Trial · {0}d left", snapshot.trialDaysRemaining);
		case 'subscribed':
			return localize('singularity.profile.pill.pro', "Unlimited");
		case 'expired':
			return localize('singularity.profile.pill.expired', "Trial ended");
		case 'restoring':
			return localize('singularity.profile.pill.restoring', "Restoring");
		default:
			return localize('singularity.profile.pill.signedOut', "Signed out");
	}
}
