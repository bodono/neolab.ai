import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_BASE_STRENGTH,
  CHECKPOINT_TECHNICAL_LEAD_BONUS,
  TRAINING_REFERENCE_WEEKS,
  trainingRiskAdjustment,
  type TrainingTrackRecord,
} from "../training.ts";
import { logisticProbability } from "../../engine/checks.ts";
import { totalFlopInvested } from "../../compute/flops.ts";

/**
 * Checkpoint strength with an assigned technical lead — 56.5 for every lab in
 * every run. These cases used to feed a varying engineering quality here, but
 * the stat was frozen at 50 for the whole life of the game, so any other value
 * described a run that could not occur; the envelope below is the real one.
 */
const LEAD_STRENGTH = CHECKPOINT_BASE_STRENGTH + CHECKPOINT_TECHNICAL_LEAD_BONUS;

/** Difficulty a checkpoint faces, mirroring runFailureCheck's assembly. */
function checkpointDifficulty(options: {
  readonly complexity: number;
  readonly postureDelta: number;
  readonly reliability: number;
  readonly stretch: number;
  readonly duration: number;
}): number {
  return (
    options.complexity +
    5 +
    options.postureDelta +
    (100 - options.reliability) * 0.35 +
    options.stretch +
    options.duration
  );
}

function passProbability(strength: number, difficulty: number): number {
  return Math.min(0.95, Math.max(0.05, logisticProbability(strength, difficulty)));
}

/** era-reference FLOP for a run of reference length at this per-GPU rating. */
function eraReferenceFlop(eraGpuTeraflops: number, referenceGpus = 10_000): number {
  return totalFlopInvested(referenceGpus * eraGpuTeraflops, TRAINING_REFERENCE_WEEKS);
}

describe("training risk stays survivable at every scale", () => {
  it("leaves an ordinary opening run safe", () => {
    // A starting lab cannot out-reach the era norm: 2,000 GPUs for the maximum
    // 78 weeks is still under a 10,000-GPU reference run, so stretch is zero
    // and the danger only appears once there is a track record to leap beyond.
    const record: TrainingTrackRecord = {
      completedRuns: 0,
      bestRunFlop: 0,
      bestCapability: 0,
    };
    const reference = eraReferenceFlop(4);
    const risk = trainingRiskAdjustment(
      record,
      totalFlopInvested(8_000, 8),
      8,
      reference,
    );
    expect(risk.stretchDifficulty).toBe(0);
    const probability = passProbability(
      LEAD_STRENGTH + risk.experienceStrength + risk.capabilityStrength,
      checkpointDifficulty({
        complexity: 12,
        postureDelta: 0,
        reliability: 62,
        stretch: risk.stretchDifficulty,
        duration: risk.durationDifficulty,
      }),
    );
    expect(probability).toBeGreaterThan(0.85);
  });

  it("makes over-reaching your own best run genuinely dangerous", () => {
    // The reachable version of recklessness: one model landed, and the next run
    // reaches eight times past it while the lab has almost no track record.
    const record: TrainingTrackRecord = {
      completedRuns: 1,
      bestRunFlop: 1e24,
      bestCapability: 15,
    };
    const risk = trainingRiskAdjustment(record, 4e24, 30, eraReferenceFlop(12));
    const probability = passProbability(
      LEAD_STRENGTH + risk.experienceStrength + risk.capabilityStrength,
      checkpointDifficulty({
        complexity: 28,
        postureDelta: 0,
        reliability: 72,
        stretch: risk.stretchDifficulty,
        duration: risk.durationDifficulty,
      }),
    );
    expect(risk.stretchDifficulty).toBeCloseTo(20, 6);
    // Dangerous, and deliberately not hopeless.
    expect(probability).toBeLessThan(0.4);
    expect(probability).toBeGreaterThan(0.05);
  });

  it("rewards accumulated experience on a steady endgame run", () => {
    // A lab that has already landed twenty generations should not face a coin
    // flip merely for doubling its previous best. The run remains below the
    // clamp, leaving room for outages and researcher hazard modifiers to move
    // the quoted probability in either direction.
    const record: TrainingTrackRecord = {
      completedRuns: 20,
      bestRunFlop: 1e28,
      bestCapability: 90,
    };
    const risk = trainingRiskAdjustment(record, 2e28, 26, eraReferenceFlop(2_400));
    const probability = passProbability(
      LEAD_STRENGTH + risk.experienceStrength + risk.capabilityStrength,
      checkpointDifficulty({
        complexity: 48,
        postureDelta: 0,
        reliability: 92,
        stretch: risk.stretchDifficulty,
        duration: risk.durationDifficulty,
      }),
    );
    expect(probability).toBeGreaterThan(0.9);
    expect(probability).toBeLessThan(0.95);
  });

  it("keeps a four-times endgame leap materially riskier than steady scaling", () => {
    // Four times the lab's previous best still has a meaningful chance of at
    // least one setback even after twenty completed runs. That is the intended
    // risk: experienced labs usually finish, but reaching far past their track
    // record is not clean or free.
    const record: TrainingTrackRecord = {
      completedRuns: 20,
      bestRunFlop: 1e28,
      bestCapability: 90,
    };
    const risk = trainingRiskAdjustment(record, 4e28, 26, eraReferenceFlop(2_400));
    const probability = passProbability(
      LEAD_STRENGTH + risk.experienceStrength + risk.capabilityStrength,
      checkpointDifficulty({
        complexity: 48,
        postureDelta: 0,
        reliability: 92,
        stretch: risk.stretchDifficulty,
        duration: risk.durationDifficulty,
      }),
    );
    expect(probability).toBeGreaterThan(0.8);
    expect(probability).toBeLessThan(0.88);
  });

  it("keeps even a YOLO endgame run above the floor", () => {
    const record: TrainingTrackRecord = {
      completedRuns: 20,
      bestRunFlop: 1e28,
      bestCapability: 90,
    };
    const risk = trainingRiskAdjustment(record, 8e28, 52, eraReferenceFlop(2_400));
    const probability = passProbability(
      LEAD_STRENGTH + risk.experienceStrength + risk.capabilityStrength,
      checkpointDifficulty({
        complexity: 48,
        postureDelta: 12,
        reliability: 92,
        stretch: risk.stretchDifficulty,
        duration: risk.durationDifficulty,
      }),
    );
    // The most reckless endgame play available: eight times the lab's best,
    // half a year, on the posture that already adds 12 to every checkpoint.
    // This one is SUPPOSED to be a gamble -- the feasibility guarantee is about
    // the steady and 4x runs above, not about this.
    expect(probability).toBeGreaterThan(0.05);
    expect(probability).toBeLessThan(0.5);
  });

  it("charges a constant premium to a lab that doubles every run", () => {
    // Steady scaling is the intended path: the stretch term stays flat because
    // it is measured against your own best, while experience keeps accruing.
    // Risk must therefore FALL across a campaign, not climb.
    const probabilities = [1, 2, 4, 8, 12].map((runs) => {
      const record: TrainingTrackRecord = {
        completedRuns: runs,
        bestRunFlop: 1e24 * Math.pow(2, runs),
        bestCapability: Math.min(90, 20 + runs * 6),
      };
      const risk = trainingRiskAdjustment(
        record,
        1e24 * Math.pow(2, runs + 1),
        12,
        eraReferenceFlop(80),
      );
      return passProbability(
        LEAD_STRENGTH + risk.experienceStrength + risk.capabilityStrength,
        checkpointDifficulty({
          complexity: 48,
          postureDelta: 0,
          reliability: 84,
          stretch: risk.stretchDifficulty,
          duration: risk.durationDifficulty,
        }),
      );
    });
    // Each doubling costs exactly the same stretch premium...
    const stretches = [1, 2, 4].map(
      (runs) =>
        trainingRiskAdjustment(
          { completedRuns: runs, bestRunFlop: 1e24, bestCapability: 0 },
          2e24,
          12,
          eraReferenceFlop(80),
        ).stretchDifficulty,
    );
    expect(new Set(stretches.map((value) => value.toFixed(6))).size).toBe(1);
    // ...so experience wins and the campaign gets safer, never harder.
    for (let index = 1; index < probabilities.length; index += 1) {
      expect(probabilities[index]).toBeGreaterThanOrEqual(
        (probabilities[index - 1] ?? 0) - 1e-9,
      );
    }
    expect(probabilities.at(-1)).toBeGreaterThan(probabilities[0] ?? 0);
  });

  it("charges nothing for repeating a size the lab has already landed", () => {
    const record: TrainingTrackRecord = {
      completedRuns: 6,
      bestRunFlop: 5e26,
      bestCapability: 60,
    };
    const risk = trainingRiskAdjustment(
      record,
      5e26,
      TRAINING_REFERENCE_WEEKS,
      eraReferenceFlop(200),
    );
    expect(risk.stretchDifficulty).toBe(0);
    expect(risk.durationDifficulty).toBe(0);
    expect(risk.experienceStrength).toBeGreaterThan(0);
  });
});
