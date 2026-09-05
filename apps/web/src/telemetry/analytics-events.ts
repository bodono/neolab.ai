export const ANALYTICS_SCHEMA_VERSION = 1;

export type AnalyticsEventName =
  | "app_loaded"
  | "game_setup_opened"
  | "run_started"
  | "run_resumed"
  | "milestone_reached"
  | "endgame_stage_changed"
  | "major_decision_resolved"
  | "run_ended"
  | "runtime_fault";

export type AnalyticsValue = string | number | boolean;
export type AnalyticsData = Readonly<Record<string, AnalyticsValue>>;

const EVENT_KEYS: Readonly<Record<AnalyticsEventName, ReadonlySet<string>>> = {
  app_loaded: new Set(["visit_id"]),
  game_setup_opened: new Set(["visit_id"]),
  run_started: new Set([
    "telemetry_run_id",
    "difficulty_id",
    "mandate_id",
    "leader_id",
    "source",
  ]),
  run_resumed: new Set(["telemetry_run_id", "source", "week_bucket"]),
  milestone_reached: new Set([
    "telemetry_run_id",
    "milestone",
    "milestone_detail",
    "week_bucket",
  ]),
  endgame_stage_changed: new Set(["telemetry_run_id", "stage", "week_bucket"]),
  major_decision_resolved: new Set([
    "telemetry_run_id",
    "decision_id",
    "option_id",
    "resolution_kind",
    "week_bucket",
  ]),
  run_ended: new Set([
    "telemetry_run_id",
    "result",
    "ending_id",
    "ending_class",
    "human_outcome",
    "source",
    "week_bucket",
    "active_time_bucket",
    "capability_bucket",
    "capability_research_bucket",
    "safety_research_bucket",
    "endgame_stage",
  ]),
  runtime_fault: new Set([
    "fault_kind",
    "fault_scope",
    "fault_code",
    "error_class",
    "fault_fingerprint",
    "top_app_frame",
    "week_bucket",
  ]),
};

const FORBIDDEN_KEY =
  /(seed|stack|message|url|user.?agent|save|state|alignment|deception|corrigibility|awareness|email|name)$/i;

export function validateAnalyticsEvent(
  name: AnalyticsEventName,
  data: AnalyticsData,
): AnalyticsData {
  const allowed = EVENT_KEYS[name];
  const clean: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key))
      throw new Error(`Analytics field is not allowed: ${name}.${key}`);
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`Sensitive analytics field is forbidden: ${name}.${key}`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Analytics number must be finite: ${name}.${key}`);
    }
    clean[key] = typeof value === "string" ? value.slice(0, 120) : value;
  }
  return clean;
}

export function weekBucket(tick: number): string {
  if (tick <= 25) return "0-25";
  if (tick <= 51) return "26-51";
  if (tick <= 103) return "52-103";
  if (tick <= 207) return "104-207";
  if (tick <= 415) return "208-415";
  return "416+";
}

export function ratingBucket(value: number): string {
  const bounded = Math.max(0, Math.min(100, Math.floor(value)));
  if (bounded === 100) return "100";
  const floor = Math.floor(bounded / 10) * 10;
  return `${floor}-${floor + 9}`;
}

export function activeTimeBucket(milliseconds: number): string {
  const minutes = milliseconds / 60_000;
  if (minutes < 15) return "<15m";
  if (minutes < 60) return "15-59m";
  if (minutes < 120) return "1-2h";
  if (minutes < 240) return "2-4h";
  if (minutes < 480) return "4-8h";
  return "8h+";
}
