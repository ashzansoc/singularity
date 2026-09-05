/**
 * Task classifier — maps user goals to locate | edit_local | implement | review | debug
 * and suggested routing tiers.
 */

export type TaskClass = 'locate' | 'edit_local' | 'implement' | 'review' | 'debug' | 'general';

export interface TaskClassification {
	taskClass: TaskClass;
	/** Suggested tier band, e.g. T1–T2 */
	tierHint: string;
	/** Prefer deterministic tools / repo map over frontier LLM. */
	preferTools: boolean;
	confidence: number;
	reasons: string[];
}

const LOCATE =
	/\b(where\s+is|find|locate|search|which\s+file|who\s+calls|references?\s+to)\b/i;
const EDIT_LOCAL =
	/\b(rename|rename\s+this|fix\s+typo|change\s+this\s+(variable|name|string)|update\s+this\s+line)\b/i;
const IMPLEMENT =
	/\b(implement|add\s+feature|build|create|oauth|migrate|refactor\s+across|wire\s+up)\b/i;
const REVIEW =
	/\b(review|audit|security|critique|look\s+over|code\s+review)\b/i;
const DEBUG =
	/\b(fix|bug|error|failing|stack\s*trace|doesn'?t\s+work|broken|diagnose)\b/i;

export function classifyTask(prompt: string): TaskClassification {
	const reasons: string[] = [];
	if (LOCATE.test(prompt)) {
		reasons.push('locate-pattern');
		return {
			taskClass: 'locate',
			tierHint: 'T1',
			preferTools: true,
			confidence: 0.85,
			reasons,
		};
	}
	if (EDIT_LOCAL.test(prompt)) {
		reasons.push('edit-local-pattern');
		return {
			taskClass: 'edit_local',
			tierHint: 'T2',
			preferTools: false,
			confidence: 0.8,
			reasons,
		};
	}
	if (DEBUG.test(prompt)) {
		reasons.push('debug-pattern');
		return {
			taskClass: 'debug',
			tierHint: 'T3',
			preferTools: true,
			confidence: 0.75,
			reasons,
		};
	}
	if (REVIEW.test(prompt)) {
		reasons.push('review-pattern');
		return {
			taskClass: 'review',
			tierHint: 'T5',
			preferTools: false,
			confidence: 0.8,
			reasons,
		};
	}
	if (IMPLEMENT.test(prompt)) {
		reasons.push('implement-pattern');
		return {
			taskClass: 'implement',
			tierHint: 'T4',
			preferTools: false,
			confidence: 0.8,
			reasons,
		};
	}
	reasons.push('default-general');
	return {
		taskClass: 'general',
		tierHint: 'T3',
		preferTools: false,
		confidence: 0.5,
		reasons,
	};
}

/** Map task class to router intent string. */
export function taskClassToIntent(taskClass: TaskClass): string {
	switch (taskClass) {
		case 'locate':
			return 'EXPLAIN';
		case 'edit_local':
			return 'EDIT';
		case 'implement':
			return 'IMPLEMENT';
		case 'review':
			return 'REVIEW';
		case 'debug':
			return 'DEBUG';
		default:
			return 'GENERAL';
	}
}
