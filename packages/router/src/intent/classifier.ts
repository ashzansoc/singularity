import type { IntentClassification, RouteFeatures, TelemetryEvent } from '../types.js';
import { applyIntentRules } from './rules.js';

export class RuleIntentClassifier {
  constructor(private readonly onTelemetry?: (event: TelemetryEvent) => void) {}

  classify(features: RouteFeatures): IntentClassification {
    const result = applyIntentRules(features);
    this.onTelemetry?.({
      type: 'intent',
      timestamp: Date.now(),
      payload: {
        intent: result.intent,
        confidence: result.confidence,
        matchedRule: result.matchedRule,
        mode: features.mode,
      },
    });
    return result;
  }
}
