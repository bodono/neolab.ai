// Compile-time contract: hidden model truth must never become importable from
// the browser-facing package surface.
// @ts-expect-error HiddenModelSafetyState is intentionally not exported.
import type { HiddenModelSafetyState } from "../src/public.ts";

// @ts-expect-error AnomalyState contains trueSeverity and is intentionally private.
import type { AnomalyState } from "../src/public.ts";

export type HiddenSafetyMustStayPrivate = HiddenModelSafetyState;
export type AnomalyTruthMustStayPrivate = AnomalyState;
