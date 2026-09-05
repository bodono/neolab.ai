import { describe, expect, it } from "vitest";

import {
  AnimationFrameClockDriver,
  type AnimationFrameScheduler,
  type TickConsumptionResult,
} from "../animation-frame-clock-driver.ts";

class FakeAnimationFrameScheduler implements AnimationFrameScheduler {
  #now = 0;
  #nextId = 1;
  readonly #callbacks = new Map<number, FrameRequestCallback>();

  now(): number {
    return this.#now;
  }

  requestFrame(callback: FrameRequestCallback): number {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#callbacks.set(id, callback);
    return id;
  }

  cancelFrame(requestId: number): void {
    this.#callbacks.delete(requestId);
  }

  advanceFrame(timestamp: number): void {
    this.#now = timestamp;
    const entry = this.#callbacks.entries().next();
    if (entry.done) throw new Error("No animation frame is scheduled");
    const [id, callback] = entry.value;
    this.#callbacks.delete(id);
    callback(timestamp);
  }

  advanceWithoutFrame(timestamp: number): void {
    this.#now = timestamp;
  }

  get scheduledFrames(): number {
    return this.#callbacks.size;
  }
}

const activeOutcome = (): TickConsumptionResult => ({
  autoPauseReasons: [],
  runStatus: "active",
});

describe("AnimationFrameClockDriver", () => {
  it("uses elapsed monotonic time, caps work at four ticks, and carries debt", () => {
    const scheduler = new FakeAnimationFrameScheduler();
    let ticks = 0;
    const driver = new AnimationFrameClockDriver(
      () => {
        ticks += 1;
        return activeOutcome();
      },
      () => undefined,
      scheduler,
    );

    expect(driver.resume()).toEqual({ resumed: true });
    scheduler.advanceFrame(20_000);

    expect(ticks).toBe(4);
    expect(driver.getView().accumulatedDebtMs).toBe(4_000);
    expect(scheduler.scheduledFrames).toBe(1);

    // No additional wall time passes, but the fifth tick debt remains.
    scheduler.advanceFrame(20_000);
    expect(ticks).toBe(5);
    expect(driver.getView().accumulatedDebtMs).toBe(0);
  });

  it("freezes elapsed time while paused and retains partial tick debt", () => {
    const scheduler = new FakeAnimationFrameScheduler();
    let ticks = 0;
    const driver = new AnimationFrameClockDriver(
      () => {
        ticks += 1;
        return activeOutcome();
      },
      () => undefined,
      scheduler,
    );

    driver.resume();
    scheduler.advanceFrame(2_000);
    driver.pause();
    scheduler.advanceWithoutFrame(100_000);

    expect(driver.getView()).toMatchObject({
      paused: true,
      pauseReason: "manual",
      accumulatedDebtMs: 2_000,
    });
    expect(scheduler.scheduledFrames).toBe(0);

    driver.resume();
    scheduler.advanceFrame(102_000);
    expect(ticks).toBe(1);
  });

  it("clamps accumulated debt when returning from heavily throttled background tabs", () => {
    const scheduler = new FakeAnimationFrameScheduler();
    let ticks = 0;
    const driver = new AnimationFrameClockDriver(
      () => {
        ticks += 1;
        return activeOutcome();
      },
      () => undefined,
      scheduler,
    );

    driver.resume();
    // Simulate returning after 10 minutes (600,000ms) backgrounding
    scheduler.advanceFrame(600_000);
    expect(ticks).toBe(4);
    // At 1x (4,000ms/tick), max debt is 4 * 2 * 4,000 = 32,000ms. After 4 ticks (16,000ms), remaining is 16,000ms.
    expect(driver.getView().accumulatedDebtMs).toBe(16_000);
  });

  it("stops after the tick that returns an auto-pause and surfaces its reasons", () => {
    const scheduler = new FakeAnimationFrameScheduler();
    let ticks = 0;
    const driver = new AnimationFrameClockDriver(
      () => {
        ticks += 1;
        return ticks === 1
          ? { autoPauseReasons: ["critical-event"], runStatus: "active" }
          : activeOutcome();
      },
      () => undefined,
      scheduler,
    );

    driver.setSpeed("4x");
    driver.resume();
    scheduler.advanceFrame(8_000);

    expect(ticks).toBe(1);
    expect(driver.getView()).toMatchObject({
      speed: "paused",
      selectedSpeed: "4x",
      paused: true,
      pauseReason: "auto-pause",
      autoPauseReasons: ["critical-event"],
    });
    expect(scheduler.scheduledFrames).toBe(0);
  });

  it("cannot resume after a terminal tick", () => {
    const scheduler = new FakeAnimationFrameScheduler();
    const driver = new AnimationFrameClockDriver(
      () => ({ autoPauseReasons: [], runStatus: "lost" }),
      () => undefined,
      scheduler,
    );

    driver.stepOneTick();
    expect(driver.getView().pauseReason).toBe("run-ended");
    expect(driver.resume()).toEqual({ resumed: false, reason: "run-ended" });
  });
});
