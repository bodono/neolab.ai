import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

function BootPlaceholder(): ReactElement {
  return (
    <main>
      <h1>Neolab.ai</h1>
      <p>Workspace skeleton. The game arrives in later milestones.</p>
    </main>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root container");
}
createRoot(container).render(
  <StrictMode>
    <BootPlaceholder />
  </StrictMode>,
);
