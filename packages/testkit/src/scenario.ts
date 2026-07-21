import { loadCompiledContent } from "@neolab/content";
import { contentId, type CompiledContent } from "@neolab/content-schema";
import {
  calendarFromTick,
  createNewGame,
  seed128,
  validateGameState,
  type GameState,
  type RatingKey,
} from "@neolab/sim";

/**
 * Scenario builders with safe defaults (TDD section 25.2).
 *
 * `scenario()` starts from a real `createNewGame` run and applies targeted
 * edits; `build()` validates the result. Tests that need deliberately
 * impossible state must opt into `unsafeFixture(reason)`.
 */

let cachedContent: CompiledContent | undefined;

export function scenarioContent(): CompiledContent {
  cachedContent ??= loadCompiledContent();
  return cachedContent;
}

type MutableState = {
  -readonly [K in keyof GameState]: GameState[K];
} & Record<string, unknown>;

interface LabEdit {
  (state: MutableState, content: CompiledContent): void;
}

export class PlayerLabBuilder {
  readonly edits: LabEdit[] = [];

  private lab(state: MutableState) {
    const runState = state["run"] as { playerLabId: string };
    const labs = state["labs"] as unknown as Record<string, Record<string, unknown>>;
    const lab = labs[runState.playerLabId];
    if (lab === undefined) {
      throw new Error("scenario: player lab missing");
    }
    return lab;
  }

  cash(amount: number): this {
    this.edits.push((state) => {
      (this.lab(state)["finance"] as { cash: number }).cash = amount;
    });
    return this;
  }

  aura(spendable: number, lifetime?: number): this {
    this.edits.push((state) => {
      const aura = this.lab(state)["aura"] as { spendable: number; lifetime: number };
      aura.spendable = spendable;
      aura.lifetime = Math.max(lifetime ?? spendable, spendable);
    });
    return this;
  }

  /** Replace the whole fleet with one owned lot of the given generation. */
  gpus(generation: string, count: number): this {
    this.edits.push((state, content) => {
      const generationId = generation.includes(":")
        ? contentId(generation)
        : contentId(`base:${generation}`);
      const definition = content.gpuGenerations[generationId];
      if (definition === undefined) {
        throw new Error(`scenario: unknown GPU generation ${generationId}`);
      }
      const compute = this.lab(state)["compute"] as {
        lots: {
          id: string;
          generationId: string;
          ownership: string;
          physicalCount: number;
          availableFraction: number;
          reliability: number;
        }[];
      };
      compute.lots = [
        {
          id: "run:gpu-lot:player:0000",
          generationId,
          ownership: "owned",
          physicalCount: count,
          availableFraction: 1,
          reliability: definition.reliability,
        },
      ];
    });
    return this;
  }

  rating(key: RatingKey, value: number): this {
    this.edits.push((state) => {
      const lab = this.lab(state);
      const safety = lab["safety"] as Record<string, number>;
      const organisation = lab["organisation"] as Record<string, number>;
      const politics = lab["politics"] as Record<string, number>;
      const slice: Record<string, number> | undefined =
        key in safety
          ? safety
          : key === "internalCandour"
            ? organisation
            : key in organisation
              ? organisation
              : key in politics
                ? politics
                : undefined;
      if (slice === undefined) {
        throw new Error(`scenario: unmapped rating ${key}`);
      }
      slice[key === "internalCandour" ? "hiddenInternalCandour" : key] = value;
    });
    return this;
  }
}

export class ScenarioBuilder {
  private seedHex = "0123456789abcdef0123456789abcdef";
  private leaderId = "base:leader.sam-altmann";
  private difficultyId = "base:difficulty.standard";
  private mandateId = "base:mandate.build-the-science";
  private tickValue = 0;
  private readonly labBuilder = new PlayerLabBuilder();
  private validating = true;
  private unsafeReason: string | undefined;

  withSeed(seedHex: string): this {
    this.seedHex = seedHex;
    return this;
  }

  withLeader(leaderId: string): this {
    this.leaderId = leaderId;
    return this;
  }

  withDifficulty(difficultyId: string): this {
    this.difficultyId = difficultyId;
    return this;
  }

  withMandate(mandateId: string): this {
    this.mandateId = mandateId;
    return this;
  }

  atTick(tick: number): this {
    this.tickValue = tick;
    return this;
  }

  withPlayerLab(configure: (lab: PlayerLabBuilder) => PlayerLabBuilder): this {
    configure(this.labBuilder);
    return this;
  }

  /**
   * Escape hatch for deliberately impossible states (TDD 25.2). The reason is
   * mandatory and should say why validity must be violated.
   */
  unsafeFixture(reason: string): this {
    if (reason.trim().length === 0) {
      throw new Error("unsafeFixture requires a reason");
    }
    this.validating = false;
    this.unsafeReason = reason;
    return this;
  }

  build(): GameState {
    const content = scenarioContent();
    const base = createNewGame(
      {
        seed: seed128(this.seedHex),
        difficultyId: contentId(this.difficultyId),
        leaderId: contentId(this.leaderId),
        mandateId: contentId(this.mandateId),
      },
      content,
    );
    const draft = structuredClone(base) as MutableState;

    if (this.tickValue !== 0) {
      const run = draft["run"] as { tick: number; calendar: unknown };
      run.tick = this.tickValue;
      run.calendar = calendarFromTick(this.tickValue);
    }
    for (const edit of this.labBuilder.edits) {
      edit(draft, content);
    }

    if (!this.validating) {
      return draft;
    }
    try {
      return validateGameState(draft);
    } catch (error) {
      throw new Error(
        `scenario().build() produced invalid state — fix the fixture or use ` +
          `unsafeFixture(reason): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  get reason(): string | undefined {
    return this.unsafeReason;
  }
}

export function scenario(): ScenarioBuilder {
  return new ScenarioBuilder();
}
