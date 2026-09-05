/**
 * Relevance gate — skip trivial messages that do not change project state.
 */

const TRIVIAL_EXACT = new Set(
  [
    'thanks',
    'thank you',
    'thx',
    'ok',
    'okay',
    'yes',
    'yep',
    'yeah',
    'no',
    'nope',
    'looks good',
    'lgtm',
    'run it',
    'run',
    'go',
    'sure',
    'cool',
    'great',
    'nice',
    'perfect',
    'done',
    'got it',
  ].map((s) => s.toLowerCase()),
);

const SIGNAL_RE =
  /\b(use|don't|do not|dont|must|should|prefer|instead|switch to|migrate|deploy|add|remove|replace|constraint|require|need|build|implement|auth|oauth|stripe|postgres|mongodb|firebase|redis|next\.?js|typescript|tailwind|aws|docker)\b/i;

/**
 * Return true when the message likely contains project-relevant information.
 */
export function shouldExtract(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase().replace(/[!?.]+$/g, '').trim();
  if (TRIVIAL_EXACT.has(normalized)) {
    return false;
  }
  if (trimmed.length < 12 && !SIGNAL_RE.test(trimmed)) {
    return false;
  }
  if (SIGNAL_RE.test(trimmed)) {
    return true;
  }
  // Longer messages without obvious signals may still carry requirements
  return trimmed.length >= 80;
}

/**
 * Prefer sync extraction for short, high-signal messages; async otherwise.
 */
export function preferSyncExtraction(message: string): boolean {
  return shouldExtract(message) && message.trim().length <= 400;
}
