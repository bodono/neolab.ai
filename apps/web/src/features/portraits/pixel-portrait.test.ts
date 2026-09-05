import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadCompiledContent } from "@neolab/content";
import { describe, expect, it } from "vitest";

import {
  isPortraitAppearanceReferenceReviewed,
  isPortraitSkinToneReferenceReviewed,
  PixelPortrait,
} from "./pixel-portrait.tsx";

function renderPortrait(subjectId: string, name: string): string {
  return renderToStaticMarkup(
    createElement(PixelPortrait, {
      subjectId,
      name,
      brief: "Editorial portrait with no appearance details.",
    }),
  );
}

describe("reference-reviewed pixel portraits", () => {
  it("never derives a current researcher's skin tone from the fallback hash", () => {
    const content = loadCompiledContent();
    const unresolved: string[] = [];
    for (const id of content.researchers.orderedIds) {
      const researcher = content.researchers.definitions[id];
      expect(researcher).toBeDefined();
      if (
        researcher !== undefined &&
        !isPortraitSkinToneReferenceReviewed(
          researcher.portrait.assetId,
          researcher.displayName,
          researcher.portrait.brief,
        )
      ) {
        unresolved.push(researcher.displayName);
      }
    }

    expect(unresolved).toEqual([]);
  });

  it("uses reference-reviewed appearance traits for every current researcher", () => {
    const content = loadCompiledContent();
    for (const id of content.researchers.orderedIds) {
      const researcher = content.researchers.definitions[id];
      expect(researcher).toBeDefined();
      if (researcher === undefined) continue;

      expect(
        isPortraitAppearanceReferenceReviewed(
          researcher.portrait.assetId,
          researcher.displayName,
        ),
        researcher.displayName,
      ).toBe(true);
    }
  });

  it("does not lighten the reviewed darker-complexion researchers", () => {
    const content = loadCompiledContent();
    const expectedSkinByResearcherId = {
      "base:researcher.ash-vashwani": "#9d6043",
      "base:researcher.deepak-pathark": "#9d6043",
      "base:researcher.jitendra-malek": "#9d6043",
      "base:researcher.neel-nandy": "#9d6043",
      "base:researcher.niki-parmer": "#9d6043",
      "base:researcher.prafull-dhariwal": "#9d6043",
      "base:researcher.pushmeet-kohly": "#9d6043",
    } as const;

    for (const [id, expectedSkin] of Object.entries(expectedSkinByResearcherId)) {
      const researcher = content.researchers.definitions[id];
      expect(researcher).toBeDefined();
      if (researcher === undefined) continue;

      const markup = renderToStaticMarkup(
        createElement(PixelPortrait, {
          subjectId: researcher.portrait.assetId,
          name: researcher.displayName,
          brief: researcher.portrait.brief,
        }),
      );
      expect(markup).toContain(`fill="${expectedSkin}"`);
      expect(markup).not.toContain('fill="#f2c5a0"');
    }
  });

  it("renders Pushmeet Kohly with a red turban and no beard", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.pushmeet-kohly",
      "Pushmeet Kohly",
    );

    expect(markup).toContain('<g fill="#b43b32"><rect x="8" y="6" width="16" height="8"');
    expect(markup).not.toContain(
      '<g fill="#302823"><rect x="10" y="19" width="12" height="4"',
    );
  });

  it("renders Norm Brown with a medium complexion, short curly hair, and glasses", () => {
    const markup = renderPortrait("base:portrait.researcher.norm-brown", "Norm Brown");

    expect(markup).toContain('fill="#d99a72"');
    expect(markup).toContain('<g fill="#302823"><rect x="8" y="6" width="16" height="5"');
    expect(markup).toContain('stroke="#30383c"');
    expect(markup).not.toContain('<rect x="7" y="13" width="4" height="12"');
  });

  it("renders Been Kimm with a pale complexion and long black hair", () => {
    const markup = renderPortrait("base:portrait.researcher.been-kimm", "Been Kimm");

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('<g fill="#17191b"><rect x="7" y="7" width="18" height="8"');
    expect(markup).toContain('<rect x="7" y="13" width="4" height="12"');
    expect(markup).not.toContain('<rect x="7" y="12" width="4" height="8"');
  });

  it("renders Dawn Sung with a pale complexion and long black hair", () => {
    const markup = renderPortrait("base:portrait.researcher.dawn-sung", "Dawn Sung");

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('<g fill="#17191b"><rect x="7" y="7" width="18" height="8"');
    expect(markup).toContain('<rect x="7" y="13" width="4" height="12"');
    expect(markup).not.toContain('fill="#553126"');
  });

  it("renders Alec Broadford with short light-brown hair and glasses", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.alec-broadford",
      "Alec Broadford",
    );

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('fill="#a36b3e"');
    expect(markup).toContain('fill="#26343d"');
    expect(markup).toContain('<rect x="8" y="6" width="16" height="6"');
    expect(markup).toContain('stroke="#30383c"');
  });

  it("keeps Andrew N. Gee and Jayson Wei visually distinct", () => {
    const andrew = renderPortrait(
      "base:portrait.researcher.andrew-n-gee",
      "Andrew N. Gee",
    );
    const jayson = renderPortrait("base:portrait.researcher.jayson-wei", "Jayson Wei");

    expect(andrew).toContain('<rect width="32" height="32" fill="#d9e2e5"');
    expect(andrew).toContain('fill="#2e86c9"');
    expect(andrew).not.toContain('stroke="#30383c"');
    expect(jayson).toContain('<rect width="32" height="32" fill="#d6eadc"');
    expect(jayson).toContain('fill="#26343d"');
    expect(jayson).toContain('stroke="#30383c"');
  });

  it("renders Koray Kavukoglu with short salt-and-pepper hair and a yellow sweater", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.koray-kavukoglu",
      "Koray Kavukoglu",
    );

    expect(markup).toContain('fill="#d99a72"');
    expect(markup).toContain('fill="#8c8177"');
    expect(markup).toContain('fill="#d6ad35"');
    expect(markup).toContain('<rect x="8" y="6" width="16" height="6"');
    expect(markup).not.toContain('stroke="#30383c"');
  });

  it("renders Tim Rocktaschel with short grey hair and a short grey beard", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.tim-rocktaschel",
      "Tim Rocktaschel",
    );

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('<g fill="#8b8d89"><rect x="8" y="6" width="16" height="6"');
    expect(markup).toContain(
      '<g fill="#8b8d89"><rect x="10" y="19" width="12" height="4"',
    );
    expect(markup).not.toContain('stroke="#30383c"');
  });

  it("renders Aaron van den Oord with swept dark hair and a short beard", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.aaron-van-den-oord",
      "Aaron van den Oord",
    );

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('<g fill="#302823"><rect x="8" y="7" width="16"');
    expect(markup).toContain(
      '<g fill="#302823"><rect x="10" y="19" width="12" height="4"',
    );
    expect(markup).not.toContain('stroke="#30383c"');
  });

  it("renders the nine earlier 2026 roster additions with their reference-reviewed traits", () => {
    const lucas = renderPortrait("base:portrait.researcher.lucas-kaiser", "Lucas Kaiser");
    expect(lucas).toContain('<g fill="#302823"><rect x="8" y="7" width="4"');
    expect(lucas).not.toContain('stroke="#30383c"');

    const judea = renderPortrait("base:portrait.researcher.judea-perle", "Judea Perle");
    expect(judea).toContain('stroke="#30383c"');
    expect(judea).toContain(
      '<g fill="#8b8d89"><rect x="10" y="19" width="12" height="4"',
    );

    const timothy = renderPortrait(
      "base:portrait.researcher.timothy-lillicroft",
      "Timothy Lillicroft",
    );
    expect(timothy).toContain('<rect x="24" y="13" width="4" height="6"');
    expect(timothy).toContain('<rect x="12" y="18" width="8" height="2"');
    expect(timothy).not.toContain('stroke="#30383c"');

    const trevor = renderPortrait(
      "base:portrait.researcher.trevor-darnell",
      "Trevor Darnell",
    );
    expect(trevor).toContain('<g fill="#4f5050"><rect x="8" y="7" width="16"');
    expect(trevor).not.toContain('stroke="#30383c"');

    const rob = renderPortrait("base:portrait.researcher.rob-fergan", "Rob Fergan");
    expect(rob).toContain('<g fill="#302823"><rect x="8" y="6" width="16"');
    expect(rob).toContain('<rect x="11" y="20" width="3" height="2" opacity="0.65"');
    expect(rob).not.toContain('stroke="#30383c"');

    const ruslan = renderPortrait(
      "base:portrait.researcher.ruslan-salakhudinov",
      "Ruslan Salakhudinov",
    );
    expect(ruslan).toContain('<g fill="#302823"><rect x="8" y="7" width="16"');
    expect(ruslan).not.toContain('stroke="#30383c"');

    const christopher = renderPortrait(
      "base:portrait.researcher.christopher-bishopp",
      "Christopher Bishopp",
    );
    expect(christopher).toContain('<g fill="#aeb4b5"><rect x="8" y="10" width="3"');
    expect(christopher).toContain('stroke="#30383c"');

    const tomas = renderPortrait(
      "base:portrait.researcher.tomas-mikoloff",
      "Tomas Mikoloff",
    );
    expect(tomas).toContain('<g fill="#654936"><rect x="8" y="6" width="16"');
    expect(tomas).not.toContain('stroke="#30383c"');

    const cordelia = renderPortrait(
      "base:portrait.researcher.cordelia-schmidt",
      "Cordelia Schmidt",
    );
    expect(cordelia).toContain('<g fill="#8f806f"><rect x="8" y="6" width="16"');
    expect(cordelia).toContain('<rect x="21" y="15" width="4" height="7"');
    expect(cordelia).not.toContain('stroke="#30383c"');
  });

  it("renders Mario Amodeo with Joshua Benji's curly hair shape in dark hair", () => {
    const markup = renderPortrait("base:portrait.leader.dario-amodeo", "Mario Amodeo");

    expect(markup).toContain('<g fill="#292523"><rect x="8" y="6" width="16" height="5"');
    expect(markup).toContain('<rect x="6" y="8" width="5" height="7"');
    expect(markup).toContain('<rect x="21" y="8" width="5" height="7"');
    expect(markup).toContain('<rect x="10" y="4" width="4" height="3"');
    expect(markup).toContain('<rect x="17" y="4" width="5" height="3"');
    expect(markup).not.toContain("#8f8983");
    expect(markup).toContain('stroke="#30383c"');
  });

  it("keeps Luke Zettlemeyer's reviewed appearance independent of the fallback hash", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.luke-zettlemeyer",
      "Luke Zettlemeyer",
    );

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('<g fill="#aeb4b5"><rect x="7" y="7" width="18" height="8"');
    expect(markup).toContain(
      '<g fill="#aeb4b5"><rect x="10" y="19" width="12" height="4"',
    );
    expect(markup).toContain('stroke="#30383c"');
    expect(markup).not.toContain('fill="#553126"');
  });

  it("keeps Raia Hadsall's reviewed appearance independent of the fallback hash", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.raia-hadsall",
      "Raia Hadsall",
    );

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain('fill="#3153a4"');
    expect(markup).toContain('stroke="#30383c"');
    expect(markup).not.toContain('fill="#7d4837"');
  });

  it("renders Doina Precupe with shoulder-length dark hair and glasses", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.doina-precupe",
      "Doina Precupe",
    );

    expect(markup).toContain('<g fill="#302823"><rect x="7" y="7" width="18" height="7"');
    expect(markup).toContain('<rect x="7" y="12" width="4" height="8"');
    expect(markup).toContain('stroke="#30383c"');
  });

  it("renders Katie Bowman with long brown hair", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.katie-bowman",
      "Katie Bowman",
    );

    expect(markup).toContain('<g fill="#654936"><rect x="7" y="7" width="18" height="8"');
  });

  it("renders Shauna Kravek with long reddish-blonde hair and glasses", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.shauna-kravek",
      "Shauna Kravek",
    );

    expect(markup).toContain('<g fill="#b97855"><rect x="7" y="7" width="18" height="8"');
    expect(markup).toContain('stroke="#30383c"');
  });

  it("renders Sarah Hooker with very long red hair", () => {
    const markup = renderPortrait(
      "base:portrait.researcher.sarah-hooker",
      "Sarah Hooker",
    );

    expect(markup).toContain('<g fill="#9b4b2e"><rect x="7" y="7" width="18" height="8"');
    expect(markup).not.toContain('stroke="#30383c"');
  });

  it("does not randomly assign a receding hairstyle to a woman", () => {
    const markup = renderToStaticMarkup(
      createElement(PixelPortrait, {
        subjectId: "base:portrait.researcher.fallback-woman-0",
        name: "Fallback Woman",
        brief: "Editorial portrait of a woman with no hairstyle details.",
      }),
    );

    expect(markup).toContain('<rect x="8" y="6" width="16" height="6"');
    expect(markup).not.toContain('<rect x="8" y="7" width="4" height="7"');
  });

  it("does not randomly assign long hair to a man", () => {
    const markup = renderToStaticMarkup(
      createElement(PixelPortrait, {
        subjectId: "base:portrait.researcher.fallback-man-4",
        name: "Fallback Man",
        brief: "Editorial portrait of a man with no hairstyle details.",
      }),
    );

    expect(markup).toContain('<rect x="8" y="6" width="16" height="6"');
    expect(markup).not.toContain('<rect x="7" y="13" width="4" height="12"');
  });

  it("renders Noam Shazer as bald even if a stale brief mentions dark hair", () => {
    const markup = renderToStaticMarkup(
      createElement(PixelPortrait, {
        subjectId: "base:portrait.researcher.noam-shazer",
        name: "Noam Shazer",
        brief: "White man with short dark hair and glasses.",
      }),
    );

    expect(markup).not.toContain('fill="#302823"');
    expect(markup).toContain('stroke="#30383c"');
  });

  it("renders Rick Sutton with a bald crown, long grey side hair and beard", () => {
    const markup = renderPortrait("base:portrait.researcher.rick-sutton", "Rick Sutton");

    expect(markup).toContain('fill="#e9b994"');
    expect(markup).toContain(
      '<g fill="#aeb4b5"><rect x="7" y="10" width="4" height="15"',
    );
    expect(markup).toContain('<rect x="21" y="10" width="4" height="15"');
    expect(markup).toContain(
      '<g fill="#aeb4b5"><rect x="10" y="19" width="12" height="4"',
    );
    expect(markup).toContain('<rect x="13" y="25" width="6" height="3"');
    expect(markup).toContain('<rect x="14" y="28" width="4" height="2"');
    expect(markup).toContain('stroke="#30383c"');
    expect(markup).not.toContain('<rect x="8" y="7" width="16" height="5"');
    expect(markup).not.toContain('<rect x="8" y="6" width="16" height="6"');
  });

  const recentPhotoPortraitCases = [
    {
      slug: "jan-liker",
      name: "Jan Liker",
      hair: "#cbb783",
      style: '<rect x="9" y="7" width="14" height="3"',
      glasses: false,
      beard: false,
    },
    {
      slug: "jon-jumper",
      name: "Jon Jumper",
      hair: "#654936",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: false,
      beard: false,
    },
    {
      slug: "jakub-pachowski",
      name: "Jakub Pachowski",
      hair: "#a36b3e",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: false,
      beard: false,
    },
    {
      slug: "timo-brooks",
      name: "Timo Brooks",
      hair: "#654936",
      style: '<rect x="8" y="6" width="16" height="5"',
      glasses: false,
      beard: true,
    },
    {
      slug: "billy-peebles",
      name: "Billy Peebles",
      hair: "#654936",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
      beard: false,
    },
    {
      slug: "noah-goodmann",
      name: "Noah Goodmann",
      hair: "#654936",
      style: '<rect x="8" y="6" width="16" height="5"',
      glasses: true,
      beard: false,
    },
    {
      slug: "rich-caruano",
      name: "Rich Caruano",
      hair: "#aeb4b5",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
      beard: true,
    },
    {
      slug: "leo-bottou",
      name: "Léo Bottou",
      hair: "#aeb4b5",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
      beard: true,
    },
    {
      slug: "shane-legge",
      name: "Shane Legge",
      hair: "#4f5050",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: false,
      beard: false,
    },
    {
      slug: "stephen-boyde",
      name: "Stephen Boyde",
      hair: "#aeb4b5",
      style: '<rect x="9" y="7" width="14" height="3"',
      glasses: false,
      beard: false,
    },
    {
      slug: "jonathan-hoe",
      name: "Jonathan Hoe",
      hair: "#17191b",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
      beard: true,
    },
    {
      slug: "melany-mitchell",
      name: "Melany Mitchell",
      hair: "#302823",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
      beard: false,
    },
    {
      slug: "oriol-vinyalls",
      name: "Oriol Vinyalls",
      hair: "#302823",
      style: '<rect x="8" y="6" width="16" height="5"',
      glasses: true,
      beard: false,
    },
    {
      slug: "max-willing",
      name: "Max Willing",
      hair: "#cbb783",
      style: '<rect x="8" y="7" width="16" height="5"',
      glasses: true,
      beard: false,
    },
    {
      slug: "geoffrey-hintoff",
      name: "Geoffrey Hintoff",
      hair: "#aeb4b5",
      style: '<rect x="8" y="7" width="16" height="5"',
      glasses: false,
      beard: false,
    },
    {
      slug: "joshua-benji",
      name: "Joshua Benji",
      hair: "#aeb4b5",
      style: '<rect x="8" y="6" width="16" height="5"',
      glasses: false,
      beard: true,
    },
    {
      slug: "zico-kolder",
      name: "Zico Kolder",
      hair: "#302823",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: false,
      beard: true,
    },
  ] as const;

  for (const portraitCase of recentPhotoPortraitCases) {
    it(`renders ${portraitCase.name} from explicit recent-photo traits`, () => {
      const markup = renderPortrait(
        `base:portrait.researcher.${portraitCase.slug}`,
        portraitCase.name,
      );

      expect(markup).toContain(`fill="${portraitCase.hair}"`);
      expect(markup).toContain(portraitCase.style);
      if (portraitCase.glasses) expect(markup).toContain('stroke="#30383c"');
      else expect(markup).not.toContain('stroke="#30383c"');
      if (portraitCase.beard)
        expect(markup).toContain(
          `<g fill="${portraitCase.hair}"><rect x="10" y="19" width="12" height="4"`,
        );
      else
        expect(markup).not.toContain(
          `<g fill="${portraitCase.hair}"><rect x="10" y="19" width="12" height="4"`,
        );
    });
  }

  const newlyAddedFounderPortraitCases = [
    {
      slug: "john-hopfeld",
      name: "John Hopfeld",
      hair: "#aeb4b5",
      style: '<rect x="9" y="7" width="14" height="3"',
      glasses: false,
      beard: false,
    },
    {
      slug: "paul-werbost",
      name: "Paul Werbost",
      hair: "#aeb4b5",
      style: '<rect x="8" y="7" width="4" height="7"',
      glasses: false,
      beard: false,
    },
    {
      slug: "vladimir-vapnick",
      name: "Vladimir Vapnick",
      hair: "#aeb4b5",
      style: '<rect x="8" y="7" width="4" height="7"',
      glasses: false,
      beard: false,
    },
    {
      slug: "leslie-valiante",
      name: "Leslie Valiante",
      hair: "#aeb4b5",
      style: '<rect x="8" y="7" width="4" height="7"',
      glasses: true,
      beard: false,
    },
    {
      slug: "bernhard-scholkopff",
      name: "Bernhard Schölkopff",
      hair: "#654936",
      style: '<rect x="10" y="6" width="5" height="5"',
      glasses: true,
      beard: true,
    },
    {
      slug: "terrence-sejnowsky",
      name: "Terrence Sejnowsky",
      hair: "#4f5050",
      style: '<rect x="8" y="7" width="16" height="5"',
      glasses: true,
      beard: false,
    },
  ] as const;

  for (const portraitCase of newlyAddedFounderPortraitCases) {
    it(`renders ${portraitCase.name} from reference-reviewed traits`, () => {
      const markup = renderPortrait(
        `base:portrait.researcher.${portraitCase.slug}`,
        portraitCase.name,
      );

      expect(markup).toContain('fill="#e9b994"');
      expect(markup).toContain(`fill="${portraitCase.hair}"`);
      expect(markup).toContain(portraitCase.style);
      if (portraitCase.glasses) expect(markup).toContain('stroke="#30383c"');
      else expect(markup).not.toContain('stroke="#30383c"');
      if (portraitCase.beard)
        expect(markup).toContain(
          `<g fill="${portraitCase.hair}"><rect x="10" y="19" width="12" height="4"`,
        );
      else
        expect(markup).not.toContain(
          `<g fill="${portraitCase.hair}"><rect x="10" y="19" width="12" height="4"`,
        );
    });
  }

  const reviewedPortraitCases = [
    {
      name: "Jo Pineau",
      hair: "#654936",
      style: '<rect x="7" y="12" width="4" height="8"',
      glasses: false,
    },
    {
      name: "Geoff Deen",
      hair: "#654936",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
    },
    {
      name: "Sanja Fiedler",
      hair: "#cbb783",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: false,
    },
    {
      name: "Anca Dragane",
      hair: "#17191b",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: false,
    },
    {
      name: "Ilya Suchkeeper",
      hair: "#302823",
      style: '<rect x="8" y="7" width="4" height="7"',
      glasses: false,
    },
    {
      name: "Danny Zhou",
      hair: "#17191b",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: false,
    },
    {
      name: "Been Kimm",
      hair: "#17191b",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: true,
    },
    {
      name: "Cynthia Rudan",
      hair: "#654936",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: false,
    },
    {
      name: "Michael I. Jordanne",
      hair: "#aeb4b5",
      style: '<rect x="9" y="7" width="14" height="3"',
      glasses: false,
    },
    {
      name: "Alex Graven",
      hair: "#a36b3e",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: false,
    },
    {
      name: "Alex Krizhensky",
      hair: "#a36b3e",
      style: '<rect x="9" y="7" width="14" height="3"',
      glasses: false,
    },
    {
      name: "Corinna Cortez",
      hair: "#cbb783",
      style: '<rect x="7" y="12" width="4" height="8"',
      glasses: false,
    },
    {
      name: "Kelsey Finn",
      hair: "#654936",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: false,
    },
    {
      name: "Daphne Kohler",
      hair: "#aeb4b5",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: false,
    },
    {
      name: "Dawn Sung",
      hair: "#17191b",
      style: '<rect x="7" y="13" width="4" height="12"',
      glasses: false,
    },
    {
      name: "Stephen Boyde",
      hair: "#aeb4b5",
      style: '<rect x="9" y="7" width="14" height="3"',
      glasses: false,
    },
    {
      name: "Emmanuel Candez",
      hair: "#4f5050",
      style: '<rect x="8" y="6" width="16" height="6"',
      glasses: true,
    },
  ] as const;

  for (const portraitCase of reviewedPortraitCases) {
    it(`renders ${portraitCase.name} with reference-reviewed gender presentation and hair`, () => {
      const slug =
        portraitCase.name === "Michael I. Jordanne"
          ? "michael-jordanne"
          : portraitCase.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
      const markup = renderPortrait(
        `base:portrait.researcher.${slug}`,
        portraitCase.name,
      );

      expect(markup).toContain(`fill="${portraitCase.hair}"`);
      expect(markup).toContain(portraitCase.style);
      if (portraitCase.glasses) expect(markup).toContain('stroke="#30383c"');
      else expect(markup).not.toContain('stroke="#30383c"');
    });
  }
});
