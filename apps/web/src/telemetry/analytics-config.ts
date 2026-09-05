export interface AnalyticsEnvironment {
  readonly DEV?: boolean;
  readonly VITE_ANALYTICS_PROVIDER?: string;
  readonly VITE_UMAMI_WEBSITE_ID?: string;
  readonly VITE_DEPLOYMENT_CHANNEL?: string;
}

export interface HostedAnalyticsConfig {
  readonly provider: "umami";
  readonly websiteId: string;
  readonly scriptUrl: string;
  readonly deploymentChannel: string;
}

export function resolveAnalyticsConfig(
  environment: AnalyticsEnvironment,
  location: Pick<Location, "hostname" | "search">,
): HostedAnalyticsConfig | undefined {
  if (environment.DEV === true) return undefined;
  if (["localhost", "127.0.0.1", "::1"].includes(location.hostname)) return undefined;
  if (new URLSearchParams(location.search).has("scenario")) return undefined;
  if (environment.VITE_ANALYTICS_PROVIDER?.trim().toLowerCase() !== "umami") {
    return undefined;
  }
  const websiteId = environment.VITE_UMAMI_WEBSITE_ID?.trim();
  if (websiteId === undefined || websiteId.length === 0) return undefined;
  return {
    provider: "umami",
    websiteId,
    scriptUrl: "https://cloud.umami.is/script.js",
    deploymentChannel: environment.VITE_DEPLOYMENT_CHANNEL?.trim() || "production",
  };
}
