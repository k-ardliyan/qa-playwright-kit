/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 */

import type { BrowserIntent } from '../../shared/types/browser-intent.types';
import type {
  LiveVerificationResult,
  VerificationObservation,
} from '../../shared/types/live-verification.types';
import type { LocatorCandidate } from '../../shared/types/locator-candidate.types';
import {
  shouldExploreLive,
  type ExplorationDecisionInput,
} from '../../shared/mcp/exploration-policy';
import { resolveLocatorPriority } from '../../shared/mcp/locator-priority';
import { evaluateCatalogFreshness, type CatalogMetadata } from '../../shared/mcp/catalog-evaluator';

export interface GateInput {
  scenarioId: string;
  intent?: BrowserIntent;
  catalogMetadata?: CatalogMetadata | null;
  hasExistingPom?: boolean;
  isNewFeature?: boolean;
  isHealerRetry?: boolean;
  discoveredCandidates?: LocatorCandidate[];
  observations?: VerificationObservation[];
}

export class LiveVerificationGate {
  /**
   * Run the live verification pre-generation gate.
   */
  public static evaluate(input: GateInput): LiveVerificationResult {
    const catalogFreshness = evaluateCatalogFreshness(input.catalogMetadata);

    const decisionInput: ExplorationDecisionInput = {
      hasExistingPom: input.hasExistingPom,
      catalogFreshness,
      intent: input.intent,
      isHealerRetry: input.isHealerRetry,
      isNewFeature: input.isNewFeature,
    };

    const decision = shouldExploreLive(decisionInput);
    const warnings: string[] = [];

    const candidates = input.discoveredCandidates ?? [];
    const priorityResult = resolveLocatorPriority(candidates);

    if (decision.shouldExplore && candidates.length === 0) {
      warnings.push(
        `Exploration was recommended (${decision.reason}) but no live locator candidates were provided.`,
      );
    }

    const observations = input.observations ?? [];
    const failedObs = observations.filter((o) => !o.passed);

    if (failedObs.length > 0) {
      warnings.push(`${failedObs.length} semantic observation(s) failed during live verification.`);
    }

    const verified =
      failedObs.length === 0 &&
      (!decision.shouldExplore || candidates.length > 0 || input.hasExistingPom === true);

    return {
      scenarioId: input.scenarioId,
      verified,
      observations,
      locatorCandidates: priorityResult.ranking,
      warnings,
    };
  }
}
