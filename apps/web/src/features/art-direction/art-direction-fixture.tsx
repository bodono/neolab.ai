import { useState, type CSSProperties, type ReactElement } from "react";

import corporateSheet from "../../../../../design/art-direction/treatment-a-corporate.png";
import arcadeSheet from "../../../../../design/art-direction/treatment-b-arcade.png";

interface Treatment {
  readonly id: "corporate" | "arcade";
  readonly label: string;
  readonly description: string;
  readonly sheet: string;
  readonly width: number;
  readonly height: number;
  readonly crops: Readonly<Record<ArtAsset, CropRectangle>>;
}

type ArtAsset =
  | "leader"
  | "researcher-ian"
  | "researcher-geoff"
  | "researcher-andrei"
  | "server-room"
  | "cash"
  | "gpu"
  | "aura"
  | "safety"
  | "incident"
  | "comedy";

interface CropRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const TREATMENTS: readonly Treatment[] = [
  {
    id: "corporate",
    label: "A · Restrained corporate",
    description:
      "Muted 16-bit operations-console palette, fine dithering, restrained incident contrast.",
    sheet: corporateSheet,
    width: 1693,
    height: 929,
    crops: {
      leader: { x: 25, y: 115, width: 255, height: 310 },
      "researcher-ian": { x: 302, y: 115, width: 253, height: 310 },
      "researcher-geoff": { x: 575, y: 115, width: 259, height: 310 },
      "researcher-andrei": { x: 853, y: 115, width: 247, height: 310 },
      "server-room": { x: 1117, y: 115, width: 301, height: 310 },
      cash: { x: 1434, y: 115, width: 232, height: 310 },
      gpu: { x: 25, y: 516, width: 255, height: 290 },
      aura: { x: 300, y: 516, width: 253, height: 290 },
      safety: { x: 573, y: 516, width: 248, height: 290 },
      incident: { x: 842, y: 516, width: 352, height: 290 },
      comedy: { x: 1215, y: 516, width: 456, height: 290 },
    },
  },
  {
    id: "arcade",
    label: "B · Colourful arcade",
    description:
      "Saturated 16-bit cabinet palette, neon highlights, stronger event-card contrast.",
    sheet: arcadeSheet,
    width: 1774,
    height: 887,
    crops: {
      leader: { x: 22, y: 112, width: 265, height: 312 },
      "researcher-ian": { x: 309, y: 112, width: 268, height: 312 },
      "researcher-geoff": { x: 600, y: 112, width: 260, height: 312 },
      "researcher-andrei": { x: 882, y: 112, width: 249, height: 312 },
      "server-room": { x: 1152, y: 112, width: 311, height: 312 },
      cash: { x: 1489, y: 112, width: 258, height: 312 },
      gpu: { x: 31, y: 468, width: 313, height: 306 },
      aura: { x: 371, y: 468, width: 301, height: 306 },
      safety: { x: 699, y: 468, width: 279, height: 306 },
      incident: { x: 1002, y: 468, width: 324, height: 306 },
      comedy: { x: 1351, y: 468, width: 393, height: 306 },
    },
  },
];

type SheetStyle = CSSProperties &
  Readonly<Record<"--art-sheet" | "--art-size" | "--art-position", string>>;

function Crop({
  treatment,
  asset,
  className = "",
}: {
  readonly treatment: Treatment;
  readonly asset: ArtAsset;
  readonly className?: string;
}): ReactElement {
  const crop = treatment.crops[asset];
  const xPosition = (crop.x / (treatment.width - crop.width)) * 100;
  const yPosition = (crop.y / (treatment.height - crop.height)) * 100;
  return (
    <span
      className={`art-crop ${className}`.trim()}
      aria-hidden="true"
      style={
        {
          "--art-sheet": `url(${treatment.sheet})`,
          "--art-size": `${String((treatment.width / crop.width) * 100)}% ${String((treatment.height / crop.height) * 100)}%`,
          "--art-position": `${String(xPosition)}% ${String(yPosition)}%`,
        } as SheetStyle
      }
    />
  );
}

export function ArtDirectionFixture(): ReactElement {
  const [treatmentId, setTreatmentId] = useState<Treatment["id"]>("corporate");
  const treatment =
    TREATMENTS.find((candidate) => candidate.id === treatmentId) ?? TREATMENTS[0]!;

  return (
    <main className={`game-shell art-direction-fixture treatment-${treatment.id}`}>
      <nav className="art-direction-switcher" aria-label="Art direction treatment">
        <div>
          <p className="eyebrow">GDD §26.5 // IN-DASHBOARD ART TEST</p>
          <h1>{treatment.label}</h1>
          <p>{treatment.description}</p>
        </div>
        <div>
          {TREATMENTS.map((candidate) => (
            <button
              type="button"
              className={candidate.id === treatment.id ? "primary" : "secondary"}
              aria-pressed={candidate.id === treatment.id}
              key={candidate.id}
              onClick={() => setTreatmentId(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </nav>

      <header className="identity-header art-identity-header">
        <Crop treatment={treatment} asset="leader" className="art-leader" />
        <div className="identity-lockup">
          <p className="eyebrow">DEEPBRAIN // GEMINI</p>
          <h2>Dennis Hassabi</h2>
          <p>DeepBrain · Aquarius programme · Foundation phase</p>
        </div>
        <div className="date-block">
          <span>2019</span>
          <strong>WEEK 14</strong>
        </div>
      </header>

      <section className="status-grid art-status-grid" aria-label="Resource icon test">
        <article className="status-card finance-card healthy">
          <Crop treatment={treatment} asset="cash" className="art-resource" />
          <p className="eyebrow">CURRENT BALANCE</p>
          <strong>$31.4m</strong>
          <p>Income +$10.9m · Net +$2.5m</p>
        </article>
        <article className="status-card compute-card">
          <Crop treatment={treatment} asset="gpu" className="art-resource" />
          <p className="eyebrow">GPU FLEET</p>
          <strong>24,400</strong>
          <p>Hopper generation online</p>
        </article>
        <article className="status-card aura-card">
          <Crop treatment={treatment} asset="aura" className="art-resource" />
          <p className="eyebrow">SPENDABLE AURA</p>
          <strong>50</strong>
          <p>Lifetime 112 · Signal rising</p>
        </article>
        <article className="status-card ai-card">
          <Crop treatment={treatment} asset="safety" className="art-resource" />
          <p className="eyebrow">SAFETY EVIDENCE</p>
          <strong>Partial</strong>
          <p>Control coverage has gaps</p>
        </article>
      </section>

      <section className="researcher-strip" aria-labelledby="art-roster-title">
        <header className="panel-heading">
          <div>
            <p className="eyebrow">PORTRAIT TEST</p>
            <h2 id="art-roster-title">Star researchers</h2>
          </div>
          <span>3 occupied · 5 slots open</span>
        </header>
        <div className="art-researcher-grid">
          {(["researcher-ian", "researcher-geoff", "researcher-andrei"] as const).map(
            (asset, index) => (
              <article key={asset}>
                <Crop treatment={treatment} asset={asset} className="art-researcher" />
                <strong>
                  {["Yann LeNet", "Geoff Hintoff", "Andrei Carpathia"][index]}
                </strong>
                <span>{["Vision", "Deep learning", "Engineering"][index]}</span>
              </article>
            ),
          )}
        </div>
      </section>

      <div className="dashboard-grid art-direction-dashboard">
        <section className="console-panel art-server-panel">
          <header className="panel-heading">
            <div>
              <p className="eyebrow">ENVIRONMENT TEST</p>
              <h2>Frontier compute floor</h2>
            </div>
            <span className="uncertainty-tag">HIGH LOAD</span>
          </header>
          <Crop treatment={treatment} asset="server-room" className="art-server-room" />
        </section>
        <aside className="world-rail art-event-rail">
          <section className="rail-panel">
            <header className="panel-heading compact">
              <div>
                <p className="eyebrow">EVENT CARD TEST</p>
                <h2>Decision queue</h2>
              </div>
            </header>
            <article className="art-event-card serious">
              <Crop treatment={treatment} asset="incident" />
              <strong>Containment alarm</strong>
              <span>Critical · auto-paused</span>
            </article>
            <article className="art-event-card comedy">
              <Crop treatment={treatment} asset="comedy" />
              <strong>The demo has investors</strong>
              <span>Ordinary · 3 weeks left</span>
            </article>
          </section>
        </aside>
      </div>

      <details className="console-panel art-source-sheet">
        <summary>View the complete uncropped treatment sheet</summary>
        <img src={treatment.sheet} alt={`${treatment.label} complete art test sheet`} />
      </details>
    </main>
  );
}
