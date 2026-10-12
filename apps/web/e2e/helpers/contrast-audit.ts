import type { Page } from "@playwright/test";

/**
 * Text contrast audit for whatever the page currently shows. Every visible text
 * run is measured against the background it actually sits on: the composited
 * background colours of its ancestors, with each gradient stop treated as a
 * possible backdrop (the worst one counts) and ancestor opacity folded into the
 * text colour. The rule that set the failing colour is reported so a regression
 * points straight at the stylesheet.
 */
export interface ContrastFailure {
  readonly theme: "light" | "dark";
  readonly ratio: number;
  readonly required: number;
  readonly foreground: string;
  readonly background: string;
  readonly fontSize: number;
  readonly text: string;
  readonly path: string;
  readonly colourRule?: { readonly selector: string; readonly value: string };
  readonly opacityRule?: { readonly selector: string; readonly value: string };
}

interface AuditOptions {
  readonly minimum: number;
  readonly minimumLarge: number;
  readonly minimumDisabled: number;
}

const DEFAULT_OPTIONS: AuditOptions = {
  minimum: 4.5,
  minimumLarge: 3,
  minimumDisabled: 3,
};

function auditInPage(options: AuditOptions): Omit<ContrastFailure, "theme">[] {
  type Rgba = [number, number, number, number];
  const colourPattern = /rgba?\([^)]*\)|color\(srgb[^)]*\)|transparent/g;

  function parse(value: string): Rgba {
    if (value === "" || value === "transparent") return [0, 0, 0, 0];
    if (value.startsWith("color(srgb ")) {
      const parts = value
        .slice(11, -1)
        .replace("/", " ")
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      return [
        (parts[0] ?? 0) * 255,
        (parts[1] ?? 0) * 255,
        (parts[2] ?? 0) * 255,
        parts[3] ?? 1,
      ];
    }
    const parts = value
      .slice(value.indexOf("(") + 1, -1)
      .replaceAll(",", " ")
      .replace("/", " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) =>
        part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part),
      );
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
  }

  function over(top: Rgba, bottom: Rgba): Rgba {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) return [0, 0, 0, 0];
    const channel = (index: 0 | 1 | 2): number =>
      (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha;
    return [channel(0), channel(1), channel(2), alpha];
  }

  function luminance(colour: Rgba): number {
    const [red, green, blue] = [colour[0], colour[1], colour[2]].map((value) => {
      const unit = value / 255;
      return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  function contrast(first: Rgba, second: Rgba): number {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function hex(colour: Rgba): string {
    const body = [colour[0], colour[1], colour[2]]
      .map((value) => Math.round(value).toString(16).padStart(2, "0"))
      .join("");
    return colour[3] < 1 ? `#${body}/${colour[3].toFixed(2)}` : `#${body}`;
  }

  function describe(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    for (
      let depth = 0;
      current !== null && current !== document.body && depth < 5;
      depth++
    ) {
      const classes = [...current.classList].slice(0, 3);
      parts.unshift(
        current.tagName.toLowerCase() +
          (classes.length > 0 ? `.${classes.join(".")}` : ""),
      );
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  // --- Which stylesheet rule won a property, so failures name their source. ---
  interface IndexedRule {
    readonly rule: CSSStyleRule;
    readonly order: number;
  }
  const rules: IndexedRule[] = [];
  const walk = (list: CSSRuleList): void => {
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) {
        rules.push({ rule, order: rules.length });
      } else if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) walk(rule.cssRules);
      } else if ("cssRules" in rule) {
        walk((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin sheets cannot be read; the app ships none that set text colour.
    }
  }

  function splitSelectors(selectorText: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < selectorText.length; index++) {
      const char = selectorText[index];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        out.push(selectorText.slice(start, index).trim());
        start = index + 1;
      }
    }
    out.push(selectorText.slice(start).trim());
    return out;
  }

  function specificity(selector: string): number {
    const plain = selector
      .replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "")
      .replace(/:(is|not|has)\(/g, " (");
    const ids = (plain.match(/#[\w-]+/g) ?? []).length;
    const classes = (plain.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g) ?? []).length;
    const types =
      (plain.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) ?? [])
        .length + (plain.match(/::[\w-]+/g) ?? []).length;
    return ids * 1e6 + classes * 1e3 + types;
  }

  function winningRule(
    element: Element,
    property: string,
  ): { selector: string; value: string } | undefined {
    let best:
      | {
          selector: string;
          value: string;
          important: boolean;
          specificity: number;
          order: number;
        }
      | undefined;
    for (const { rule, order } of rules) {
      const value = rule.style.getPropertyValue(property);
      if (value === "") continue;
      let matched: string | undefined;
      let matchedSpecificity = -1;
      for (const selector of splitSelectors(rule.selectorText)) {
        try {
          if (element.matches(selector)) {
            const score = specificity(selector);
            if (score > matchedSpecificity) {
              matched = selector;
              matchedSpecificity = score;
            }
          }
        } catch {
          // Pseudo-element selectors never match an element.
        }
      }
      if (matched === undefined) continue;
      const important = rule.style.getPropertyPriority(property) === "important";
      const wins =
        best === undefined ||
        (important && !best.important) ||
        (important === best.important &&
          (matchedSpecificity > best.specificity ||
            (matchedSpecificity === best.specificity && order > best.order)));
      if (wins) {
        best = {
          selector: matched,
          value,
          important,
          specificity: matchedSpecificity,
          order,
        };
      }
    }
    return best === undefined
      ? undefined
      : { selector: best.selector, value: best.value };
  }

  function colourSource(
    element: Element,
    property: string,
  ): { selector: string; value: string } | undefined {
    for (
      let current: Element | null = element;
      current !== null;
      current = current.parentElement
    ) {
      const rule = winningRule(current, property);
      if (
        rule !== undefined &&
        rule.value !== "inherit" &&
        rule.value !== "currentcolor"
      ) {
        return current === element
          ? rule
          : { selector: `${rule.selector} (inherited)`, value: rule.value };
      }
    }
    return undefined;
  }

  // --- Visibility and backdrop. ---
  function visible(element: Element): boolean {
    if (element.getClientRects().length === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    for (
      let current: Element | null = element;
      current !== null;
      current = current.parentElement
    ) {
      if (current.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(current);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (Number(style.opacity) < 0.05) return false;
      if (style.clip.startsWith("rect(0")) return false;
      if (style.clipPath.includes("inset(50%")) return false;
    }
    return true;
  }

  function backdrop(element: Element): {
    base: Rgba;
    candidates: Rgba[];
    opacity: number;
    faded?: Element;
  } {
    const chain: Element[] = [];
    for (
      let current: Element | null = element;
      current !== null;
      current = current.parentElement
    ) {
      chain.unshift(current);
    }
    let candidates: Rgba[] = [[255, 255, 255, 1]];
    let base: Rgba = [255, 255, 255, 1];
    let opacity = 1;
    let faded: Element | undefined;
    for (const node of chain) {
      const style = getComputedStyle(node);
      const colour = parse(style.backgroundColor);
      base = over(colour, base);
      candidates = candidates.map((candidate) => over(colour, candidate));
      if (style.backgroundImage.includes("gradient")) {
        // Image layers paint bottom (last listed) to top. Each gradient stop is a
        // possible backdrop at some point in the box; a transparent stop lets the
        // layers beneath show through, so it keeps those candidates alive.
        const layers = splitSelectors(style.backgroundImage);
        const sizes = splitSelectors(style.backgroundSize);
        for (let index = layers.length - 1; index >= 0; index--) {
          const layer = layers[index]!;
          if (!layer.includes("gradient")) continue;
          const stops = (layer.match(colourPattern) ?? []).map(parse);
          if (stops.length === 0) continue;
          const layered: Rgba[] = [];
          for (const candidate of candidates) {
            for (const stop of stops) layered.push(over(stop, candidate));
          }
          // A sized layer (a stripe, a corner badge) leaves the rest of the box
          // showing what was beneath it.
          const size = sizes[index % Math.max(sizes.length, 1)] ?? "auto";
          const fullBleed = ["auto", "auto auto", "100% 100%", "cover"].includes(size);
          candidates = fullBleed ? layered : candidates.concat(layered);
          if (candidates.length > 64) {
            candidates.sort((a, b) => luminance(a) - luminance(b));
            candidates = [candidates[0]!, candidates[candidates.length - 1]!, base];
          }
        }
      }
      const nodeOpacity = Number(style.opacity);
      if (nodeOpacity < 1) faded = node;
      opacity *= nodeOpacity;
    }
    return { base, candidates, opacity, ...(faded === undefined ? {} : { faded }) };
  }

  const failures: Omit<ContrastFailure, "theme">[] = [];
  const seen = new Set<string>();
  for (const element of document.body.querySelectorAll("*")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName)) continue;
    if (element.closest(".developer-inspector-boundary") !== null) continue;
    let text = "";
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    }
    if (
      element instanceof HTMLInputElement &&
      !["range", "checkbox", "radio", "hidden", "file"].includes(element.type)
    ) {
      text = element.value || element.placeholder;
    }
    if (element instanceof HTMLSelectElement) {
      text = element.selectedOptions[0]?.textContent ?? "";
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text === "" || !visible(element)) continue;

    const style = getComputedStyle(element);
    const svgText = element instanceof SVGElement;
    const ink = parse(svgText ? style.fill : style.color);
    const { candidates, opacity, faded } = backdrop(element);
    const foreground: Rgba = [ink[0], ink[1], ink[2], ink[3] * opacity];
    let worst = Infinity;
    let worstBackground = candidates[0]!;
    for (const candidate of candidates) {
      const ratio = contrast(over(foreground, candidate), candidate);
      if (ratio < worst) {
        worst = ratio;
        worstBackground = candidate;
      }
    }
    const fontSize = Number.parseFloat(style.fontSize);
    const large =
      fontSize >= 24 || (Number(style.fontWeight) >= 700 && fontSize >= 18.66);
    const disabled = element.closest(":disabled, [aria-disabled='true']") !== null;
    const required = disabled
      ? options.minimumDisabled
      : large
        ? options.minimumLarge
        : options.minimum;
    if (worst >= required) continue;

    const path = describe(element);
    const key = `${path}|${hex(foreground)}|${hex(worstBackground)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const colourRule = colourSource(element, svgText ? "fill" : "color");
    const opacityRule = faded === undefined ? undefined : winningRule(faded, "opacity");
    failures.push({
      ratio: Math.round(worst * 100) / 100,
      required,
      foreground: hex(foreground),
      background: hex(worstBackground),
      fontSize,
      text: text.slice(0, 60),
      path,
      ...(colourRule === undefined ? {} : { colourRule }),
      ...(opacityRule === undefined ? {} : { opacityRule }),
    });
  }
  return failures.sort((a, b) => a.ratio - b.ratio);
}

/** Audits the current screen in both themes, restoring the player's theme after. */
export async function auditContrast(
  page: Page,
  options: Partial<AuditOptions> = {},
): Promise<ContrastFailure[]> {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const original = await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "contrast-audit-freeze";
    // Measure settled colours: no theme cross-fade, and entrance animations
    // jump to their resting state instead of being caught mid fade-in.
    style.textContent =
      "*,*::before,*::after{transition:none !important;animation-delay:0s !important;" +
      "animation-duration:0s !important;animation-iteration-count:1 !important}";
    document.head.append(style);
    return document.documentElement.dataset["theme"] ?? "light";
  });
  const failures: ContrastFailure[] = [];
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((next) => {
      document.documentElement.dataset["theme"] = next;
    }, theme);
    await page.waitForTimeout(50);
    const found = await page.evaluate(auditInPage, merged);
    failures.push(...found.map((failure) => ({ theme, ...failure })));
  }
  await page.evaluate((previous) => {
    document.documentElement.dataset["theme"] = previous;
    document.getElementById("contrast-audit-freeze")?.remove();
  }, original);
  return failures;
}

export function formatContrastFailures(failures: readonly ContrastFailure[]): string {
  return failures
    .map(
      (failure) =>
        `[${failure.theme}] ${failure.ratio.toFixed(2)}:1 < ${String(failure.required)} ` +
        `${failure.foreground} on ${failure.background} — "${failure.text}" ` +
        `(${failure.path})` +
        (failure.colourRule === undefined
          ? ""
          : ` colour: ${failure.colourRule.selector} { ${failure.colourRule.value} }`) +
        (failure.opacityRule === undefined
          ? ""
          : ` opacity: ${failure.opacityRule.selector} { ${failure.opacityRule.value} }`),
    )
    .join("\n");
}
