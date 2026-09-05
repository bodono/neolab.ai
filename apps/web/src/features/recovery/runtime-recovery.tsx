import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { APPLICATION_VERSION } from "../../app/application-version.tsx";
import { FEEDBACK_URL } from "../../runtime/local-diagnostics.ts";
import type {
  BrowserGameRuntime,
  RuntimeFault,
  RuntimeFaultScope,
} from "../../runtime/index.ts";

interface RuntimeRecoveryPanelProps {
  readonly runtime: BrowserGameRuntime;
  readonly fault?: RuntimeFault;
  readonly mode?: "page" | "inline";
  readonly onReload?: () => void;
}

const SCOPE_LABELS: Readonly<Record<RuntimeFaultScope, string>> = Object.freeze({
  "command-validation": "command preview",
  "command-transition": "simulation command",
  "tick-transition": "weekly simulation",
  "view-projection": "player telemetry",
  "application-shell": "operations console",
  "campus-renderer": "campus display",
});

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

function crashFeedbackUrl(fault: RuntimeFault | undefined): string {
  const url = new URL(FEEDBACK_URL);
  url.searchParams.set("title", `[Crash] ${fault?.code ?? "runtime fault"}`);
  url.searchParams.set(
    "body",
    [
      "## What happened",
      "",
      "Please describe what you were doing immediately before the crash.",
      "",
      "## Recovery reference",
      "",
      `- Reference: ${fault?.faultId ?? "still being recorded"}`,
      `- Last coherent week: ${fault?.tick ?? "unknown"}`,
      `- Affected surface: ${
        fault === undefined ? "operations console" : SCOPE_LABELS[fault.scope]
      }`,
      `- Neolab.ai version: ${APPLICATION_VERSION}`,
      "",
      "## Diagnostic report",
      "",
      "Please attach the downloaded `neolab-crash-...json` diagnostic file. It contains the exception and stack trace, but not the hidden simulation state.",
    ].join("\n"),
  );
  return url.toString();
}

export function RuntimeRecoveryPanel({
  runtime,
  fault,
  mode = "page",
  onReload = () => window.location.reload(),
}: RuntimeRecoveryPanelProps): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [diagnosticStatus, setDiagnosticStatus] = useState<"idle" | "saved" | "failed">(
    "idle",
  );

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function exportEmergencySave(): void {
    try {
      const emergency = runtime.createEmergencySave();
      downloadBlob(emergency.blob, emergency.filename);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    }
  }

  function exportDiagnosticReport(): void {
    try {
      const diagnostic = runtime.createFaultDiagnosticReport({
        applicationVersion: APPLICATION_VERSION,
        pageUrl: window.location.href,
        userAgent: window.navigator.userAgent,
      });
      downloadBlob(diagnostic.blob, diagnostic.filename);
      setDiagnosticStatus("saved");
    } catch {
      setDiagnosticStatus("failed");
    }
  }

  const body = (
    <div className="runtime-recovery-card" role="alert" aria-live="assertive">
      <p className="eyebrow">RUNTIME CONTAINMENT // CLOCK PAUSED</p>
      <h1 ref={heading} tabIndex={-1}>
        The operations console encountered an internal fault.
      </h1>
      <p className="runtime-recovery-summary">
        No further simulation steps will run. Save the last coherent lab state, then
        download the crash diagnostic so the fault can be investigated.
      </p>
      <dl className="runtime-recovery-reference">
        <div>
          <dt>Recovery reference</dt>
          <dd>{fault?.faultId ?? "being recorded"}</dd>
        </div>
        <div>
          <dt>Last coherent week</dt>
          <dd>{fault === undefined ? "current" : String(fault.tick)}</dd>
        </div>
        <div>
          <dt>Affected surface</dt>
          <dd>
            {fault === undefined ? "operations console" : SCOPE_LABELS[fault.scope]}
          </dd>
        </div>
      </dl>
      <div className="runtime-recovery-actions">
        <button type="button" className="primary" onClick={exportEmergencySave}>
          Export emergency save
        </button>
        <button type="button" onClick={exportDiagnosticReport}>
          Download crash diagnostic
        </button>
        <a
          className="runtime-recovery-feedback"
          href={crashFeedbackUrl(fault)}
          target="_blank"
          rel="noreferrer"
        >
          Report crash on GitHub ↗
        </a>
        <button type="button" className="runtime-recovery-reload" onClick={onReload}>
          Reload Neolab.ai
        </button>
      </div>
      {saveStatus === "saved" ? (
        <p className="runtime-recovery-status" role="status">
          Emergency save exported. It can be imported from the title screen.
        </p>
      ) : null}
      {saveStatus === "failed" ? (
        <p className="runtime-recovery-status validation-error" role="status">
          The browser could not export the save. Reload only if no other recovery copy is
          available.
        </p>
      ) : null}
      {diagnosticStatus === "saved" ? (
        <p className="runtime-recovery-status" role="status">
          Crash diagnostic downloaded. Attach it to the prefilled GitHub report.
        </p>
      ) : null}
      {diagnosticStatus === "failed" ? (
        <p className="runtime-recovery-status validation-error" role="status">
          The browser could not download the crash diagnostic.
        </p>
      ) : null}
      <p className="runtime-recovery-footnote">
        The save contains game state. The diagnostic contains the error and stack trace,
        but no hidden simulation state. Review it before posting.
      </p>
    </div>
  );

  return mode === "inline" ? (
    <section className="runtime-recovery runtime-recovery-inline">{body}</section>
  ) : (
    <main className="runtime-recovery runtime-recovery-page">{body}</main>
  );
}

interface BoundaryProps {
  readonly runtime: BrowserGameRuntime;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
  readonly fault?: RuntimeFault;
}

export class ApplicationErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const fault = this.props.runtime.reportPresentationFault("application-shell", error);
    this.setState({ failed: true, fault });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <RuntimeRecoveryPanel
          runtime={this.props.runtime}
          {...(this.state.fault === undefined ? {} : { fault: this.state.fault })}
        />
      );
    }
    return this.props.children;
  }
}

export class CampusErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const fault = this.props.runtime.reportPresentationFault("campus-renderer", error);
    this.setState({ failed: true, fault });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <RuntimeRecoveryPanel
          runtime={this.props.runtime}
          {...(this.state.fault === undefined ? {} : { fault: this.state.fault })}
          mode="inline"
        />
      );
    }
    return this.props.children;
  }
}
