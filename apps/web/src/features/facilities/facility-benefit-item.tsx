import type { ReactElement } from "react";

import type { GameView } from "@neolab/sim/public";

import { MechanicHelp } from "../help/mechanic-help.tsx";

type FacilityBenefit = GameView["facilities"]["catalogue"][number]["benefits"][number];

export function FacilityBenefitItem({
  benefit,
}: {
  readonly benefit: FacilityBenefit;
}): ReactElement {
  return (
    <li className={benefit.tone === "tradeoff" ? "tradeoff" : undefined}>
      <span className="facility-benefit-row">
        <span>{benefit.label}</span>
        {benefit.help === undefined ? null : (
          <MechanicHelp label={benefit.help.label}>{benefit.help.body}</MechanicHelp>
        )}
      </span>
    </li>
  );
}
