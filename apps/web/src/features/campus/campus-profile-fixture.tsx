import type { ReactElement } from "react";

import type { CampusView } from "@neolab/sim/public";

import { CampusStrip } from "./campus-strip.tsx";

const VISUAL_FAMILIES = [
  ["headquarters", "headquarters"],
  ["data-centre", "compute-campus"],
  ["power-and-cooling", "utilities-yard"],
  ["alignment-institute", "safety-campus"],
  ["research-campus", "research-campus"],
  ["robotics-lab", "robotics-yard"],
  ["staff-commons", "staff-commons"],
  ["scientific-laboratory", "science-campus"],
] as const;

const PROFILE_CAMPUS: CampusView = {
  facilities: Array.from({ length: 20 }, (_, index) => {
    const [family, campusModule] = VISUAL_FAMILIES[index % VISUAL_FAMILIES.length]!;
    return {
      facilityId: `profile:facility:${String(index)}`,
      definitionId: `profile:definition:${String(index)}`,
      displayName: `${family.replaceAll("-", " ")} ${String(Math.floor(index / VISUAL_FAMILIES.length) + 1)}`,
      family,
      tier: 1,
      campusModule: `${campusModule}-${String(index)}`,
      operational: true,
      loadState: index % 2 === 0 ? "active" : "heavy",
      loadBasisPoints: index % 2 === 0 ? 6_500 : 9_000,
      loadLabel: index % 2 === 0 ? "Operational" : "High load",
      namedResearcherIds: [],
    };
  }),
  construction: ["foundations", "structure", "commissioning"].map((stage, index) => ({
    projectId: `profile:project:${String(index)}`,
    definitionId: `profile:construction:${String(index)}`,
    displayName: `Expansion ${String(index + 1)}`,
    campusModule: `expansion-${String(index)}`,
    stage: stage as "foundations" | "structure" | "commissioning",
    stageLabel: stage.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    progressBasisPoints: (index + 1) * 2_500,
  })),
  namedPeople: Array.from({ length: 8 }, (_, index) => ({
    researcherId: `profile:researcher:${String(index)}`,
    displayName: `Researcher ${String(index + 1)}`,
    portraitAssetId: `profile:portrait:${String(index)}`,
    portraitAltText: `Profile researcher ${String(index + 1)}`,
    portraitBrief:
      index % 2 === 0 ? "short dark hair, blue accent" : "glasses, green accent",
    assignmentLabel: index % 2 === 0 ? "Lead · Architectures" : "Unassigned",
    locationModule: VISUAL_FAMILIES[index % VISUAL_FAMILIES.length]![1],
  })),
  sceneCues: [
    {
      id: "profile:alarm",
      kind: "incident-alarm",
      severity: "urgent",
      label: "Cooling response team deployed",
    },
    {
      id: "profile:red-team",
      kind: "red-team-active",
      severity: "attention",
      label: "Red-team exercise in progress",
    },
    {
      id: "profile:investors",
      kind: "investor-visit",
      severity: "ambient",
      label: "Investor delegation on campus",
    },
  ],
  decorativeStaffCount: 18,
  overflowFacilityCount: 4,
};

/** Development-only maximum-density fixture used by the S9.2 browser profiler. */
export function CampusProfileFixture(): ReactElement {
  return (
    <main className="campus-profile-fixture">
      <header>
        <p className="eyebrow">RENDERING LAB // MAXIMUM CONTRACT DENSITY</p>
        <h1>Campus renderer profile</h1>
      </header>
      <CampusStrip campus={PROFILE_CAMPUS} dateLabel="PROFILE WEEK" />
    </main>
  );
}
