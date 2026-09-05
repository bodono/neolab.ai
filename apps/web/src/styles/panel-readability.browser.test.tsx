import { afterEach, describe, expect, it } from "vitest";

import "./game.css";

type Rgba = readonly [number, number, number, number];

function parseColour(value: string): Rgba {
  if (value === "transparent") return [0, 0, 0, 0];
  if (value.startsWith("color(srgb ")) {
    const [red = 0, green = 0, blue = 0, alpha = 1] = value
      .slice(11, -1)
      .replace("/", " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    return [red * 255, green * 255, blue * 255, alpha];
  }
  const [red = 0, green = 0, blue = 0, alpha = 1] = value
    .slice(value.indexOf("(") + 1, -1)
    .replaceAll(",", " ")
    .replace("/", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  return [red, green, blue, alpha];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] +
      background[0] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[1] * foreground[3] +
      background[1] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[2] * foreground[3] +
      background[2] * background[3] * (1 - foreground[3])) /
      alpha,
    alpha,
  ];
}

function luminance([red, green, blue]: Rgba): number {
  const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: Rgba, background: Rgba): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function effectiveBackground(element: Element): Rgba {
  const ancestors: Element[] = [];
  let current: Element | null = element;
  while (current !== null) {
    ancestors.unshift(current);
    current = current.parentElement;
  }
  return ancestors.reduce<Rgba>(
    (background, ancestor) =>
      composite(parseColour(getComputedStyle(ancestor).backgroundColor), background),
    [255, 255, 255, 1],
  );
}

function expectReadable(selector: string, minimum = 4.5): void {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  const style = getComputedStyle(element!);
  const ratio = contrast(parseColour(style.color), effectiveBackground(element!));
  expect(ratio, `${selector} has ${ratio.toFixed(2)}:1 contrast`).toBeGreaterThanOrEqual(
    minimum,
  );
}

function expectFontSizeAtLeast(selector: string, minimumPixels: number): void {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  const pixels = Number.parseFloat(getComputedStyle(element!).fontSize);
  expect(pixels, `${selector} renders at ${String(pixels)}px`).toBeGreaterThanOrEqual(
    minimumPixels,
  );
}

function expectOpaqueSurface(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  const background = parseColour(getComputedStyle(element!).backgroundColor);
  expect(background[3], `${selector} must have an opaque base colour`).toBe(1);
}

function expectControlBoundary(
  selector: string,
  parentSelector: string,
  minimum = 3,
): void {
  const element = document.querySelector<HTMLElement>(selector);
  const parent = document.querySelector<HTMLElement>(parentSelector);
  expect(element, selector).not.toBeNull();
  expect(parent, parentSelector).not.toBeNull();
  expect(Number.parseFloat(getComputedStyle(element!).borderTopWidth)).toBeGreaterThan(0);
  const ratio = contrast(
    parseColour(getComputedStyle(element!).borderTopColor),
    effectiveBackground(parent!),
  );
  expect(
    ratio,
    `${selector} boundary has ${ratio.toFixed(2)}:1 contrast`,
  ).toBeGreaterThanOrEqual(minimum);
}

function setTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset["theme"] = theme;
}

afterEach(() => {
  setTheme("light");
  document.body.replaceChildren();
});

describe.each(["light", "dark"] as const)("high-stakes panels in %s mode", (theme) => {
  it("keeps every endgame popup surface opaque", () => {
    setTheme(theme);
    document.body.innerHTML = `
      <section class="capability-proof-result-dialog outcome-confirmed"></section>
      <section class="endgame-return-dialog false-dawn"></section>
      <section class="endgame-return-dialog moratorium-result-dialog moratorium-failed"></section>
      <section class="event-dialog candidate-declaration-dialog"></section>
      <section class="crisis-decision-dialog"></section>
      <section class="rollout-decision-dialog rollout-decision-dialog-hazard"></section>
      <section class="critical-access-dialog endgame-manual-command"></section>
      <section class="purchase-dialog candidate-retirement-dialog"></section>
      <section class="autonomy-request-dialog safety-critical level-5"></section>
      <section class="rival-candidate-setback-dialog"></section>
      <section class="discovery-dialog competitor-milestone"></section>
      <section class="victory-deployment-experience"></section>
      <section class="world-waiting-experience"></section>
      <section class="containment-failure-experience"></section>`;

    for (const selector of [
      ".capability-proof-result-dialog",
      ".endgame-return-dialog.false-dawn",
      ".moratorium-result-dialog",
      ".candidate-declaration-dialog",
      ".crisis-decision-dialog",
      ".rollout-decision-dialog",
      ".endgame-manual-command",
      ".candidate-retirement-dialog",
      ".autonomy-request-dialog",
      ".rival-candidate-setback-dialog",
      ".discovery-dialog",
      ".victory-deployment-experience",
      ".world-waiting-experience",
      ".containment-failure-experience",
    ]) {
      expectOpaqueSurface(selector);
    }
  });

  it("keeps the route-decision deferral readable on its fixed-dark popup", () => {
    setTheme(theme);
    document.body.innerHTML = `
      <section class="rollout-decision-dialog rollout-decision-dialog-operational">
        <footer>
          <p>This choice remains available from the Deployment Crisis command room.</p>
          <button class="secondary rollout-decision-defer">Decide later</button>
        </footer>
      </section>`;

    expectReadable(".rollout-decision-defer");
    const button = document.querySelector<HTMLElement>(".rollout-decision-defer")!;
    const style = getComputedStyle(button);
    expect(style.backgroundColor).toBe("rgb(232, 243, 239)");
    expect(style.boxShadow).not.toBe("none");
  });

  it("keeps every manual-command control legible", () => {
    setTheme(theme);
    document.body.innerHTML = `
        <div class="critical-access-backdrop endgame-command-backdrop command-deploy">
          <section class="critical-access-dialog endgame-manual-command">
            <p class="eyebrow">FINAL WORLD-SCALE ORDER</p>
            <h2>Deploy now.</h2>
            <p class="command-copy">Every unresolved weakness carries forward.</p>
            <label>Type <strong>DEPLOY CANDIDATE</strong><input value="" /></label>
            <footer>
              <button class="secondary">Keep preparing</button>
              <button class="danger deploy-order" disabled>Transmit DEPLOY order</button>
              <button class="nomination-order">Nominate exact artifact</button>
            </footer>
          </section>
        </div>`;

    const dialog = document.querySelector<HTMLElement>(".endgame-manual-command")!;
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(17, 28, 27)");
    expectReadable(".endgame-manual-command .eyebrow");
    expectReadable(".endgame-manual-command h2", 3);
    expectReadable(".endgame-manual-command .command-copy");
    expectReadable(".endgame-manual-command .secondary");
    expectReadable(".endgame-manual-command .deploy-order");
    expectReadable(".endgame-manual-command .nomination-order");
    expect(
      Number(getComputedStyle(document.querySelector(".deploy-order")!).opacity),
    ).toBe(0.78);
  });

  it("keeps candidate custody retirement on its intended dark surface", () => {
    setTheme(theme);
    document.body.innerHTML = `
        <div class="modal-backdrop candidate-retirement-backdrop">
          <section class="purchase-dialog candidate-retirement-dialog">
            <header class="candidate-retirement-dialog-heading">
              <p class="eyebrow">CANDIDATE CUSTODY // IRREVERSIBLE COMMAND</p>
              <h2>Retire Aquarius-7</h2>
              <button class="secondary">Close</button>
            </header>
            <p class="candidate-retirement-warning">The attempt can become a containment emergency.</p>
            <p class="candidate-retirement-risk-caveat">These are evidence-based risk bands.</p>
          </section>
        </div>`;

    const dialog = document.querySelector<HTMLElement>(".candidate-retirement-dialog")!;
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(23, 32, 30)");
    expectReadable(".candidate-retirement-dialog .eyebrow");
    expectReadable(".candidate-retirement-dialog h2", 3);
    expectReadable(".candidate-retirement-warning");
    expectReadable(".candidate-retirement-risk-caveat");
    expectReadable(".candidate-retirement-dialog .secondary");
  });

  it("keeps the controlled-retirement planner readable and spatially explicit", () => {
    setTheme(theme);
    document.body.innerHTML = `
      <div class="critical-access-backdrop endgame-command-backdrop command-retire">
        <section class="critical-access-dialog endgame-manual-command">
          <p class="eyebrow">RETIREMENT CEREMONY // DESIGN THE SHUTDOWN</p>
          <h2>Reaching into the cage is not safe.</h2>
          <p>Choose how to cut access and what, if anything, survives.</p>
          <fieldset>
            <legend>Shutdown procedure</legend>
            <label>
              <input type="radio" name="procedure" checked />
              <span>
                <strong>Staged isolated shutdown</strong>
                <small>Move through instrumented isolation before cutting power.</small>
              </span>
            </label>
            <label>
              <input type="radio" name="procedure" />
              <span>
                <strong>Immediate hard cut</strong>
                <small>Remove access immediately and accept a harder verification problem.</small>
              </span>
            </label>
          </fieldset>
          <fieldset>
            <legend>Archive disposition</legend>
            <label>
              <input type="radio" name="disposition" checked />
              <span>
                <strong>Preserve a filtered technical note</strong>
                <small>Retain no executable checkpoint.</small>
              </span>
            </label>
            <label>
              <input type="radio" name="disposition" />
              <span>
                <strong>Destroy all weights</strong>
                <small>Attempt verified destruction of every executable copy.</small>
              </span>
            </label>
          </fieldset>
          <dl class="retirement-risk-readout">
            <div><dt>Cooperation risk</dt><dd>Material</dd></div>
            <div><dt>Containment risk</dt><dd>Bounded</dd></div>
            <div><dt>Persistence risk</dt><dd>Material</dd></div>
          </dl>
          <p class="retirement-truth">
            These are evidence-conditioned risk bands, not hidden-truth probabilities.
          </p>
          <footer>
            <button class="secondary">Do not touch the artifact</button>
            <button class="retirement-proceed">Review retirement command</button>
          </footer>
        </section>
      </div>`;

    const dialog = document.querySelector<HTMLElement>(".endgame-manual-command")!;
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(16, 25, 28)");
    expect(dialog.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      Math.min(920, window.innerWidth - 32),
    );

    const fieldset = document.querySelector<HTMLElement>(
      ".endgame-manual-command fieldset",
    )!;
    const fieldsetStyle = getComputedStyle(fieldset);
    expect(fieldsetStyle.display).toBe("grid");
    expect(fieldsetStyle.gridTemplateColumns.split(" ").length).toBeGreaterThanOrEqual(1);

    const riskReadout = document.querySelector<HTMLElement>(".retirement-risk-readout")!;
    expect(getComputedStyle(riskReadout).gridTemplateColumns.split(" ")).toHaveLength(
      window.innerWidth <= 800 ? 1 : 3,
    );

    const radio = document.querySelector<HTMLInputElement>(
      ".endgame-manual-command input[type='radio']",
    )!;
    expect(getComputedStyle(radio).width).toBe("17px");
    expect(getComputedStyle(radio).height).toBe("17px");
    expect(getComputedStyle(radio).accentColor).toBe("rgb(180, 196, 200)");

    for (const selector of [
      ".endgame-manual-command .eyebrow",
      ".endgame-manual-command h2",
      ".endgame-manual-command > p:not(.eyebrow)",
      ".endgame-manual-command legend",
      ".endgame-manual-command fieldset strong",
      ".endgame-manual-command fieldset small",
      ".retirement-risk-readout dt",
      ".retirement-risk-readout dd",
      ".retirement-truth",
      ".endgame-manual-command .secondary",
      ".retirement-proceed",
    ]) {
      expectReadable(selector, selector.includes(" h2") ? 3 : 4.5);
    }
    expectFontSizeAtLeast(".endgame-manual-command legend", 11);
    expectFontSizeAtLeast(".endgame-manual-command fieldset strong", 13);
    expectFontSizeAtLeast(".endgame-manual-command fieldset small", 12);
    expectFontSizeAtLeast(".retirement-risk-readout dt", 11);
    expectFontSizeAtLeast(".retirement-risk-readout dd", 15);
    expectFontSizeAtLeast(".retirement-truth", 12);
    expectFontSizeAtLeast(".retirement-proceed", 13);
  });

  it("keeps the candidate-access channel and exact command ceremony fixed-dark", () => {
    setTheme(theme);
    document.body.innerHTML = `
      <section class="ai-character-panel">
        <header class="panel-heading">
          <div><p class="eyebrow">SECURE CANDIDATE CHANNEL</p><h2>Aquarius-7</h2></div>
          <span>Access 1 of 5</span>
        </header>
        <div class="access-ladder">
          <header><strong>OPERATING PERMISSIONS</strong><span>Access trades against risk</span></header>
          <button class="current" disabled><span>ACCESS 1</span><strong>Fixed evaluation sandbox</strong><small>Current boundary</small></button>
        </div>
      </section>
      <div class="critical-access-backdrop endgame-command-backdrop command-access">
        <section class="critical-access-dialog endgame-manual-command">
          <p class="eyebrow">CRITICAL PERMISSION CHANGE</p>
          <h2>Laboratory operator</h2>
          <p>This materially changes what a deceptive candidate can affect.</p>
          <dl>
            <div><dt>Research acceleration</dt><dd>+200%</dd></div>
            <div><dt>Access-risk index</dt><dd>62/100</dd></div>
          </dl>
          <label>Type <strong>GRANT LABORATORY CONTROL</strong> to confirm<input /></label>
          <footer>
            <button class="secondary">Keep current boundary</button>
            <button class="danger" disabled>Confirm critical access</button>
          </footer>
        </section>
      </div>`;

    const dialog = document.querySelector<HTMLElement>(".command-access section")!;
    expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(17, 28, 27)");
    for (const selector of [
      ".ai-character-panel .eyebrow",
      ".access-ladder > header",
      ".access-ladder button.current",
      ".command-access .eyebrow",
      ".command-access h2",
      ".command-access > section > p:not(.eyebrow)",
      ".command-access dt",
      ".command-access dd",
      ".command-access label",
      ".command-access input",
      ".command-access .secondary",
      ".command-access .danger",
    ]) {
      expectReadable(selector, selector.includes(" h2") ? 3 : 4.5);
    }
    expectFontSizeAtLeast(".command-access dt", 11);
    expectFontSizeAtLeast(".command-access dd", 13);
    expectFontSizeAtLeast(".command-access .danger", 13);
    expect(
      getComputedStyle(document.querySelector(".access-ladder .current")!).opacity,
    ).toBe("1");
    expect(
      getComputedStyle(document.querySelector(".command-access .danger")!).opacity,
    ).toBe("0.78");
  });
});

describe("candidate declaration choices", () => {
  it("anchors every option action to the same bottom edge", () => {
    document.body.innerHTML = `
      <section class="event-dialog candidate-declaration-dialog">
        <div class="event-options" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
          <article class="event-option-card">
            <div><h3>Notify regulators</h3><p>Bring regulators in now.</p></div>
            <section class="guaranteed-effects"><ul><li>Trust rises</li><li>Attention rises</li><li>Culture rises</li><li>Access unchanged</li></ul></section>
            <button>Notify regulators</button>
          </article>
          <article class="event-option-card">
            <div><h3>Continue review</h3><p>Spend two weeks strengthening the proof.</p></div>
            <section class="guaranteed-effects"><ul><li>Evaluation quality rises</li><li>Proof takes longer</li></ul></section>
            <button>Continue review</button>
          </article>
          <article class="event-option-card">
            <div><h3>Press forward</h3><p>Raise access and accelerate the first proof.</p></div>
            <section class="guaranteed-effects"><ul><li>Patience rises</li><li>Culture falls</li><li>Candour falls</li><li>Access rises</li><li>Proof accelerates</li></ul></section>
            <button>Press forward</button>
          </article>
        </div>
      </section>`;

    const buttonTops = [
      ...document.querySelectorAll<HTMLButtonElement>(".event-option-card > button"),
    ].map((button) => Math.round(button.getBoundingClientRect().top));
    expect(buttonTops).toHaveLength(3);
    expect(new Set(buttonTops).size).toBe(1);
  });
});

describe("dark-theme risk and status panels", () => {
  it("preserves warning copy and destructive action semantics", () => {
    setTheme("dark");
    document.body.innerHTML = `
      <section class="purchase-dialog phase-transition-dialog">
        <p class="phase-transition-next">The next phase changes the operating rules.</p>
        <p class="validation-error">The command is incomplete.</p>
      </section>
      <section class="event-dialog"><span class="event-deadline">2 WEEKS</span></section>
      <section class="event-dialog candidate-declaration-dialog">
        <article class="event-option-card">
          <div><p>Continue internal review with the evidence currently available.</p></div>
        </article>
        <article class="event-option-card retirement-review">
          <div><p>Attempting retirement can meet resistance or become an emergency.</p></div>
          <div class="guaranteed-effects"><p>Choose a shutdown procedure before transmitting.</p></div>
          <button class="secondary retirement-review-action">Attempt controlled retirement</button>
        </article>
      </section>
      <section class="purchase-dialog evaluation-pacing-dialog">
        <p class="evaluation-pacing-impossible">No feasible schedule remains.</p>
        <small class="evaluation-pacing-note">The estimate updates after each run.</small>
        <button class="evaluation-pacing-option infeasible" disabled>
          <small>Insufficient capacity</small>
        </button>
      </section>
      <section class="campus-facility-dialog">
        <div class="campus-facility-benefits"><ul><li class="tradeoff">Raises incident risk</li></ul></div>
      </section>
      <section class="autonomy-request-dialog">
        <div class="autonomy-request-grant">
          <small>Permissions take effect immediately</small>
          <button class="primary autonomy-grant-action autonomy-grant-high">Grant laboratory control</button>
          <button class="primary autonomy-grant-action autonomy-grant-critical autonomy-grant-root">Grant root access</button>
        </div>
      </section>
      <section class="purchase-dialog rival-crisis-stage-dialog"><p class="eyebrow">RIVAL CRISIS</p></section>
      <dl class="training-reliability-outcomes"><div class="danger"><dd>18% lost run</dd></div></dl>
      <button class="primary danger">Delete permanent weights</button>`;

    for (const selector of [
      ".phase-transition-next",
      ".validation-error",
      ".event-deadline",
      ".candidate-declaration-dialog .event-option-card:not(.retirement-review) p",
      ".candidate-declaration-dialog .retirement-review > div p",
      ".candidate-declaration-dialog .retirement-review .guaranteed-effects p",
      ".candidate-declaration-dialog .retirement-review-action",
      ".evaluation-pacing-impossible",
      ".evaluation-pacing-note",
      ".evaluation-pacing-option.infeasible small",
      ".campus-facility-benefits .tradeoff",
      ".autonomy-request-grant > small",
      ".autonomy-grant-high",
      ".autonomy-grant-root",
      ".rival-crisis-stage-dialog .eyebrow",
      ".training-reliability-outcomes .danger dd",
      ".primary.danger",
    ]) {
      expectReadable(selector);
    }
    expect(
      Number(
        getComputedStyle(document.querySelector(".evaluation-pacing-option.infeasible")!)
          .opacity,
      ),
    ).toBe(1);
    expect(
      getComputedStyle(document.querySelector(".primary.danger")!).backgroundColor,
    ).toBe("rgb(154, 44, 32)");
    expect(
      getComputedStyle(document.querySelector(".autonomy-grant-high")!).backgroundColor,
    ).toBe("rgb(167, 44, 33)");
    expect(
      getComputedStyle(document.querySelector(".autonomy-grant-root")!).backgroundColor,
    ).toBe("rgb(123, 26, 19)");
  });
});

describe("model workspace controls in dark mode", () => {
  it("keeps both model action cards prominent and readable", () => {
    setTheme("dark");
    document.body.innerHTML = `
      <section class="console-panel model-workflow-navigation model-workspace-command">
        <div class="model-command-actions">
          <article class="model-command-card training">
            <header><span>TRAINING</span><b>READY</b></header>
            <h3>Train next model</h3><p>Train a successor while keeping the current model.</p>
            <button class="primary">Configure training</button>
          </article>
          <article class="model-command-card release">
            <header><span>DEPLOYMENT</span><b>ACTION REQUIRED</b></header>
            <h3>Prepare &amp; launch current model</h3><p>The model remains internal.</p>
            <button class="primary">Configure launch</button>
          </article>
        </div>
      </section>`;

    for (const selector of [
      ".model-command-card.training > header > span",
      ".model-command-card.training > header > b",
      ".model-command-card.training > h3",
      ".model-command-card.training > p",
      ".model-command-card.release > header > span",
      ".model-command-card.release > header > b",
      ".model-command-card.release > h3",
      ".model-command-card.release > p",
    ]) {
      expectReadable(selector);
    }

    const navigation = document.querySelector<HTMLElement>(".model-workflow-navigation")!;
    const training = document.querySelector<HTMLElement>(".model-command-card.training")!;
    const release = document.querySelector<HTMLElement>(".model-command-card.release")!;
    const trainingStyle = getComputedStyle(training);
    const borderRatio = contrast(
      parseColour(trainingStyle.borderTopColor),
      effectiveBackground(navigation),
    );

    expect(borderRatio).toBeGreaterThanOrEqual(3);
    expect(trainingStyle.boxShadow).not.toBe("none");
    expect(getComputedStyle(release).boxShadow).not.toBe("none");
    expect(trainingStyle.borderTopColor).not.toBe(
      getComputedStyle(release).borderTopColor,
    );
  });
});

describe("dark-mode button affordance", () => {
  it("gives neutral actions a distinct face, edge, and raised state", () => {
    setTheme("dark");
    document.body.innerHTML = `
      <section class="console-panel button-audit-panel">
        <button class="secondary">Review dossier &amp; terms</button>
        <button>Start campaign</button>
        <button class="text-button">Open paper →</button>
      </section>`;

    expectControlBoundary(".secondary", ".button-audit-panel");
    expectControlBoundary("button:not([class])", ".button-audit-panel");
    expect(getComputedStyle(document.querySelector(".secondary")!).boxShadow).not.toBe(
      "none",
    );
    expect(
      getComputedStyle(document.querySelector(".text-button")!).backgroundColor,
    ).toBe("rgba(0, 0, 0, 0)");
  });

  it("makes clickable cards and inactive navigation visibly interactive", () => {
    setTheme("dark");
    document.body.innerHTML = `
      <nav class="game-sidebar button-audit-sidebar">
        <button><span>PP</span><strong>People</strong></button>
      </nav>
      <section class="console-panel button-audit-panel">
        <button class="researcher-slot-card vacant">Recruit researcher</button>
        <article class="research-programme-card">
          <button class="research-programme-select">Architectures</button>
        </article>
        <button class="programme-lead-slot empty">Appoint lead</button>
      </section>`;

    expectControlBoundary(".game-sidebar button", ".button-audit-sidebar");
    expectControlBoundary(".researcher-slot-card", ".button-audit-panel");
    expectControlBoundary(".research-programme-card", ".button-audit-panel");
    expectControlBoundary(".programme-lead-slot", ".button-audit-panel");
    for (const selector of [
      ".researcher-slot-card",
      ".research-programme-card",
      ".programme-lead-slot",
    ]) {
      expect(getComputedStyle(document.querySelector(selector)!).boxShadow).not.toBe(
        "none",
      );
    }
  });
});

describe.each(["light", "dark"] as const)(
  "fixed-dark finale controls in %s mode",
  (theme) => {
    it("keeps finale microcopy and unavailable containment explanations readable", () => {
      setTheme(theme);
      document.body.innerHTML = `
      <section class="victory-deployment-experience">
        <div class="victory-deployment-audio"><button class="audio-toggle">UNMUTE</button></div>
        <div class="victory-deployment-frame">
          <p class="victory-deployment-kicker">FINAL DEPLOYMENT // ROUTE COMPLETE</p>
          <p class="victory-deployment-lede">Every scheduled gate has reported.</p>
          <div class="victory-deployment-summary">
            <article><span>Candidate</span><strong>Aquarius-7</strong><small>Access 1 of 5</small></article>
          </div>
          <p class="victory-deployment-warning">Transmission is terminal.</p>
        </div>
      </section>
      <section class="world-waiting-experience">
        <header><p>FINAL ORDER TRANSMITTED</p><span>2/5 CHANNELS</span></header>
        <main>
          <p class="world-waiting-kicker">THE COMMAND HAS LEFT THE LAB</p>
          <p class="world-waiting-silence">Status lines remain quiet until the simulation answers.</p>
          <div class="launch-control-callouts">
            <article class="tone-stable"><span>01 · CONTROL</span><strong>Human authority remains effective.</strong></article>
          </div>
          <div class="world-waiting-pulse">AWAITING INDEPENDENT CONFIRMATION</div>
        </main>
      </section>
      <section class="containment-failure-experience">
        <div class="containment-response-grid">
          <article class="unavailable">
            <h2>Cut external links</h2>
            <p>The route was not prepared.</p>
            <small>Requires hardened network controls.</small>
            <button disabled>Issue emergency order</button>
          </article>
        </div>
      </section>
      <section class="ending-screen ending-loss">
        <section class="ending-hero">
          <p class="ending-finality">This outcome is final. The record remains available.</p>
        </section>
        <div class="ending-aftermath">
          <p class="ending-epilogue">The lab's choices continue to shape the institutions left behind.</p>
          <ol class="ending-aftermath-timeline">
            <li><p>WEEK 140</p><h3>Independent review</h3><p>The public record separates what was known from what was hidden.</p></li>
          </ol>
        </div>
        <p class="ending-independence-notice">Scores and records remain local to this browser.</p>
      </section>`;

      for (const selector of [
        ".victory-deployment-audio .audio-toggle",
        ".victory-deployment-kicker",
        ".victory-deployment-lede",
        ".victory-deployment-summary span",
        ".victory-deployment-summary small",
        ".victory-deployment-warning",
        ".world-waiting-experience > header p",
        ".world-waiting-experience > header span",
        ".world-waiting-kicker",
        ".world-waiting-silence",
        ".launch-control-callouts span",
        ".launch-control-callouts strong",
        ".world-waiting-pulse",
        ".containment-response-grid article.unavailable h2",
        ".containment-response-grid article.unavailable p",
        ".containment-response-grid article.unavailable small",
        ".containment-response-grid article.unavailable button",
        ".ending-finality",
        ".ending-epilogue",
        ".ending-aftermath-timeline li > p:last-child",
        ".ending-independence-notice",
      ]) {
        expectReadable(selector);
      }
      expectFontSizeAtLeast(".victory-deployment-summary span", 11);
      expectFontSizeAtLeast(".world-waiting-experience > header", 11);
      expectFontSizeAtLeast(".world-waiting-kicker", 11);
      expectFontSizeAtLeast(".launch-control-callouts span", 11);
      expectFontSizeAtLeast(".world-waiting-pulse", 11);
      expectFontSizeAtLeast(".world-waiting-silence", 14);
      expectFontSizeAtLeast(".ending-finality", 13);
      expectFontSizeAtLeast(".ending-epilogue", 14);
      expectFontSizeAtLeast(".ending-aftermath-timeline li > p:last-child", 12);
      expectFontSizeAtLeast(".ending-independence-notice", 12);
      expect(
        Number(
          getComputedStyle(
            document.querySelector(".containment-response-grid article.unavailable")!,
          ).opacity,
        ),
      ).toBe(1);
    });
  },
);
