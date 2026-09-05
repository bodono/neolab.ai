import type { NewGameConfig } from "@neolab/sim/public";

import type {
  BrowserGameRuntime,
  RuntimeReceipt,
  RuntimeSnapshot,
} from "../runtime/browser-game-runtime.ts";
import { activeTimeBucket, ratingBucket, weekBucket } from "./analytics-events.ts";
import type { AnalyticsClient } from "./analytics-client.ts";

export type RunAnalyticsSource = "new" | "resume" | "scenario" | "tutorial";

export function observeRuntimeAnalytics(options: {
  readonly runtime: Pick<BrowserGameRuntime, "getSnapshot" | "subscribe">;
  readonly analytics: AnalyticsClient;
  readonly source: RunAnalyticsSource;
  readonly newGameConfig?: NewGameConfig;
  readonly nowMilliseconds?: () => number;
}): () => void {
  const { runtime, analytics } = options;
  const nowMilliseconds = options.nowMilliseconds ?? (() => performance.now());
  const startedAt = nowMilliseconds();
  const initial = runtime.getSnapshot();
  const runId = initial.gameView.meta.runId;
  if (runId === undefined) return () => undefined;
  const telemetryRunId = analytics.ledger.telemetryRunId(runId);
  if (options.source === "new" && options.newGameConfig !== undefined) {
    analytics.ledger.emitOnce(runId, "run-started", () =>
      analytics.track("run_started", {
        telemetry_run_id: telemetryRunId,
        difficulty_id: options.newGameConfig!.difficultyId,
        mandate_id: options.newGameConfig!.mandateId,
        leader_id: options.newGameConfig!.leaderId,
        source: "new",
      }),
    );
  } else if (options.source !== "scenario" && options.source !== "tutorial") {
    analytics.track("run_resumed", {
      telemetry_run_id: telemetryRunId,
      source: options.source,
      week_bucket: weekBucket(initial.gameView.meta.tick),
    });
  }

  let lastReceipt = initial.lastReceipt;
  let lastStage = initial.gameView.endgame.stage;
  return runtime.subscribe((snapshot) => {
    if (snapshot.lastReceipt !== undefined && snapshot.lastReceipt !== lastReceipt) {
      lastReceipt = snapshot.lastReceipt;
      observeReceipt({
        analytics,
        runId,
        telemetryRunId,
        receipt: snapshot.lastReceipt,
        snapshot,
        source: options.source,
        activeMilliseconds: nowMilliseconds() - startedAt,
      });
    }
    const stage = snapshot.gameView.endgame.stage;
    if (stage !== lastStage) {
      lastStage = stage;
      analytics.ledger.emitOnce(runId, `endgame-stage:${stage}`, () =>
        analytics.track("endgame_stage_changed", {
          telemetry_run_id: telemetryRunId,
          stage,
          week_bucket: weekBucket(snapshot.gameView.meta.tick),
        }),
      );
    }
  });
}

function observeReceipt(options: {
  readonly analytics: AnalyticsClient;
  readonly runId: string;
  readonly telemetryRunId: string;
  readonly receipt: RuntimeReceipt;
  readonly snapshot: RuntimeSnapshot;
  readonly source: RunAnalyticsSource;
  readonly activeMilliseconds: number;
}): void {
  const { analytics, runId, telemetryRunId, receipt, snapshot } = options;
  const view = snapshot.gameView;
  const playerLabId = view.identity.labId;
  const playerModelIds = new Set(view.models.cards.map((model) => model.modelId));
  const resolvedEnding = receipt.domainEvents.find(
    (event) => event.kind === "endgame-ending-resolved",
  );
  const endingClass =
    resolvedEnding?.kind === "endgame-ending-resolved"
      ? resolvedEnding.endingClass
      : undefined;

  for (const event of receipt.domainEvents) {
    switch (event.kind) {
      case "researcher-recruited":
        if (event.labId === playerLabId) milestone("first_researcher_hired");
        break;
      case "funding-offer-accepted":
        if (event.labId === playerLabId) milestone("first_fundraise_closed");
        break;
      case "paper-discovered":
        if (event.labId === playerLabId) milestone("first_paper_discovered");
        break;
      case "training-completed":
        if (event.labId === playerLabId) milestone("first_model_trained");
        break;
      case "productisation-completed":
        if (event.labId === playerLabId) milestone("first_model_productised");
        break;
      case "model-deployment-changed":
        if (event.labId === playerLabId && event.policy !== "internal-only") {
          milestone("first_model_deployed");
        }
        break;
      case "capability-tier-reached":
        if (playerModelIds.has(event.modelId)) {
          milestone("model_tier", `tier_${String(event.level)}`);
        }
        break;
      case "agi-component-completed":
        if (event.labId === playerLabId) {
          milestone("agi_candidate_work", event.componentType);
        }
        break;
      case "agi-candidate-detected":
        if (playerModelIds.has(event.modelId)) milestone("candidate_threshold_cleared");
        break;
      case "endgame-crisis-started":
        if (playerModelIds.has(event.modelId)) milestone("deployment_crisis_started");
        break;
      case "decision-event-resolved":
        analytics.ledger.emitOnce(runId, `decision:${event.instanceId}`, () =>
          analytics.track("major_decision_resolved", {
            telemetry_run_id: telemetryRunId,
            decision_id: event.definitionId,
            option_id: event.optionId,
            resolution_kind: event.resolutionKind,
            week_bucket: weekBucket(receipt.tick),
          }),
        );
        break;
      case "endgame-ending-resolved":
        break;
      case "run-ended": {
        const bestCapability = Math.max(
          0,
          ...view.models.cards.map((model) => model.frontierCapabilityEstimate),
        );
        analytics.ledger.emitOnce(runId, "run-ended", () =>
          analytics.track("run_ended", {
            telemetry_run_id: telemetryRunId,
            result: event.result,
            ending_id: view.meta.endingId ?? "unknown",
            ending_class: endingClass ?? "unknown",
            source: options.source,
            week_bucket: weekBucket(receipt.tick),
            active_time_bucket: activeTimeBucket(options.activeMilliseconds),
            capability_bucket: ratingBucket(bestCapability),
            capability_research_bucket: ratingBucket(
              average(view.research.capabilityDomains.map((program) => program.level)),
            ),
            safety_research_bucket: ratingBucket(
              average(view.research.safetyPrograms.map((program) => program.level)),
            ),
            endgame_stage: view.endgame.stage,
          }),
        );
        break;
      }
      default:
        break;
    }
  }

  function milestone(milestoneName: string, detail?: string): void {
    const key = `milestone:${milestoneName}:${detail ?? ""}`;
    analytics.ledger.emitOnce(runId, key, () =>
      analytics.track("milestone_reached", {
        telemetry_run_id: telemetryRunId,
        milestone: milestoneName,
        ...(detail === undefined ? {} : { milestone_detail: detail }),
        week_bucket: weekBucket(receipt.tick),
      }),
    );
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
