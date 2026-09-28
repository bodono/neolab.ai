import type { AutoPauseReason } from "@neolab/sim/public";

export type ActiveClockSpeed = "1x" | "2x" | "4x";
export type ClockSpeed = "paused" | ActiveClockSpeed;
export type ClockPauseReason = "manual" | "auto-pause" | "run-ended" | "runtime-fault";

export interface ClockView {
  readonly speed: ClockSpeed;
  readonly selectedSpeed: ActiveClockSpeed;
  readonly paused: boolean;
  readonly pauseReason?: ClockPauseReason;
  readonly accumulatedDebtMs: number;
  readonly autoPauseReasons: readonly AutoPauseReason[];
}

export interface TickConsumptionResult {
  readonly autoPauseReasons: readonly AutoPauseReason[];
  readonly runStatus: "active" | "won" | "lost";
}

export interface AnimationFrameScheduler {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(requestId: number): void;
}

export interface ClockBalance {
  readonly millisecondsPerTick: Readonly<Record<ActiveClockSpeed, number>>;
  readonly maximumTicksPerFrame: number;
}

export interface ResumeResult {
  readonly resumed: boolean;
  readonly reason?: "disposed" | "run-ended" | "blocking-decision" | "runtime-fault";
}

const DEFAULT_BALANCE: ClockBalance = Object.freeze({
  millisecondsPerTick: Object.freeze({ "1x": 4_000, "2x": 2_000, "4x": 1_000 }),
  maximumTicksPerFrame: 4,
});

function browserScheduler(): AnimationFrameScheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (requestId) => cancelAnimationFrame(requestId),
  };
}

/**
 * Converts monotonic browser time into atomic simulation ticks. Elapsed time
 * is debt, never a tick count shortcut: no more than four ticks are consumed
 * per animation frame and any remainder survives for a later frame.
 *
 * Debt is held in ticks, not milliseconds, so changing speed never converts
 * time spent waiting for a slow tick into several fast ones; and whole ticks
 * of debt are dropped when the clock stops, so resuming after an auto-pause
 * never fires a burst of catch-up weeks past the decision that paused it.
 */
export class AnimationFrameClockDriver {
  readonly #consumeTick: () => TickConsumptionResult;
  readonly #onChange: () => void;
  readonly #scheduler: AnimationFrameScheduler;
  readonly #balance: ClockBalance;

  #selectedSpeed: ActiveClockSpeed = "1x";
  #paused = true;
  #pauseReason: ClockPauseReason | undefined = "manual";
  #autoPauseReasons: readonly AutoPauseReason[] = Object.freeze([]);
  /** Unconsumed simulation time, measured in ticks at any speed. */
  #tickDebt = 0;
  #lastFrameMs = 0;
  #frameRequestId: number | undefined;
  #disposed = false;
  #runEnded = false;

  constructor(
    consumeTick: () => TickConsumptionResult,
    onChange: () => void,
    scheduler: AnimationFrameScheduler = browserScheduler(),
    balance: ClockBalance = DEFAULT_BALANCE,
  ) {
    if (balance.maximumTicksPerFrame < 1) {
      throw new RangeError("maximumTicksPerFrame must be at least 1");
    }
    for (const milliseconds of Object.values(balance.millisecondsPerTick)) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        throw new RangeError("millisecondsPerTick values must be positive and finite");
      }
    }
    this.#consumeTick = consumeTick;
    this.#onChange = onChange;
    this.#scheduler = scheduler;
    this.#balance = balance;
  }

  getView(): ClockView {
    return Object.freeze({
      speed: this.#paused ? "paused" : this.#selectedSpeed,
      selectedSpeed: this.#selectedSpeed,
      paused: this.#paused,
      ...(this.#pauseReason === undefined ? {} : { pauseReason: this.#pauseReason }),
      accumulatedDebtMs:
        this.#tickDebt * this.#balance.millisecondsPerTick[this.#selectedSpeed],
      autoPauseReasons: Object.freeze([...this.#autoPauseReasons]),
    });
  }

  setSpeed(speed: ActiveClockSpeed): void {
    this.#assertUsable();
    if (this.#selectedSpeed === speed) return;
    const previousSpeed = this.#selectedSpeed;
    this.#selectedSpeed = speed;
    if (!this.#paused) {
      // Bank the time spent at the old speed before switching, so the tick
      // fraction already earned carries over unchanged.
      const now = this.#scheduler.now();
      this.#accrue(Math.max(0, now - this.#lastFrameMs), previousSpeed);
      this.#lastFrameMs = now;
    }
    this.#onChange();
  }

  resume(): ResumeResult {
    if (this.#disposed) return { resumed: false, reason: "disposed" };
    if (this.#runEnded) return { resumed: false, reason: "run-ended" };
    if (!this.#paused) return { resumed: true };

    this.#paused = false;
    this.#pauseReason = undefined;
    this.#autoPauseReasons = Object.freeze([]);
    this.#lastFrameMs = this.#scheduler.now();
    this.#scheduleFrame();
    this.#onChange();
    return { resumed: true };
  }

  pause(reason: ClockPauseReason = "manual"): void {
    this.#assertUsable();
    this.#stop(reason, this.#autoPauseReasons);
    this.#onChange();
  }

  stepOneTick(): TickConsumptionResult {
    this.#assertUsable();
    if (this.#runEnded) {
      throw new Error("Cannot step a completed run");
    }
    const outcome = this.#consumeTick();
    this.#acceptOutcome(outcome);
    this.#onChange();
    return outcome;
  }

  /** Publish a command transition through the same auto-pause path as ticks. */
  acceptExternalOutcome(outcome: TickConsumptionResult): void {
    this.#assertUsable();
    this.#acceptOutcome(outcome);
    this.#onChange();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#cancelScheduledFrame();
    this.#disposed = true;
    this.#paused = true;
    this.#pauseReason = "manual";
    this.#autoPauseReasons = Object.freeze([]);
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("AnimationFrameClockDriver is disposed");
  }

  #scheduleFrame(): void {
    if (this.#paused || this.#disposed || this.#frameRequestId !== undefined) return;
    this.#frameRequestId = this.#scheduler.requestFrame(this.#onAnimationFrame);
  }

  #cancelScheduledFrame(): void {
    if (this.#frameRequestId === undefined) return;
    this.#scheduler.cancelFrame(this.#frameRequestId);
    this.#frameRequestId = undefined;
  }

  readonly #onAnimationFrame = (timestamp: number): void => {
    this.#frameRequestId = undefined;
    if (this.#paused || this.#disposed) return;

    this.#accrue(Math.max(0, timestamp - this.#lastFrameMs), this.#selectedSpeed);
    this.#lastFrameMs = timestamp;
    let consumed = 0;

    while (
      !this.#paused &&
      this.#tickDebt >= 1 &&
      consumed < this.#balance.maximumTicksPerFrame
    ) {
      this.#tickDebt -= 1;
      consumed += 1;
      const outcome = this.#consumeTick();
      this.#acceptOutcome(outcome);
      // Publish each atomic tick, including the tick that caused an auto-pause.
      this.#onChange();
    }

    this.#scheduleFrame();
  };

  #accrue(elapsedMs: number, speed: ActiveClockSpeed): void {
    this.#tickDebt = Math.min(
      this.#tickDebt + elapsedMs / this.#balance.millisecondsPerTick[speed],
      this.#balance.maximumTicksPerFrame * 2,
    );
  }

  #acceptOutcome(outcome: TickConsumptionResult): void {
    if (outcome.runStatus !== "active") {
      this.#runEnded = true;
      this.#stop("run-ended", outcome.autoPauseReasons);
      return;
    }
    if (outcome.autoPauseReasons.length > 0) {
      this.#stop("auto-pause", outcome.autoPauseReasons);
    }
  }

  #stop(reason: ClockPauseReason, reasons: readonly AutoPauseReason[]): void {
    this.#cancelScheduledFrame();
    this.#paused = true;
    this.#pauseReason = reason;
    this.#autoPauseReasons = Object.freeze([...reasons]);
    // Keep progress toward the next tick, but never bank whole ticks across a
    // stop: they would fire together the moment the player resumes.
    this.#tickDebt %= 1;
  }
}
