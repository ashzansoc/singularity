/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../nls.js';
import type { IChatAgentTeamProgress } from '../../../common/chatService/chatService.js';
import type { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';

export class ChatAgentTeamContentPart extends Disposable implements IChatContentPart {
	public readonly domNode: HTMLElement;
	private expanded = false;
	private readonly header: HTMLElement;
	private readonly body: HTMLElement;
	private readonly agentsList: HTMLElement;

	constructor(
		private content: IChatAgentTeamProgress,
		_context: IChatContentPartRenderContext,
	) {
		super();
		this.expanded = content.expanded;
		this.domNode = $('.chat-agent-team-panel');
		this.header = append(this.domNode, $('.chat-agent-team-header'));
		this.body = append(this.domNode, $('.chat-agent-team-body'));
		this.agentsList = append(this.body, $('.chat-agent-team-agents'));
		this.render();
	}

	updateContent(content: IChatAgentTeamProgress): void {
		this.content = content;
		this.expanded = content.expanded;
		this.render();
	}

	hasSameContent(other: IChatAgentTeamProgress): boolean {
		return other.id === this.content.id && other.workflowId === this.content.workflowId;
	}

	private render(): void {
		clearNode(this.header);
		clearNode(this.agentsList);

		const s = this.content.summary;
		const pct = s.percent !== undefined ? ` · ${s.percent}%` : '';
		append(this.header, $('div', undefined, `✦ ${localize('agentTeam.title', 'Singularity assembled an agent team')}`));
		append(this.header, $('div', undefined, `${s.total} agents working${pct}`));
		append(
			this.header,
			$('div', undefined,
				`✓ ${s.completed} completed · ● ${s.working} working · ◌ ${s.queued} queued` +
				(s.blocked ? ` · ⚠ ${s.blocked} blocked` : '') +
				(s.failed ? ` · ✗ ${s.failed} failed` : ''),
			),
		);
		append(this.header, $('div.agent-team-phase', undefined, s.phaseLabel));

		const toggle = append(this.header, $('button.agent-team-toggle')) as HTMLButtonElement;
		toggle.textContent = this.expanded
			? localize('agentTeam.hide', 'Hide agents')
			: localize('agentTeam.view', 'View agents');
		toggle.onclick = () => {
			this.expanded = !this.expanded;
			this.body.style.display = this.expanded ? 'block' : 'none';
			toggle.textContent = this.expanded
				? localize('agentTeam.hide', 'Hide agents')
				: localize('agentTeam.view', 'View agents');
		};

		this.body.style.display = this.expanded ? 'block' : 'none';

		for (const agent of this.content.agents) {
			const icon =
				agent.status === 'completed' ? '✓'
					: agent.status === 'working' || agent.status === 'verifying' ? '●'
						: agent.status === 'blocked' ? '⚠'
							: agent.status === 'failed' ? '✗'
								: '◌';
			const row = append(this.agentsList, $('.chat-agent-team-row'));
			const progress = agent.progressLabel ? ` · ${agent.progressLabel}` : '';
			append(row, $('div', undefined, `${icon} ${agent.agentId} — ${agent.role}`));
			append(row, $('div.agent-team-activity', undefined, `${agent.activity ?? agent.title}${progress}`));
			append(row, $('div.agent-team-deliverable', undefined, localize('agentTeam.delivering', 'Delivering: {0}', agent.deliverable)));
			if (agent.blockedBy) {
				append(row, $('div.agent-team-blocked', undefined, localize('agentTeam.blocked', 'Blocked: {0}', agent.blockedBy)));
			}
		}
	}
}
