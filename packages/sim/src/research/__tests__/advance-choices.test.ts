import { describe, expect, it } from "vitest";
import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";
import rawBundle from "../../../../content/generated/content.bundle.json";

const content: CompiledContent = validateCompiledContent(rawBundle);

/** Options offered against each other: same programme, same level threshold. */
function decisionPoints(): Map<string, { name: string; targets: string }[]> {
  const groups = new Map<string, { name: string; targets: string }[]>();
  for (const [id, advance] of Object.entries(content.research.genericAdvances)) {
    const match = /^base:advance\.([a-z0-9-]+)\.(\d+)\./.exec(id);
    if (match === null) continue;
    const key = `${match[1] ?? ""}@${match[2] ?? ""}`;
    const targets = [...advance.effects.map((e) => e.target)].sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), { name: advance.name, targets }]);
  }
  return groups;
}

describe("research advance choices", () => {
  it("never offers two options that differ only in degree", () => {
    // Every optimisation-scaling decision was one branch at exactly HALF the
    // other, on the same target: ten decisions with one correct answer each.
    // Options must differ in KIND, so the player is trading something.
    const dominated: string[] = [];
    for (const [key, options] of decisionPoints()) {
      for (let i = 0; i < options.length; i += 1) {
        for (let j = i + 1; j < options.length; j += 1) {
          const a = options[i];
          const b = options[j];
          if (a === undefined || b === undefined) continue;
          if (a.targets !== "" && a.targets === b.targets) {
            dominated.push(`${key}: ${a.name} vs ${b.name}`);
          }
        }
      }
    }
    expect(dominated).toEqual([]);
  });

  it("gives every option at least one effect", () => {
    const empty = Object.values(content.research.genericAdvances)
      .filter((a) => a.effects.length === 0)
      .map((a) => a.name);
    expect(empty).toEqual([]);
  });
});
