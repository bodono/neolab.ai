import { afterEach, describe, expect, it } from "vitest";

import "./game.css";

afterEach(() => {
  document.body.replaceChildren();
});

describe("endgame action effects", () => {
  it("gives every endgame action surface the shared raised interaction language", () => {
    document.body.innerHTML = `
      <section class="candidate-custody-panel"><button>Custody action</button></section>
      <section class="warning-banner endgame-warning-banner"><button>Warning action</button></section>
      <section class="crisis-board crisis-board-redesign"><button>Board action</button></section>
      <section class="candidate-declaration-dialog"><button>Declaration action</button></section>
      <section class="critical-access-dialog"><button>Typed command action</button></section>
      <section class="candidate-retirement-dialog"><button>Retirement action</button></section>
      <section class="rollout-decision-dialog"><div class="rollout-decision-options"><button>Route twist action</button></div></section>
      <section class="victory-deployment-frame"><button>Deployment action</button></section>
      <section class="containment-failure-frame"><button>Containment action</button></section>
      <section class="access-ladder"><button>Access action</button></section>
      <section class="ending-return"><button>Return action</button></section>
    `;

    const actions = document.querySelectorAll<HTMLButtonElement>("button");
    expect(actions).toHaveLength(11);
    for (const action of actions) {
      const style = getComputedStyle(action);
      expect(style.borderStyle, action.textContent ?? "button").toBe("solid");
      expect(style.borderWidth, action.textContent ?? "button").toBe("1px");
      expect(style.boxShadow, action.textContent ?? "button").not.toBe("none");
      expect(style.transitionProperty, action.textContent ?? "button").toContain(
        "transform",
      );
      expect(style.transitionProperty, action.textContent ?? "button").toContain(
        "box-shadow",
      );
    }
  });

  it("keeps disabled controls flat and gives dangerous commands their own depth tone", () => {
    document.body.innerHTML = `
      <section class="crisis-board crisis-board-redesign">
        <button disabled>Unavailable action</button>
        <button class="danger">Dangerous action</button>
      </section>
      <nav class="ending-navigation">
        <button class="active">Navigation tab</button>
      </nav>
    `;

    const unavailable = document.querySelector<HTMLButtonElement>("button:disabled")!;
    const danger = document.querySelector<HTMLButtonElement>("button.danger")!;
    const navigation = document.querySelector<HTMLButtonElement>(
      ".ending-navigation button",
    )!;
    expect(getComputedStyle(unavailable).boxShadow).toBe("none");
    expect(getComputedStyle(unavailable).transform).toBe("none");
    expect(
      getComputedStyle(danger).getPropertyValue("--endgame-button-depth").trim(),
    ).toBe("#5d201a");
    expect(getComputedStyle(navigation).boxShadow).toContain("inset");
  });
});
