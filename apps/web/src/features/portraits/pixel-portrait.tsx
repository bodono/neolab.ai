import type { ReactElement } from "react";

type HairStyle =
  | "short"
  | "bushy"
  | "swept"
  | "curly"
  | "curly-receding"
  | "dense-curly-receding"
  | "wavy-medium"
  | "tied-back"
  | "long"
  | "medium"
  | "receding"
  | "very-short"
  | "bald"
  | "bald-short-sides"
  | "bald-long-sides"
  | "turban";

interface PortraitTraits {
  readonly skin: string;
  readonly hair: string;
  readonly hairHighlight: string | undefined;
  readonly headwear: string | undefined;
  readonly shirt: string;
  readonly backdrop: string;
  readonly accent: string;
  readonly hairStyle: HairStyle;
  readonly glasses: boolean;
  readonly beard: boolean;
  readonly beardStyle: "short" | "long" | "goatee" | "stubble";
}

interface PixelPortraitProps {
  readonly subjectId: string;
  readonly name: string;
  readonly brief?: string | undefined;
  readonly altText?: string;
  readonly className?: string;
}

const SKIN_TONES = ["#f2c5a0", "#d99a72", "#b96f4e", "#7d4837", "#553126"] as const;
const HAIR_COLOURS = ["#171b1d", "#302823", "#654936", "#a36b3e", "#d3c2a0"] as const;
const SHIRT_COLOURS = ["#2e86c9", "#6246a8", "#1f6657", "#b65032", "#26343d"] as const;
const BACKDROPS = ["#cfe4f5", "#e5d9f4", "#d6eadc", "#f2d9c9", "#d9e2e5"] as const;
const ACCENTS = ["#ff7a36", "#8f67e8", "#42b96b", "#2d98e5", "#e46aaa"] as const;

/**
 * Pixel colours reviewed against public portrait photography. These values
 * describe visible complexion only; they are not demographic classifications.
 * Every current researcher whose brief lacks an explicit appearance cue is
 * listed here so the name hash never decides their skin tone.
 */
const REFERENCE_REVIEWED_SKIN_TONES: Readonly<Record<string, string>> = {
  "aaron-van-den-oord": "#e9b994",
  "aidan-gomes": "#d99a72",
  "alec-broadford": "#e9b994",
  "alex-graven": "#e9b994",
  "alyosha-efrossi": "#e9b994",
  "amanda-askill": "#e9b994",
  "anca-dragane": "#e9b994",
  "andrew-zissermann": "#e9b994",
  "been-kimm": "#e9b994",
  "bess-barnes": "#e9b994",
  "billy-peebles": "#e9b994",
  "callum-burns": "#e9b994",
  "christopher-mannering": "#e9b994",
  "christopher-bishopp": "#e9b994",
  "cordelia-schmidt": "#e9b994",
  "corinna-cortez": "#e9b994",
  "cynthia-rudan": "#e9b994",
  "dawn-sung": "#e9b994",
  "danny-zhou": "#d5a078",
  "david-baux": "#e9b994",
  "deepak-pathark": "#9d6043",
  "dieter-foxx": "#e9b994",
  "evan-hubbinger": "#e9b994",
  "geoffrey-irwing": "#e9b994",
  "jacob-steinhart": "#e9b994",
  "jakub-pachowski": "#e9b994",
  "jayson-wei": "#d5a078",
  "john-hopfeld": "#e9b994",
  "judea-perle": "#e9b994",
  "karen-simonian": "#d99a72",
  "katie-bowman": "#e9b994",
  "ken-goldenberg": "#e9b994",
  "koray-kavukoglu": "#d99a72",
  "leslie-valiante": "#e9b994",
  "lucas-kaiser": "#e9b994",
  "luke-zettlemeyer": "#e9b994",
  "marika-zitnik": "#e9b994",
  "max-willing": "#e9b994",
  "melany-mitchell": "#e9b994",
  "mikhail-bronsteen": "#e9b994",
  "mike-lewiston": "#e9b994",
  "nando-de-freita": "#d99a72",
  "neel-nandy": "#9d6043",
  "nick-carlini": "#e9b994",
  "noah-goodmann": "#e9b994",
  "norm-brown": "#d99a72",
  "oriol-vinyalls": "#e9b994",
  "paul-werbost": "#e9b994",
  "percy-liange": "#d5a078",
  "prafull-dhariwal": "#9d6043",
  "pushmeet-kohly": "#9d6043",
  "quoc-v-lee": "#d5a078",
  "raia-hadsall": "#e9b994",
  "rich-caruano": "#e9b994",
  "rob-fergan": "#e9b994",
  "sammy-benji": "#e9b994",
  "ruslan-salakhudinov": "#e9b994",
  "sanja-fiedler": "#e9b994",
  "sarah-hooker": "#e9b994",
  "shauna-kravek": "#e9b994",
  "terrence-sejnowsky": "#e9b994",
  "tim-rocktaschel": "#e9b994",
  "timothy-lillicroft": "#e9b994",
  "timo-brooks": "#e9b994",
  "tomas-brown": "#e9b994",
  "tomas-mikoloff": "#e9b994",
  "trevor-darnell": "#e9b994",
  "vladimir-vapnick": "#e9b994",
  "wojciech-zarembo": "#e9b994",
  "zico-kolder": "#d99a72",
  "zubin-ghahramani": "#d99a72",
};

const SPECIAL_SUBJECT_TRAITS: Readonly<Record<string, Partial<PortraitTraits>>> = {
  // Display names can change, but portrait traits follow stable content-ID slugs.
  // The hardware keynote's eternal presenter: black leather jacket, swept
  // dark hair, and the only accent colour he has ever needed.
  "jensen-hwang": {
    skin: "#e2b48c",
    hair: "#26292c",
    shirt: "#16181a",
    backdrop: "#dfe8d4",
    accent: "#76b900",
    hairStyle: "swept",
    glasses: true,
  },
  "dario-amodeo": {
    skin: "#e7b48e",
    hair: "#292523",
    shirt: "#633fa3",
    backdrop: "#dfd4ef",
    accent: "#8f67e8",
    hairStyle: "curly",
    glasses: true,
  },
  "elon-tusk": {
    skin: "#edc09b",
    hair: "#7c6148",
    shirt: "#20282d",
    backdrop: "#dce6eb",
    accent: "#36a5df",
    hairStyle: "swept",
  },
  "liang-wenfang": {
    skin: "#d6a078",
    hair: "#181a1d",
    shirt: "#244f70",
    backdrop: "#d7e8e7",
    accent: "#42b96b",
    hairStyle: "short",
    glasses: true,
  },
  "sam-altmann": {
    skin: "#edbd99",
    hair: "#4b382d",
    shirt: "#355d50",
    backdrop: "#dceadf",
    accent: "#42b96b",
    hairStyle: "short",
  },
  "stan-saltman": {
    skin: "#edbd99",
    hair: "#4b382d",
    shirt: "#355d50",
    backdrop: "#dceadf",
    accent: "#42b96b",
    hairStyle: "short",
  },
  "thomas-hassabi": {
    skin: "#f0c7a6",
    hair: "#36302d",
    shirt: "#26343d",
    backdrop: "#f1ded1",
    accent: "#ff7a36",
    hairStyle: "bald",
    glasses: true,
  },
};

interface ReviewedPortraitOptions {
  readonly glasses?: boolean;
  readonly beard?: boolean;
  readonly beardStyle?: PortraitTraits["beardStyle"];
  readonly headwear?: string;
}

/**
 * Locks the visible traits that could otherwise be inferred from prose. Shirt,
 * backdrop and accent remain hash-varied; complexion, hair, eyewear, headwear
 * and facial hair never do.
 */
function reviewedResearcherPortrait(
  skin: string,
  hair: string,
  hairStyle: HairStyle,
  options: ReviewedPortraitOptions = {},
): Partial<PortraitTraits> {
  return {
    skin,
    hair,
    hairStyle,
    headwear: options.headwear,
    glasses: options.glasses ?? false,
    beard: options.beard ?? false,
    beardStyle: options.beardStyle ?? "short",
  };
}

/**
 * Reference-reviewed visible traits for the complete star-researcher roster.
 * Keeping all 119 stable IDs here means neither a prose edit nor the fallback
 * hash can silently change a real person's appearance.
 */
const REVIEWED_RESEARCHER_TRAITS: Readonly<Record<string, Partial<PortraitTraits>>> = {
  "aaron-courvel": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    glasses: true,
  }),
  "aaron-van-den-oord": reviewedResearcherPortrait("#e9b994", "#302823", "swept", {
    beard: true,
    beardStyle: "short",
  }),
  "aidan-gomes": reviewedResearcherPortrait("#d99a72", "#302823", "medium", {
    glasses: true,
    beard: true,
  }),
  "alec-broadford": {
    ...reviewedResearcherPortrait("#e9b994", "#a36b3e", "short", {
      glasses: true,
    }),
    shirt: "#26343d",
  },
  "alex-graven": reviewedResearcherPortrait("#e9b994", "#a36b3e", "short"),
  "alex-krizhensky": reviewedResearcherPortrait("#e9b994", "#a36b3e", "very-short"),
  "alexei-dosovsky": reviewedResearcherPortrait("#e9b994", "#a36b3e", "very-short", {
    glasses: true,
  }),
  "alyosha-efrossi": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "amanda-askill": reviewedResearcherPortrait("#e9b994", "#cbb783", "long"),
  "anca-dragane": reviewedResearcherPortrait("#e9b994", "#17191b", "long"),
  "andrew-n-gee": {
    ...reviewedResearcherPortrait("#d5a078", "#17191b", "short"),
    shirt: "#2e86c9",
    backdrop: "#d9e2e5",
  },
  "andrew-zissermann": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
  }),
  "andrey-carpathy": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    beard: true,
  }),
  "andy-barto": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "receding", {
    glasses: true,
    beard: true,
  }),
  "ash-vashwani": reviewedResearcherPortrait("#9d6043", "#17191b", "short"),
  "been-kimm": reviewedResearcherPortrait("#e9b994", "#17191b", "long", {
    glasses: true,
  }),
  "bernhard-scholkopff": reviewedResearcherPortrait(
    "#e9b994",
    "#654936",
    "curly-receding",
    { glasses: true, beard: true },
  ),
  "bess-barnes": reviewedResearcherPortrait("#e9b994", "#654936", "medium"),
  "billy-peebles": reviewedResearcherPortrait("#e9b994", "#654936", "short", {
    glasses: true,
  }),
  "callum-burns": reviewedResearcherPortrait("#e9b994", "#654936", "short"),
  "christopher-mannering": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
  }),
  "christopher-bishopp": reviewedResearcherPortrait(
    "#e9b994",
    "#aeb4b5",
    "bald-short-sides",
    { glasses: true },
  ),
  "christopher-olin": reviewedResearcherPortrait("#e9b994", "#654936", "swept"),
  "cordelia-schmidt": reviewedResearcherPortrait("#e9b994", "#8f806f", "wavy-medium"),
  "corinna-cortez": reviewedResearcherPortrait("#e9b994", "#cbb783", "medium"),
  "cynthia-rudan": reviewedResearcherPortrait("#e9b994", "#654936", "long"),
  "danny-zhou": reviewedResearcherPortrait("#d5a078", "#17191b", "short"),
  "daphne-kohler": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "long"),
  "david-baux": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
  }),
  "david-bley": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    glasses: true,
  }),
  "david-sterling": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "dawn-sung": reviewedResearcherPortrait("#e9b994", "#17191b", "long"),
  "deepak-pathark": reviewedResearcherPortrait("#9d6043", "#17191b", "short"),
  "diederik-kingman": reviewedResearcherPortrait("#e9b994", "#a36b3e", "short"),
  "dieter-foxx": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
  }),
  "doina-precupe": reviewedResearcherPortrait("#e9b994", "#302823", "medium", {
    glasses: true,
  }),
  "emmanuel-candez": reviewedResearcherPortrait("#e9b994", "#4f5050", "short", {
    glasses: true,
  }),
  "evan-hubbinger": reviewedResearcherPortrait("#e9b994", "#654936", "short", {
    glasses: true,
  }),
  "faye-faye-lee": reviewedResearcherPortrait("#d5a078", "#17191b", "long"),
  "geoff-deen": reviewedResearcherPortrait("#e9b994", "#654936", "short", {
    glasses: true,
  }),
  "geoffrey-hintoff": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "swept"),
  "geoffrey-irwing": reviewedResearcherPortrait("#e9b994", "#654936", "short", {
    glasses: true,
  }),
  "ian-goodfriend": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    glasses: true,
  }),
  "ian-lemon": reviewedResearcherPortrait("#e9b994", "#4f5050", "swept"),
  "ilya-suchkeeper": reviewedResearcherPortrait("#e9b994", "#302823", "receding"),
  "jacob-devlon": reviewedResearcherPortrait("#e9b994", "#654936", "short"),
  "jacob-steinhart": reviewedResearcherPortrait("#e9b994", "#654936", "short"),
  "jakub-pachowski": reviewedResearcherPortrait("#e9b994", "#a36b3e", "short"),
  "jan-liker": reviewedResearcherPortrait("#e9b994", "#cbb783", "very-short"),
  "jared-kapler": reviewedResearcherPortrait("#e9b994", "#654936", "short", {
    glasses: true,
  }),
  "jayson-wei": {
    ...reviewedResearcherPortrait("#d5a078", "#17191b", "short", {
      glasses: true,
    }),
    shirt: "#26343d",
  },
  "jitendra-malek": reviewedResearcherPortrait("#9d6043", "#aeb4b5", "short", {
    glasses: true,
  }),
  "jo-pineau": reviewedResearcherPortrait("#e9b994", "#654936", "medium"),
  "john-hopfeld": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "very-short"),
  "judea-perle": reviewedResearcherPortrait("#e9b994", "#8b8d89", "short", {
    glasses: true,
    beard: true,
  }),
  "john-schulmann": reviewedResearcherPortrait("#e9b994", "#654936", "short"),
  "jon-jumper": reviewedResearcherPortrait("#e9b994", "#654936", "short"),
  "jonathan-hoe": reviewedResearcherPortrait("#d5a078", "#17191b", "short", {
    glasses: true,
    beard: true,
  }),
  "joshua-benji": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "curly", {
    beard: true,
  }),
  "jurgen-smithhuber": reviewedResearcherPortrait("#e9b994", "#4f5050", "swept"),
  "kai-ming-ho": reviewedResearcherPortrait("#d5a078", "#17191b", "short", {
    glasses: true,
  }),
  "karen-simonian": reviewedResearcherPortrait("#d99a72", "#302823", "short", {
    beard: true,
  }),
  "katie-bowman": reviewedResearcherPortrait("#e9b994", "#654936", "long"),
  "kelsey-finn": reviewedResearcherPortrait("#e9b994", "#654936", "long"),
  "ken-goldenberg": reviewedResearcherPortrait("#e9b994", "#4f5050", "curly", {
    glasses: true,
    beard: true,
  }),
  "koray-kavukoglu": {
    ...reviewedResearcherPortrait("#d99a72", "#8c8177", "short"),
    shirt: "#d6ad35",
  },
  "leo-bottou": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
    beard: true,
  }),
  "leslie-valiante": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "receding", {
    glasses: true,
  }),
  "lucas-kaiser": reviewedResearcherPortrait("#e9b994", "#302823", "receding"),
  "luke-zettlemeyer": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "long", {
    glasses: true,
    beard: true,
  }),
  "marika-zitnik": reviewedResearcherPortrait("#e9b994", "#302823", "medium", {
    glasses: true,
  }),
  "max-willing": reviewedResearcherPortrait("#e9b994", "#cbb783", "swept", {
    glasses: true,
  }),
  "melany-mitchell": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    glasses: true,
  }),
  "michael-jordanne": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "very-short"),
  "mike-lewiston": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "mikhail-bronsteen": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    glasses: true,
  }),
  "nando-de-freita": reviewedResearcherPortrait("#d99a72", "#302823", "short", {
    glasses: true,
  }),
  "neel-nandy": reviewedResearcherPortrait("#9d6043", "#17191b", "short", {
    glasses: true,
  }),
  "nick-carlini": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "niki-parmer": reviewedResearcherPortrait("#9d6043", "#17191b", "medium"),
  "noah-goodmann": reviewedResearcherPortrait("#e9b994", "#654936", "curly", {
    glasses: true,
  }),
  "noam-shazer": reviewedResearcherPortrait("#e9b994", "#302823", "bald", {
    glasses: true,
  }),
  "norm-brown": reviewedResearcherPortrait("#d99a72", "#302823", "curly", {
    glasses: true,
    beard: true,
  }),
  "oriol-vinyalls": reviewedResearcherPortrait("#e9b994", "#302823", "curly", {
    glasses: true,
  }),
  "paul-christiani": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "paul-werbost": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "receding"),
  "percy-liange": reviewedResearcherPortrait("#d5a078", "#17191b", "short"),
  "peter-abell": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "prafull-dhariwal": reviewedResearcherPortrait("#9d6043", "#17191b", "short"),
  "pushmeet-kohly": reviewedResearcherPortrait("#9d6043", "#302823", "turban", {
    headwear: "#b43b32",
  }),
  "quoc-v-lee": reviewedResearcherPortrait("#d5a078", "#17191b", "short", {
    glasses: true,
  }),
  "raia-hadsall": reviewedResearcherPortrait("#e9b994", "#3153a4", "medium", {
    glasses: true,
  }),
  "rich-caruano": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
    beard: true,
  }),
  "rob-fergan": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    beard: true,
    beardStyle: "stubble",
  }),
  "rick-sutton": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "bald-long-sides", {
    glasses: true,
    beard: true,
    beardStyle: "long",
  }),
  "rob-schapire": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "receding", {
    glasses: true,
  }),
  "ross-girshall": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "ruslan-salakhudinov": reviewedResearcherPortrait("#e9b994", "#302823", "swept"),
  "sammy-benji": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "swept", {
    glasses: true,
  }),
  "sanja-fiedler": reviewedResearcherPortrait("#e9b994", "#cbb783", "long"),
  "sarah-hooker": reviewedResearcherPortrait("#e9b994", "#9b4b2e", "long"),
  "sepp-hochreitner": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "short", {
    glasses: true,
  }),
  "sergei-levinsky": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "shane-legge": reviewedResearcherPortrait("#e9b994", "#4f5050", "short"),
  "shauna-kravek": reviewedResearcherPortrait("#e9b994", "#b97855", "long", {
    glasses: true,
  }),
  "stephen-boyde": reviewedResearcherPortrait("#d99a72", "#aeb4b5", "very-short"),
  "stewart-russel": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "receding"),
  "terrence-sejnowsky": reviewedResearcherPortrait("#e9b994", "#4f5050", "swept", {
    glasses: true,
  }),
  "tim-rocktaschel": reviewedResearcherPortrait("#e9b994", "#8b8d89", "short", {
    beard: true,
    beardStyle: "short",
  }),
  "timothy-lillicroft": reviewedResearcherPortrait("#e9b994", "#302823", "tied-back", {
    beard: true,
    beardStyle: "goatee",
  }),
  "timo-brooks": reviewedResearcherPortrait("#e9b994", "#654936", "curly", {
    beard: true,
  }),
  "tomas-brown": reviewedResearcherPortrait("#e9b994", "#654936", "short", {
    beard: true,
  }),
  "tomas-mikoloff": reviewedResearcherPortrait("#e9b994", "#654936", "short"),
  "trevor-darnell": reviewedResearcherPortrait("#e9b994", "#4f5050", "swept"),
  "vladimir-mnich": reviewedResearcherPortrait("#e9b994", "#302823", "short"),
  "vladimir-vapnick": reviewedResearcherPortrait("#e9b994", "#aeb4b5", "receding"),
  "wojciech-zarembo": reviewedResearcherPortrait("#e9b994", "#654936", "very-short", {
    beard: true,
  }),
  "zico-kolder": reviewedResearcherPortrait("#e9b994", "#302823", "short", {
    beard: true,
  }),
  "zubin-ghahramani": reviewedResearcherPortrait("#d99a72", "#4f5050", "short"),
};

const SUBJECT_TRAITS: Readonly<Record<string, Partial<PortraitTraits>>> = {
  ...SPECIAL_SUBJECT_TRAITS,
  ...REVIEWED_RESEARCHER_TRAITS,
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], hash: number, shift: number): T {
  return values[(hash >>> shift) % values.length] as T;
}

function subjectSlug(subjectId: string, name: string): string {
  const candidate = subjectId.split(".").at(-1) ?? subjectId.split(":").at(-1) ?? name;
  return candidate
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function skinToneFromBrief(lowerBrief: string): string | undefined {
  if (/\bblack\b|\bafrican\b/.test(lowerBrief)) return "#69402f";
  if (/\bsouth asian\b|\bindian\b/.test(lowerBrief)) return "#9d6043";
  if (/\beast asian\b|\bchinese\b|\bjapanese\b|\bkorean\b/.test(lowerBrief))
    return "#d5a078";
  if (/\bwhite\b|\beuropean\b/.test(lowerBrief)) return "#e9b994";
  return undefined;
}

export function isPortraitSkinToneReferenceReviewed(
  subjectId: string,
  name: string,
  brief = "",
): boolean {
  const slug = subjectSlug(subjectId, name);
  return (
    SUBJECT_TRAITS[slug]?.skin !== undefined ||
    REFERENCE_REVIEWED_SKIN_TONES[slug] !== undefined ||
    skinToneFromBrief(brief.toLowerCase()) !== undefined
  );
}

export function isPortraitAppearanceReferenceReviewed(
  subjectId: string,
  name: string,
): boolean {
  return SUBJECT_TRAITS[subjectSlug(subjectId, name)]?.hairStyle !== undefined;
}

function traitsFor(subjectId: string, name: string, brief = ""): PortraitTraits {
  const hash = stableHash(`${subjectId}:${name}`);
  const lowerBrief = brief.toLowerCase();
  const slug = subjectSlug(subjectId, name);
  const subject = SUBJECT_TRAITS[slug];

  const skin =
    subject?.skin ??
    REFERENCE_REVIEWED_SKIN_TONES[slug] ??
    skinToneFromBrief(lowerBrief) ??
    pick(SKIN_TONES, hash, 0);

  let hair: string = pick(HAIR_COLOURS, hash, 4);
  if (/\bsilver\b|\bgrey\b|\bgray\b/.test(lowerBrief)) hair = "#aeb4b5";
  else if (/\bblond\b|\bblonde\b/.test(lowerBrief)) hair = "#cbb783";
  else if (/\bred hair\b|\bauburn\b/.test(lowerBrief)) hair = "#9b4b2e";
  else if (/\bblack hair\b/.test(lowerBrief)) hair = "#17191b";
  else if (/\bdark hair\b/.test(lowerBrief)) hair = "#302823";

  let headwear: string | undefined;
  if (/\bred turban\b/.test(lowerBrief)) headwear = "#b43b32";
  else if (/\bblue turban\b/.test(lowerBrief)) headwear = "#3153a4";

  let hairStyle = pick<HairStyle>(
    ["short", "swept", "curly", "long", "receding"],
    hash,
    8,
  );
  if (/\bbald\b|\bshaved\b/.test(lowerBrief)) hairStyle = "bald";
  else if (/\bturban\b/.test(lowerBrief)) hairStyle = "turban";
  else if (/\breceding\b/.test(lowerBrief)) hairStyle = "receding";
  else if (/\blong hair\b|\blong dark\b|\blong black\b/.test(lowerBrief))
    hairStyle = "long";
  else if (
    /\bmedium-length\b|\bmid-length\b|\bshoulder-length\b|\btied-back\b/.test(lowerBrief)
  )
    hairStyle = "medium";
  else if (/\bvery short\b|\bclosely cropped\b/.test(lowerBrief))
    hairStyle = "very-short";
  else if (/\bcurly\b|\bcoiled\b/.test(lowerBrief)) hairStyle = "curly";
  else if (/\bswept\b|\bwavy\b/.test(lowerBrief)) hairStyle = "swept";
  else if (/\bshort\b/.test(lowerBrief)) hairStyle = "short";
  else if (hairStyle === "receding" && /\bwom(?:an|en)\b|\bfemale\b/.test(lowerBrief))
    hairStyle = "short";
  else if (hairStyle === "long" && /\bman\b|\bmale\b/.test(lowerBrief))
    hairStyle = "short";

  let accent: string = pick(ACCENTS, hash, 12);
  if (lowerBrief.includes("violet") || lowerBrief.includes("purple")) accent = "#8f67e8";
  else if (lowerBrief.includes("orange")) accent = "#ff7a36";
  else if (lowerBrief.includes("green")) accent = "#42b96b";
  else if (lowerBrief.includes("blue")) accent = "#2d98e5";
  else if (lowerBrief.includes("pink")) accent = "#e46aaa";

  return {
    skin,
    hair: subject?.hair ?? hair,
    hairHighlight: subject?.hairHighlight,
    headwear: subject?.headwear ?? headwear,
    shirt: subject?.shirt ?? pick(SHIRT_COLOURS, hash, 16),
    backdrop: subject?.backdrop ?? pick(BACKDROPS, hash, 20),
    accent: subject?.accent ?? accent,
    hairStyle: subject?.hairStyle ?? hairStyle,
    glasses: subject?.glasses ?? /\bglasses\b|\bspectacles\b/.test(lowerBrief),
    beard:
      subject?.beard ??
      /\bbeard\b|\bfacial hair\b|\bgoatee\b|\bmoustache\b|\bmustache\b/.test(lowerBrief),
    beardStyle:
      subject?.beardStyle ??
      (/\blong (?:grey |gray )?beard\b/.test(lowerBrief) ? "long" : "short"),
  };
}

function Hair({
  style,
  colour,
  highlight,
}: {
  readonly style: HairStyle;
  readonly colour: string;
  readonly highlight: string | undefined;
}): ReactElement | null {
  if (style === "bald") {
    return null;
  }
  if (style === "bald-short-sides") {
    return (
      <g fill={colour}>
        <rect x="8" y="10" width="3" height="6" />
        <rect x="21" y="10" width="3" height="6" />
        <rect x="10" y="8" width="2" height="4" />
        <rect x="20" y="8" width="2" height="4" />
      </g>
    );
  }
  if (style === "bald-long-sides") {
    return (
      <g fill={colour}>
        <rect x="7" y="10" width="4" height="15" />
        <rect x="21" y="10" width="4" height="15" />
        <rect x="9" y="8" width="3" height="5" />
        <rect x="20" y="8" width="3" height="5" />
      </g>
    );
  }
  if (style === "long") {
    return (
      <g fill={colour}>
        <rect x="7" y="7" width="18" height="8" />
        <rect x="7" y="13" width="4" height="12" />
        <rect x="21" y="13" width="4" height="12" />
        <rect x="10" y="5" width="12" height="4" />
      </g>
    );
  }
  if (style === "medium") {
    return (
      <g fill={colour}>
        <rect x="7" y="7" width="18" height="7" />
        <rect x="7" y="12" width="4" height="8" />
        <rect x="21" y="12" width="4" height="8" />
        <rect x="10" y="5" width="12" height="4" />
      </g>
    );
  }
  if (style === "wavy-medium") {
    return (
      <g fill={colour}>
        <rect x="8" y="6" width="16" height="6" />
        <rect x="6" y="9" width="5" height="7" />
        <rect x="21" y="9" width="5" height="7" />
        <rect x="7" y="15" width="4" height="6" />
        <rect x="21" y="15" width="4" height="7" />
        <rect x="10" y="4" width="7" height="3" />
        <rect x="18" y="5" width="6" height="3" />
      </g>
    );
  }
  if (style === "tied-back") {
    return (
      <g fill={colour}>
        <rect x="8" y="7" width="16" height="5" />
        <rect x="10" y="5" width="14" height="3" />
        <rect x="8" y="10" width="3" height="6" />
        <rect x="22" y="9" width="4" height="5" />
        <rect x="24" y="13" width="4" height="6" />
        <rect x="25" y="18" width="3" height="5" />
      </g>
    );
  }
  if (style === "turban") {
    return (
      <>
        <g fill={colour}>
          <rect x="8" y="6" width="16" height="8" />
          <rect x="10" y="4" width="12" height="3" />
          <rect x="13" y="3" width="6" height="3" />
          <rect x="7" y="9" width="18" height="5" />
        </g>
        <g fill="#ffffff" opacity="0.18">
          <rect x="10" y="6" width="3" height="7" />
          <rect x="15" y="4" width="2" height="9" />
          <rect x="20" y="6" width="2" height="7" />
        </g>
      </>
    );
  }
  if (style === "curly") {
    return (
      <g fill={colour}>
        <rect x="8" y="6" width="16" height="5" />
        <rect x="6" y="8" width="5" height="7" />
        <rect x="21" y="8" width="5" height="7" />
        <rect x="10" y="4" width="4" height="3" />
        <rect x="17" y="4" width="5" height="3" />
      </g>
    );
  }
  if (style === "bushy") {
    return (
      <g fill={colour}>
        <rect x="10" y="4" width="12" height="3" />
        <rect x="8" y="6" width="16" height="5" />
        <rect x="6" y="8" width="4" height="4" />
        <rect x="22" y="8" width="4" height="4" />
      </g>
    );
  }
  if (style === "curly-receding") {
    return (
      <g fill={colour}>
        <rect x="10" y="6" width="5" height="5" />
        <rect x="17" y="6" width="5" height="5" />
        <rect x="14" y="4" width="4" height="5" />
        <rect x="7" y="9" width="5" height="7" />
        <rect x="20" y="9" width="5" height="7" />
      </g>
    );
  }
  if (style === "dense-curly-receding") {
    return (
      <>
        <g fill={colour}>
          <rect x="14" y="3" width="5" height="3" />
          <rect x="10" y="5" width="6" height="4" />
          <rect x="17" y="5" width="6" height="4" />
          <rect x="8" y="7" width="5" height="4" />
          <rect x="12" y="7" width="9" height="3" />
          <rect x="21" y="7" width="5" height="4" />
          <rect x="6" y="8" width="4" height="3" />
          <rect x="24" y="8" width="4" height="3" />
          <rect x="8" y="10" width="3" height="2" />
          <rect x="21" y="10" width="3" height="2" />
        </g>
        {highlight === undefined ? null : (
          <g fill={highlight}>
            <rect x="11" y="6" width="1" height="2" />
            <rect x="17" y="4" width="1" height="2" />
            <rect x="7" y="8" width="1" height="2" />
            <rect x="25" y="8" width="1" height="2" />
          </g>
        )}
      </>
    );
  }
  if (style === "swept") {
    return (
      <g fill={colour}>
        <rect x="8" y="7" width="16" height="5" />
        <rect x="10" y="5" width="14" height="3" />
        <rect x="20" y="4" width="5" height="3" />
        <rect x="8" y="10" width="3" height="5" />
      </g>
    );
  }
  if (style === "receding") {
    return (
      <g fill={colour}>
        <rect x="8" y="7" width="4" height="7" />
        <rect x="20" y="7" width="4" height="7" />
        <rect x="10" y="6" width="4" height="2" />
        <rect x="18" y="6" width="4" height="2" />
      </g>
    );
  }
  if (style === "very-short") {
    return (
      <g fill={colour}>
        <rect x="9" y="7" width="14" height="3" />
        <rect x="11" y="6" width="10" height="2" />
        <rect x="9" y="9" width="3" height="3" />
        <rect x="20" y="9" width="3" height="3" />
      </g>
    );
  }
  return (
    <g fill={colour}>
      <rect x="8" y="6" width="16" height="6" />
      <rect x="10" y="4" width="12" height="3" />
      <rect x="8" y="10" width="3" height="4" />
      <rect x="21" y="10" width="3" height="4" />
    </g>
  );
}

/**
 * Lightweight, data-driven portrait art. Researcher appearance briefs shape the
 * portrait while the stable subject hash keeps the full catalogue distinctive.
 */
export function PixelPortrait({
  subjectId,
  name,
  brief,
  altText,
  className,
}: PixelPortraitProps): ReactElement {
  const traits = traitsFor(subjectId, name, brief);
  return (
    <svg
      className={`character-pixel-portrait${className === undefined ? "" : ` ${className}`}`}
      viewBox="0 0 32 32"
      role="img"
      aria-label={altText ?? `Pixel-art portrait of ${name}`}
      shapeRendering="crispEdges"
    >
      <rect width="32" height="32" fill={traits.backdrop} />
      <g fill={traits.accent} opacity="0.9">
        <rect x="2" y="4" width="2" height="9" />
        <rect x="5" y="8" width="2" height="5" />
        <rect x="27" y="3" width="3" height="3" />
        <rect x="26" y="8" width="2" height="7" />
      </g>
      <rect x="13" y="22" width="6" height="5" fill={traits.skin} />
      <rect x="7" y="28" width="18" height="4" fill={traits.shirt} />
      <rect x="9" y="25" width="14" height="5" fill={traits.shirt} />
      <rect x="7" y="13" width="3" height="7" fill={traits.skin} />
      <rect x="22" y="13" width="3" height="7" fill={traits.skin} />
      <rect x="9" y="8" width="14" height="15" fill={traits.skin} />
      <Hair
        style={traits.hairStyle}
        colour={traits.headwear ?? traits.hair}
        highlight={traits.headwear === undefined ? traits.hairHighlight : undefined}
      />
      {traits.beard ? (
        <g fill={traits.hair}>
          {traits.beardStyle === "goatee" ? (
            <>
              <rect x="12" y="18" width="8" height="2" />
              <rect x="14" y="21" width="4" height="5" />
            </>
          ) : traits.beardStyle === "stubble" ? (
            <>
              <rect x="11" y="20" width="3" height="2" opacity="0.65" />
              <rect x="18" y="20" width="3" height="2" opacity="0.65" />
              <rect x="14" y="22" width="4" height="2" opacity="0.65" />
            </>
          ) : (
            <>
              <rect x="10" y="19" width="12" height="4" />
              <rect x="12" y="22" width="8" height="3" />
            </>
          )}
          {traits.beardStyle === "long" ? (
            <>
              <rect x="13" y="25" width="6" height="3" />
              <rect x="14" y="28" width="4" height="2" />
            </>
          ) : null}
        </g>
      ) : null}
      <rect x="12" y="14" width="2" height="2" fill="#20272a" />
      <rect x="18" y="14" width="2" height="2" fill="#20272a" />
      {traits.glasses ? (
        <g fill="none" stroke="#30383c" strokeWidth="1">
          <rect x="10" y="12" width="6" height="5" />
          <rect x="17" y="12" width="6" height="5" />
          <path d="M16 14h1" />
        </g>
      ) : null}
      <rect x="15" y="16" width="2" height="3" fill="#ad765e" />
      <rect
        x={traits.beard ? "14" : "13"}
        y="20"
        width={traits.beard ? "4" : "6"}
        height="1"
        fill={traits.beard ? "#ead5c1" : "#7d463d"}
      />
      <rect x="10" y="27" width="4" height="5" fill="#ffffff" opacity="0.2" />
    </svg>
  );
}
