import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { NeolabApp } from "./app/neolab-app.tsx";
import { CampusProfileFixture } from "./features/campus/campus-profile-fixture.tsx";
import "./styles/game.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root container");
}
const developmentFixture = new URLSearchParams(window.location.search).get("fixture");
const ArtDirectionFixture = import.meta.env.DEV
  ? lazy(async () => {
      const fixture = await import("./features/art-direction/art-direction-fixture.tsx");
      return { default: fixture.ArtDirectionFixture };
    })
  : undefined;
createRoot(container).render(
  <StrictMode>
    {import.meta.env.DEV &&
    developmentFixture === "art-direction" &&
    ArtDirectionFixture !== undefined ? (
      <Suspense fallback={<main className="boot-screen">Loading art test…</main>}>
        <ArtDirectionFixture />
      </Suspense>
    ) : import.meta.env.DEV &&
      (developmentFixture === "campus" ||
        new URLSearchParams(window.location.search).has("campus-profile")) ? (
      <CampusProfileFixture />
    ) : (
      <NeolabApp />
    )}
  </StrictMode>,
);
