import { describe, expect, it } from "vitest";
import type { NewGameConfig } from "@neolab/sim/public";

import { AnalyticsClient } from "./analytics-client.ts";
import { resolveAnalyticsConfig } from "./analytics-config.ts";
import {
  activeTimeBucket,
  ratingBucket,
  validateAnalyticsEvent,
  weekBucket,
  type AnalyticsData,
  type AnalyticsEventName,
} from "./analytics-events.ts";
import { AnalyticsLedger } from "./analytics-ledger.ts";
import { sanitizeRuntimeFault } from "./crash-sanitizer.ts";
import { observeRuntimeAnalytics } from "./runtime-analytics-observer.ts";
import { UmamiProvider, type AnalyticsProvider } from "./umami-provider.ts";
import type {
  RuntimeListener,
  RuntimeReceipt,
  RuntimeSnapshot,
} from "../runtime/browser-game-runtime.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class RecordingProvider implements AnalyticsProvider {
  readonly events: { readonly name: AnalyticsEventName; readonly data: AnalyticsData }[] =
    [];
  disposed = false;

  track(name: AnalyticsEventName, data: AnalyticsData): void {
    this.events.push({ name, data });
  }

  dispose(): void {
    this.disposed = true;
  }
}

const hostedConfig = {
  provider: "umami" as const,
  websiteId: "website-123",
  scriptUrl: "https://cloud.umami.is/script.js",
  deploymentChannel: "github-pages",
};

describe("hosted analytics configuration", () => {
  it("enables only a configured production build and fixes the provider origin", () => {
    expect(
      resolveAnalyticsConfig(
        {
          VITE_ANALYTICS_PROVIDER: "umami",
          VITE_UMAMI_WEBSITE_ID: " website-123 ",
          VITE_DEPLOYMENT_CHANNEL: "itch",
        },
        { hostname: "play.neolab.ai", search: "" },
      ),
    ).toEqual({
      ...hostedConfig,
      deploymentChannel: "itch",
    });
  });

  it.each([
    [
      { DEV: true, VITE_ANALYTICS_PROVIDER: "umami", VITE_UMAMI_WEBSITE_ID: "id" },
      "play.neolab.ai",
      "",
    ],
    [{ VITE_ANALYTICS_PROVIDER: "umami", VITE_UMAMI_WEBSITE_ID: "id" }, "localhost", ""],
    [
      { VITE_ANALYTICS_PROVIDER: "umami", VITE_UMAMI_WEBSITE_ID: "id" },
      "play.neolab.ai",
      "?scenario=endgame",
    ],
    [{ VITE_ANALYTICS_PROVIDER: "umami" }, "play.neolab.ai", ""],
    [
      { VITE_ANALYTICS_PROVIDER: "ga4", VITE_UMAMI_WEBSITE_ID: "id" },
      "play.neolab.ai",
      "",
    ],
  ])(
    "stays disabled for development, scenarios, and incomplete configuration",
    (environment, hostname, search) => {
      expect(resolveAnalyticsConfig(environment, { hostname, search })).toBeUndefined();
    },
  );
});

describe("analytics privacy contract", () => {
  it("rejects unknown, sensitive, and non-finite event properties", () => {
    expect(() => validateAnalyticsEvent("app_loaded", { page_url: "/secret" })).toThrow(
      "not allowed",
    );
    expect(() => validateAnalyticsEvent("runtime_fault", { message: "private" })).toThrow(
      "not allowed",
    );
    expect(() =>
      validateAnalyticsEvent("run_ended", { capability_bucket: Number.NaN }),
    ).toThrow("finite");
  });

  it("buckets progress rather than transmitting precise continuous values", () => {
    expect([weekBucket(1), weekBucket(90), weekBucket(900)]).toEqual([
      "0-25",
      "52-103",
      "416+",
    ]);
    expect([ratingBucket(-4), ratingBucket(67.9), ratingBucket(104)]).toEqual([
      "0-9",
      "60-69",
      "100",
    ]);
    expect([activeTimeBucket(10 * 60_000), activeTimeBucket(3 * 60 * 60_000)]).toEqual([
      "<15m",
      "2-4h",
    ]);
  });
});

describe("analytics delivery and deduplication", () => {
  it("loads no provider when unavailable and stops delivery after disposal", () => {
    let unavailableProviderCreations = 0;
    const unavailable = new AnalyticsClient({
      applicationVersion: "test",
      createProvider: () => {
        unavailableProviderCreations += 1;
        return new RecordingProvider();
      },
    });
    unavailable.track("app_loaded", { visit_id: "visit" });
    expect(unavailableProviderCreations).toBe(0);

    const provider = new RecordingProvider();
    const configured = new AnalyticsClient({
      config: hostedConfig,
      storage: new MemoryStorage(),
      applicationVersion: "test",
      createProvider: () => provider,
    });
    configured.track("app_loaded", { visit_id: "visit" });
    expect(provider.events).toHaveLength(1);
    configured.dispose();
    configured.track("app_loaded", { visit_id: "another" });
    expect(provider.disposed).toBe(true);
    expect(provider.events).toHaveLength(1);
  });

  it("observes a run lifecycle and deduplicates canonical milestones", () => {
    const provider = new RecordingProvider();
    const storage = new MemoryStorage();
    const analytics = new AnalyticsClient({
      config: hostedConfig,
      storage,
      applicationVersion: "test",
      createProvider: () => provider,
    });
    let snapshot = runtimeSnapshot();
    let listener: RuntimeListener | undefined;
    const runtime = {
      getSnapshot: () => snapshot,
      subscribe: (next: RuntimeListener) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    const config = {
      difficultyId: "base:difficulty.standard",
      mandateId: "base:mandate.build-the-science",
      leaderId: "base:leader.dennis-hassabi",
    } as NewGameConfig;

    const unsubscribe = observeRuntimeAnalytics({
      runtime,
      analytics,
      source: "new",
      newGameConfig: config,
      nowMilliseconds: () => 1_000,
    });
    expect(provider.events.map((event) => event.name)).toEqual(["run_started"]);

    const receipt = {
      tick: 12,
      description: "training completed",
      domainEvents: [
        {
          kind: "training-completed",
          labId: "lab:player",
          projectId: "project:training",
          modelId: "model:aquarius-1",
          regressions: [],
        },
      ],
      autoPauseReasons: [],
      autosaveTriggers: [],
    } as unknown as RuntimeReceipt;
    snapshot = runtimeSnapshot(receipt);
    listener?.(snapshot);
    listener?.(snapshot);
    expect(provider.events.map((event) => event.name)).toEqual([
      "run_started",
      "milestone_reached",
    ]);
    expect(provider.events[1]?.data["milestone"]).toBe("first_model_trained");
    unsubscribe();

    observeRuntimeAnalytics({
      runtime,
      analytics,
      source: "new",
      newGameConfig: config,
      nowMilliseconds: () => 2_000,
    });
    expect(provider.events.filter((event) => event.name === "run_started")).toHaveLength(
      1,
    );
  });

  it("persists opaque run identity and emits exact-once milestones", () => {
    const storage = new MemoryStorage();
    const first = new AnalyticsLedger(storage);
    const telemetryRunId = first.telemetryRunId("local-run-id");
    let emissions = 0;
    expect(
      first.emitOnce("local-run-id", "first-model", () => {
        emissions += 1;
      }),
    ).toBe(true);
    expect(
      first.emitOnce("local-run-id", "first-model", () => {
        emissions += 1;
      }),
    ).toBe(false);
    expect(new AnalyticsLedger(storage).telemetryRunId("local-run-id")).toBe(
      telemetryRunId,
    );
    expect(emissions).toBe(1);
    expect(JSON.stringify([...storage.values.values()])).not.toContain("seed");
  });

  it("configures the Hosted Umami adapter without page views or query strings", () => {
    let loadListener: (() => void) | undefined;
    let removed = false;
    const script = {
      dataset: {} as Record<string, string>,
      defer: false,
      src: "",
      addEventListener: (name: string, listener: () => void) => {
        if (name === "load") loadListener = listener;
      },
      removeEventListener: () => undefined,
      remove: () => {
        removed = true;
      },
    };
    let appended: unknown;
    const document = {
      createElement: () => script,
      head: {
        append: (element: unknown) => {
          appended = element;
        },
      },
    };
    const delivered: { name: string; data: AnalyticsData | undefined }[] = [];
    const window = {} as Window & {
      umami?: { track(name: string, data?: AnalyticsData): void };
    };
    const provider = new UmamiProvider(hostedConfig, {
      window,
      document: document as unknown as Document,
    });

    expect(appended).toBe(script);
    expect(script.src).toBe("https://cloud.umami.is/script.js");
    expect(script.dataset).toMatchObject({
      websiteId: "website-123",
      autoTrack: "false",
      excludeSearch: "true",
    });

    provider.track("app_loaded", { visit_id: "visit" });
    window.umami = {
      track: (name, data) => delivered.push({ name, data }),
    };
    loadListener?.();
    expect(delivered).toEqual([{ name: "app_loaded", data: { visit_id: "visit" } }]);

    provider.dispose();
    expect(removed).toBe(true);
  });
});

function runtimeSnapshot(lastReceipt?: RuntimeReceipt): RuntimeSnapshot {
  return {
    gameView: {
      meta: { runId: "run:local:secret-id", tick: lastReceipt?.tick ?? 0 },
      identity: { labId: "lab:player" },
      models: { cards: [] },
      research: { capabilityDomains: [], safetyPrograms: [] },
      endgame: { stage: "pre-candidate" },
    },
    clockView: {},
    ...(lastReceipt === undefined ? {} : { lastReceipt }),
  } as unknown as RuntimeSnapshot;
}

describe("crash analytics", () => {
  it("sends a stable fingerprint and safe application frame without raw exception text", () => {
    const error = new TypeError("secret model name and hidden state");
    error.stack = [
      "TypeError: secret model name and hidden state",
      "  at finish (http://localhost:5173/src/features/models/training-dialog.tsx:44:9)",
      "  at user (/Users/alice/private/save.ts:12:1)",
    ].join("\n");
    const fault = {
      faultId: "runtime-fault:1",
      kind: "presentation" as const,
      scope: "application-shell" as const,
      code: "presentation-render-failed" as const,
      tick: 44,
    };

    const sanitized = sanitizeRuntimeFault(fault, error);
    expect(sanitized.error_class).toBe("TypeError");
    expect(sanitized.top_app_frame).toBe("features/models/training-dialog");
    expect(sanitized.fault_fingerprint).toMatch(/^f-[0-9a-f]{8}$/);
    expect(JSON.stringify(sanitized)).not.toContain("secret model");
    expect(JSON.stringify(sanitized)).not.toContain("alice");
    expect(sanitizeRuntimeFault(fault, error).fault_fingerprint).toBe(
      sanitized.fault_fingerprint,
    );
  });
});
