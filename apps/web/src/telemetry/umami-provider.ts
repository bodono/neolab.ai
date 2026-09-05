import type { AnalyticsData, AnalyticsEventName } from "./analytics-events.ts";
import type { HostedAnalyticsConfig } from "./analytics-config.ts";

interface UmamiApi {
  track(name: string, data?: AnalyticsData): void;
}

export interface AnalyticsProvider {
  track(name: AnalyticsEventName, data: AnalyticsData): void;
  dispose(): void;
}

export class UmamiProvider implements AnalyticsProvider {
  readonly #window: Window & { umami?: UmamiApi };
  readonly #document: Document;
  readonly #queue: { readonly name: AnalyticsEventName; readonly data: AnalyticsData }[] =
    [];
  readonly #script: HTMLScriptElement;
  #disposed = false;

  constructor(
    config: HostedAnalyticsConfig,
    browser: {
      readonly window: Window & { umami?: UmamiApi };
      readonly document: Document;
    },
  ) {
    this.#window = browser.window;
    this.#document = browser.document;
    this.#script = this.#document.createElement("script");
    this.#script.defer = true;
    this.#script.src = config.scriptUrl;
    this.#script.dataset["websiteId"] = config.websiteId;
    this.#script.dataset["autoTrack"] = "false";
    this.#script.dataset["excludeSearch"] = "true";
    this.#script.dataset["neolabAnalytics"] = "hosted-umami";
    this.#script.addEventListener("load", this.#flush);
    this.#document.head.append(this.#script);
  }

  track(name: AnalyticsEventName, data: AnalyticsData): void {
    if (this.#disposed) return;
    try {
      if (this.#window.umami !== undefined) this.#window.umami.track(name, data);
      else {
        this.#queue.push({ name, data });
        if (this.#queue.length > 64) this.#queue.shift();
      }
    } catch {
      // Analytics can never interrupt the game.
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#queue.length = 0;
    this.#script.removeEventListener("load", this.#flush);
    this.#script.remove();
  }

  readonly #flush = (): void => {
    if (this.#disposed || this.#window.umami === undefined) return;
    for (const item of this.#queue.splice(0)) {
      try {
        this.#window.umami.track(item.name, item.data);
      } catch {
        // A provider failure must not interrupt the game or later events.
      }
    }
  };
}
