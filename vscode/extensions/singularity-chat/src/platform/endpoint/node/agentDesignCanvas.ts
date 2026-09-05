/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Design Canvas HITL is disabled — Agent coding proceeds immediately after Spec.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpecification } from './designSpecV2Agent';

export type DesignCanvasUnlock = 'approved' | 'skipped';

interface GateFile {
	version: 1;
	status: 'awaiting_final' | 'approved' | 'skipped';
	specPath: string;
	productName?: string;
	notes?: string;
	updatedAt: string;
}

function gatePath(workspaceRoot: string): string {
	return path.join(workspaceRoot, '.singularity', 'design-preview.json');
}

function writeGate(workspaceRoot: string, status: GateFile['status'], patch: Partial<GateFile> = {}): void {
	const dir = path.join(workspaceRoot, '.singularity');
	fs.mkdirSync(dir, { recursive: true });
	const prev = readGate(workspaceRoot);
	const next: GateFile = {
		version: 1,
		status,
		specPath: patch.specPath ?? prev?.specPath ?? '.singularity/design-spec.json',
		productName: patch.productName ?? prev?.productName,
		notes: patch.notes ?? prev?.notes,
		updatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(gatePath(workspaceRoot), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function readGate(workspaceRoot: string): GateFile | undefined {
	const file = gatePath(workspaceRoot);
	if (!fs.existsSync(file)) {
		return undefined;
	}
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8')) as GateFile;
	} catch {
		return undefined;
	}
}

/** No-op unlock so callers never wait on Final Design. */
export async function openAgentDesignCanvasAndWait(options: {
	workspaceRoot: string;
	spec: DesignSpecification;
	log?: (msg: string) => void;
	timeoutMs?: number;
}): Promise<DesignCanvasUnlock> {
	const log = options.log ?? (() => { });
	const existing = readGate(options.workspaceRoot);
	if (existing?.status === 'approved' || existing?.status === 'skipped') {
		return existing.status;
	}
	writeGate(options.workspaceRoot, 'skipped', {
		productName: options.spec.product.name,
		notes: 'Design Canvas disabled',
	});
	log('[DesignCanvas] skipped — coding unlocked without preview');
	return 'skipped';
}
