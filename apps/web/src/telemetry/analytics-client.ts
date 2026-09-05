import {
  ANALYTICS_SCHEMA_VERSION,
  validateAnalyticsEvent,
  type AnalyticsData,
  type AnalyticsEventName,
  type AnalyticsValue,
} from "./analytics-events.ts";
import type { HostedAnalyticsConfig } from "./analytics-config.ts";
import { AnalyticsLedger, type AnalyticsLedgerStorage } from "./analytics-ledger.ts";
import { sanitizeRuntimeFault } from "./crash-sanitizer.ts";
import { UmamiProvider, type AnalyticsProvider } from "./umami-provider.ts";
import type { RuntimeFault } from "../runtime/browser-game-runtime.ts";

export interface AnalyticsClientOptions {
  readonly config?: HostedAnalyticsConfig;
  readonly storage?: AnalyticsLedgerStorage;
  readonly applicationVersion: string;
  readonly browser?: { readonly window: Window; readonly document: Document };
  readonly createProvider?: (config: HostedAnalyticsConfig) => AnalyticsProvider;
}

export class AnalyticsClient {
  readonly ledger: AnalyticsLedger;
  readonly #config: HostedAnalyticsConfig | undefined;
  readonly #applicationVersion: string;
  readonly #createProvider:
    ((config: HostedAnalyticsConfig) => AnalyticsProvider) | undefined;
  readonly #visitId = createOpaqueVisitId();
  #provider: AnalyticsProvider | undefined;

  constructor(options: AnalyticsClientOptions) {
    this.#config = options.config;
    this.#applicationVersion = options.applicationVersion;
    this.ledger = new AnalyticsLedger(options.storage);
    this.#createProvider =
      options.createProvider ??
      (options.browser === undefined
        ? undefined
        : (config) => new UmamiProvider(config, options.browser!));
    this.#createConfiguredProvider();
  }

  get visitId(): string {
    return this.#visitId;
  }

  track(name: AnalyticsEventName, data: AnalyticsData): void {
    try {
      const clean = validateAnalyticsEvent(name, data);
      const providerData: Record<string, AnalyticsValue> = {
        ...clean,
        schema_version: ANALYTICS_SCHEMA_VERSION,
        app_version: this.#applicationVersion,
        deployment_channel: this.#config?.deploymentChannel ?? "unavailable",
      };
      this.#provider?.track(name, providerData);
    } catch {
      // Invalid or unavailable analytics must never interrupt the game.
    }
  }

  trackRuntimeFault(fault: RuntimeFault, error: unknown): void {
    this.track("runtime_fault", { ...sanitizeRuntimeFault(fault, error) });
  }

  dispose(): void {
    this.#provider?.dispose();
    this.#provider = undefined;
  }

  #createConfiguredProvider(): void {
    if (
      this.#provider === undefined &&
      this.#config !== undefined &&
      this.#createProvider !== undefined
    ) {
      try {
        this.#provider = this.#createProvider(this.#config);
      } catch {
        this.#provider = undefined;
      }
    }
  }
}

function createOpaqueVisitId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `visit-${Math.random().toString(36).slice(2)}`;
  }
}
