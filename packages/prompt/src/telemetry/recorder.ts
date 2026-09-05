/**
 * Level 15 — Telemetry recorder
 */

import { SqliteStore } from '@singularity/cache';
import type { TelemetryEvent, TelemetryRecorder } from '../interfaces/index.js';

export class InMemoryTelemetryRecorder implements TelemetryRecorder {
	private readonly events: TelemetryEvent[] = [];
	private readonly maxEvents: number;
	private readonly durable?: SqliteStore;
	private readonly workspaceId: string;

	constructor(opts?: { maxEvents?: number; durableDir?: string; workspaceId?: string }) {
		this.maxEvents = opts?.maxEvents ?? 500;
		this.workspaceId = opts?.workspaceId ?? 'default';
		if (opts?.durableDir) {
			this.durable = new SqliteStore({
				dir: opts.durableDir,
				filename: 'prompt-telemetry.json',
			});
		}
	}

	record(event: TelemetryEvent): void {
		this.events.push(event);
		while (this.events.length > this.maxEvents) {
			this.events.shift();
		}
		this.durable?.set({
			key: `tel:${event.requestId}:${event.timestamp}`,
			value: JSON.stringify(event),
			expiresAt: Date.now() + 7 * 86_400_000,
			meta: {
				layer: 'L8',
				workspaceId: this.workspaceId,
				createdAt: event.timestamp,
				expiresAt: Date.now() + 7 * 86_400_000,
			},
		});
	}

	list(limit = 50): TelemetryEvent[] {
		return this.events.slice(-limit);
	}

	clear(): void {
		this.events.length = 0;
	}
}
