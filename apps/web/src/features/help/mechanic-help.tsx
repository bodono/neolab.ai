import type { ReactElement, ReactNode } from "react";

export function MechanicHelp({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <details className="mechanic-help">
      <summary aria-label={`Explain ${label}`} title={`Explain ${label}`}>
        ?
      </summary>
      <div role="note">
        <strong>{label}</strong>
        <p>{children}</p>
      </div>
    </details>
  );
}
