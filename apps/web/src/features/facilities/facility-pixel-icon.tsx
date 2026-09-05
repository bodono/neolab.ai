import type { ReactElement } from "react";

interface FacilityPixelIconProps {
  readonly family: string;
  readonly displayName: string;
  readonly tier?: number;
  readonly variantId?: string;
}

interface FacilityPalette {
  readonly sky: string;
  readonly ground: string;
  readonly structure: string;
  readonly accent: string;
  readonly glow: string;
}

const INK = "#26353c";
const WINDOW = "#9dddec";

function palette(family: string): FacilityPalette {
  if (/leased-compute/.test(family)) {
    return {
      sky: "#d7e9f2",
      ground: "#586d78",
      structure: "#84a3b0",
      accent: "#2c9be3",
      glow: "#9fe5ff",
    };
  }
  if (/rented-office/.test(family)) {
    return {
      sky: "#f0e0d2",
      ground: "#7b6d61",
      structure: "#bbb0a7",
      accent: "#f17b3c",
      glow: "#ffcfaa",
    };
  }
  if (/power|fusion|orbital/.test(family)) {
    return {
      sky: "#e5ead0",
      ground: "#748169",
      structure: "#a7b58c",
      accent: "#f1bf45",
      glow: "#fff1a8",
    };
  }
  if (/alignment|interpretability|eval/.test(family)) {
    return {
      sky: "#e5ddf1",
      ground: "#716981",
      structure: "#aaa0ba",
      accent: "#946bd1",
      glow: "#dac8f5",
    };
  }
  if (/security|bunker/.test(family)) {
    return {
      sky: "#d9dedc",
      ground: "#5b6662",
      structure: "#87918d",
      accent: "#d95849",
      glow: "#ffc1b8",
    };
  }
  if (/robot|nano|boson/.test(family)) {
    return {
      sky: "#d8ece8",
      ground: "#557b75",
      structure: "#8eb8b0",
      accent: "#35a89b",
      glow: "#a6f0e5",
    };
  }
  if (/scientific|bio/.test(family)) {
    return {
      sky: "#e1eddd",
      ground: "#678064",
      structure: "#a7bea0",
      accent: "#5ca968",
      glow: "#bceec1",
    };
  }
  if (/hadron|time/.test(family)) {
    return {
      sky: "#e2def0",
      ground: "#65627b",
      structure: "#9993b1",
      accent: "#e168b2",
      glow: "#f8bde1",
    };
  }
  if (/collaboration/.test(family)) {
    return {
      sky: "#e5e2f2",
      ground: "#66647b",
      structure: "#aaa5c0",
      accent: "#726bd1",
      glow: "#c8e8ff",
    };
  }
  if (/public-engagement/.test(family)) {
    return {
      sky: "#f1e4d9",
      ground: "#7b6b5f",
      structure: "#c1aa98",
      accent: "#ed7842",
      glow: "#ffe1ae",
    };
  }
  if (/argus/.test(family)) {
    return {
      sky: "#dce3e4",
      ground: "#59676a",
      structure: "#8d9da0",
      accent: "#d84f55",
      glow: "#b9f3ff",
    };
  }
  if (/data|inference/.test(family)) {
    return {
      sky: "#d9e9f0",
      ground: "#526e79",
      structure: "#819ea9",
      accent: "#3299dc",
      glow: "#a8e4ff",
    };
  }
  return {
    sky: "#dde8e5",
    ground: "#69786e",
    structure: "#9fafaa",
    accent: "#ff823f",
    glow: "#ffd1af",
  };
}

function DataCentreGlyph({
  colours,
  tier,
  variantId,
}: {
  readonly colours: FacilityPalette;
  readonly tier: number;
  readonly variantId: string;
}): ReactElement {
  if (variantId.includes("parents-garage")) {
    return (
      <g>
        <rect x="7" y="29" width="50" height="25" fill={colours.structure} />
        <path d="M4 29l13-13h31l12 13z" fill={INK} />
        <rect x="13" y="34" width="27" height="20" fill="#6f7f84" />
        {[17, 24, 31].map((x) => (
          <rect key={x} x={x} y="38" width="5" height="3" fill={colours.glow} />
        ))}
        <rect x="45" y="35" width="7" height="19" fill={colours.accent} />
        <rect x="47" y="39" width="3" height="5" fill={WINDOW} />
        <path d="M40 47h5M52 47h8v-9h4" stroke={colours.glow} strokeWidth="2" />
        <rect x="11" y="51" width="31" height="3" fill={INK} />
      </g>
    );
  }
  if (variantId.includes("server-rack")) {
    return (
      <g>
        <rect x="21" y="10" width="22" height="44" fill={INK} />
        <rect x="24" y="14" width="16" height="7" fill={colours.structure} />
        {[25, 32, 39, 46].map((y) => (
          <g key={y}>
            <rect x="24" y={y} width="16" height="4" fill={colours.structure} />
            <rect x="26" y={y + 1} width="2" height="2" fill={colours.accent} />
            <rect x="30" y={y + 1} width="7" height="2" fill={colours.glow} />
          </g>
        ))}
        <rect x="18" y="53" width="28" height="2" fill={colours.accent} />
      </g>
    );
  }
  if (variantId.includes("server-hall")) {
    return (
      <g>
        <rect x="8" y="24" width="48" height="30" fill={colours.structure} />
        <path d="M6 24l8-9h36l8 9z" fill={INK} />
        {[13, 27, 41].map((x) => (
          <g key={x}>
            <rect x={x} y="29" width="10" height="20" fill={INK} />
            <rect x={x + 2} y="32" width="6" height="3" fill={WINDOW} />
            <rect x={x + 2} y="40" width="2" height="2" fill={colours.accent} />
          </g>
        ))}
        <path d="M15 12h34" stroke={colours.accent} strokeWidth="3" />
      </g>
    );
  }
  if (tier >= 5 || variantId.includes("data-centre-5")) {
    return (
      <g>
        <rect x="3" y="51" width="58" height="4" fill={INK} />
        <rect x="6" y="34" width="13" height="17" fill={colours.structure} />
        <rect x="45" y="34" width="13" height="17" fill={colours.structure} />
        <rect x="19" y="20" width="26" height="31" fill="#91aebb" />
        <path d="M17 21L32 5l15 16z" fill={INK} />
        <path d="M24 20l8-9 8 9z" fill={colours.accent} />
        <rect x="27" y="25" width="10" height="26" fill={INK} />
        {[28, 34, 40].map((y) => (
          <rect key={y} x="29" y={y} width="6" height="3" fill={colours.glow} />
        ))}
        {[9, 49].map((x) => (
          <g key={x}>
            <rect x={x} y="27" width="7" height="24" fill={INK} />
            <path d={`M${String(x - 2)} 27l5-9 6 9z`} fill={colours.accent} />
            <rect x={x + 2} y="31" width="3" height="13" fill={WINDOW} />
          </g>
        ))}
        <rect x="3" y="47" width="16" height="3" fill={colours.accent} />
        <rect x="45" y="47" width="16" height="3" fill={colours.accent} />
        <path
          d="M2 15h12M50 15h12M5 11v8M59 11v8"
          stroke={colours.glow}
          strokeWidth="2"
        />
      </g>
    );
  }
  if (tier === 4 || variantId.includes("data-centre-4")) {
    return (
      <g>
        <rect x="4" y="24" width="56" height="30" fill={colours.structure} />
        <rect x="8" y="17" width="48" height="8" fill={INK} />
        <rect x="13" y="12" width="38" height="5" fill={colours.accent} />
        {[9, 21, 33, 45].map((x) => (
          <g key={x}>
            <rect x={x} y="29" width="9" height="19" fill={INK} />
            <rect x={x + 2} y="32" width="5" height="8" fill={colours.glow} />
            <rect x={x + 2} y="44" width="2" height="2" fill={colours.accent} />
          </g>
        ))}
        <path d="M4 51h56M8 21h48" stroke={colours.accent} strokeWidth="3" />
        <path d="M10 9h9M45 9h9M14 6v6M50 6v6" stroke={INK} strokeWidth="2" />
      </g>
    );
  }
  if (tier === 3 || variantId.includes("data-centre-3")) {
    return (
      <g>
        {[4, 23, 42].map((x, index) => (
          <g key={x}>
            <rect
              x={x}
              y={25 - index * 3}
              width="18"
              height={29 + index * 3}
              fill={colours.structure}
            />
            <rect x={x + 3} y={30 - index * 3} width="12" height="14" fill={INK} />
            <rect x={x + 5} y={33 - index * 3} width="8" height="3" fill={colours.glow} />
            <rect x={x} y={22 - index * 3} width="18" height="4" fill={colours.accent} />
          </g>
        ))}
        <path d="M8 16h10l-2-8h-6zM46 10h10l-2-8h-6z" fill={INK} />
        <path d="M10 13h6M48 7h6" stroke={colours.glow} strokeWidth="2" />
      </g>
    );
  }
  if (tier === 2 || variantId.includes("data-centre-2")) {
    return (
      <g>
        <rect x="9" y="17" width="46" height="37" fill={colours.structure} />
        <rect x="9" y="13" width="46" height="6" fill={colours.accent} />
        {[15, 28, 41].map((x) => (
          <g key={x}>
            <rect x={x} y="22" width="9" height="12" fill={INK} />
            <rect x={x} y="38" width="9" height="11" fill={INK} />
            <rect x={x + 2} y="25" width="5" height="4" fill={WINDOW} />
            <rect x={x + 2} y="41" width="5" height="3" fill={colours.glow} />
          </g>
        ))}
        <path d="M14 9h36M18 6v7M46 6v7" stroke={INK} strokeWidth="2" />
      </g>
    );
  }
  return (
    <g>
      <rect x="8" y="23" width="48" height="31" fill={colours.structure} />
      <path d="M6 23l7-8h38l7 8z" fill={colours.accent} />
      {[13, 26, 39].map((x) => (
        <g key={x}>
          <rect x={x} y="28" width="10" height="21" fill={INK} />
          <rect x={x + 2} y="31" width="6" height="3" fill={WINDOW} />
          <rect x={x + 2} y="39" width="6" height="3" fill={colours.glow} />
          <rect x={x + 2} y="45" width="2" height="2" fill={colours.accent} />
        </g>
      ))}
    </g>
  );
}

function PowerAndCoolingGlyph({
  colours,
  tier,
}: {
  readonly colours: FacilityPalette;
  readonly tier: number;
}): ReactElement {
  if (tier >= 5) {
    return (
      <g>
        {[5, 23, 41].map((x, index) => (
          <g key={x}>
            <path
              d={`M${x} 51h18l-3-${String(25 + index * 3)}H${String(x + 3)}z`}
              fill={colours.structure}
            />
            <rect
              x={x + 4}
              y={29 - index * 3}
              width="10"
              height="3"
              fill={colours.glow}
            />
          </g>
        ))}
        <path d="M3 52h58M8 19h48M13 15v8M32 15v8M51 15v8" stroke={INK} strokeWidth="3" />
        <path d="M32 5l-7 13h6l-3 12 11-17h-6l4-8z" fill={colours.accent} />
      </g>
    );
  }
  if (tier === 4) {
    return (
      <g>
        <path d="M6 52h20l-4-34H10zM38 52h20l-4-34H42z" fill={colours.structure} />
        <path d="M25 52V29c0-10 14-10 14 0v23z" fill={INK} />
        <path d="M28 29c1-6 7-6 8 0z" fill={colours.glow} />
        <rect x="10" y="28" width="12" height="3" fill={colours.glow} />
        <rect x="42" y="28" width="12" height="3" fill={colours.glow} />
        <path d="M7 52h51" stroke={colours.accent} strokeWidth="3" />
      </g>
    );
  }
  if (tier === 3) {
    return (
      <g>
        <rect x="7" y="41" width="50" height="13" fill={colours.structure} />
        <path d="M12 41V18M52 41V18M18 24h28M16 31h32" stroke={INK} strokeWidth="3" />
        <path d="M12 18l-7 13h14zM52 18l-7 13h14z" fill={colours.accent} />
        <rect x="24" y="35" width="16" height="13" fill={INK} />
        <rect x="27" y="38" width="10" height="4" fill={colours.glow} />
      </g>
    );
  }
  if (tier === 2) {
    return (
      <g>
        <path d="M7 52h17l-3-27H11zM40 52h17l-3-27H44z" fill={colours.structure} />
        <rect x="25" y="34" width="14" height="20" fill={INK} />
        <rect x="28" y="38" width="8" height="5" fill={colours.glow} />
        <path d="M13 20h37M18 16v8M46 16v8" stroke={colours.accent} strokeWidth="3" />
      </g>
    );
  }
  return (
    <g>
      <path d="M10 52h16l-3-30H13z" fill={colours.structure} />
      <rect x="14" y="28" width="8" height="3" fill={colours.glow} />
      <rect x="35" y="32" width="20" height="22" fill={colours.structure} />
      <path d="M38 32V20h14v12M41 25h8" stroke={INK} strokeWidth="3" />
      <path d="M32 10l-8 15h7l-3 14 12-19h-7l5-10z" fill={colours.accent} />
      <rect x="8" y="52" width="48" height="3" fill={INK} />
    </g>
  );
}

function FacilityGlyph({
  family,
  colours,
  tier,
  variantId,
}: {
  readonly family: string;
  readonly colours: FacilityPalette;
  readonly tier: number;
  readonly variantId: string;
}): ReactElement {
  switch (family) {
    case "rented-office":
      return (
        <g>
          <rect x="10" y="21" width="44" height="33" fill={colours.structure} />
          <rect x="8" y="17" width="48" height="6" fill={INK} />
          <rect x="12" y="18" width="26" height="3" fill={colours.accent} />
          {[15, 27, 39].map((x) => (
            <g key={x}>
              <rect x={x} y="28" width="8" height="9" fill={INK} />
              <rect x={x + 2} y="30" width="4" height="5" fill={WINDOW} />
            </g>
          ))}
          <rect x="27" y="41" width="10" height="13" fill={INK} />
          <rect x="30" y="44" width="4" height="5" fill={colours.glow} />
          <path d="M46 8h3v9h-3zM49 8h7v3h-7z" fill={colours.accent} />
        </g>
      );
    case "leased-compute":
      return (
        <g>
          <rect x="7" y="19" width="50" height="35" fill={colours.structure} />
          <rect x="7" y="15" width="50" height="7" fill={colours.accent} />
          {[12, 27, 42].map((x) => (
            <g key={x}>
              <rect x={x} y="26" width="10" height="22" fill={INK} />
              <rect x={x + 2} y="29" width="6" height="4" fill={WINDOW} />
              <rect x={x + 2} y="36" width="6" height="2" fill={colours.glow} />
              <rect x={x + 2} y="43" width="2" height="2" fill="#76e38e" />
            </g>
          ))}
          <path d="M12 10h40" stroke={INK} strokeWidth="3" />
          <path d="M17 6v8M47 6v8" stroke={colours.accent} strokeWidth="3" />
        </g>
      );
    case "headquarters":
      return tier >= 2 ? (
        <g>
          <rect x="12" y="27" width="40" height="27" fill={colours.structure} />
          <rect x="21" y="9" width="22" height="45" fill="#b8c5c1" />
          <path d="M18 9h28M26 5h12v4" stroke={INK} strokeWidth="3" />
          {[15, 24, 33, 42].map((y) => (
            <g key={y} fill={WINDOW}>
              <rect x="25" y={y} width="5" height="4" />
              <rect x="34" y={y} width="5" height="4" />
            </g>
          ))}
          <rect x="29" y="46" width="7" height="8" fill={colours.accent} />
          <rect x="8" y="51" width="48" height="3" fill={INK} />
        </g>
      ) : (
        <g>
          <rect x="8" y="31" width="48" height="23" fill={colours.structure} />
          <path d="M6 31l13-12h26l13 12z" fill="#b8c5c1" />
          <rect x="30" y="13" width="4" height="7" fill={INK} />
          {[14, 27, 40].map((x) => (
            <g key={x} fill={WINDOW}>
              <rect x={x} y="35" width="8" height="7" />
            </g>
          ))}
          <rect x="29" y="43" width="7" height="11" fill={colours.accent} />
        </g>
      );
    case "power-and-cooling":
      return <PowerAndCoolingGlyph colours={colours} tier={tier} />;
    case "data-centre":
      return <DataCentreGlyph colours={colours} tier={tier} variantId={variantId} />;
    case "research-campus":
      return (
        <g>
          <rect x="7" y="30" width="50" height="24" fill={colours.structure} />
          <rect x="12" y="24" width="40" height="7" fill="#c5cecb" />
          <rect x="13" y="35" width="9" height="8" fill={WINDOW} />
          <rect x="27" y="35" width="9" height="8" fill={WINDOW} />
          <rect x="42" y="35" width="9" height="8" fill={WINDOW} />
          <rect x="29" y="46" width="7" height="8" fill={INK} />
          <path d="M22 14h20l5 10H17z" fill={colours.accent} />
          <rect x="29" y="8" width="6" height="7" fill={colours.glow} />
        </g>
      );
    case "inference-centre":
      return tier >= 3 ? (
        <g>
          {[5, 23, 41].map((x, index) => (
            <g key={x}>
              <rect
                x={x}
                y={22 - index * 4}
                width="18"
                height={32 + index * 4}
                fill={colours.structure}
              />
              <rect
                x={x + 4}
                y={27 - index * 4}
                width="10"
                height={20 + index * 3}
                fill={INK}
              />
              <rect
                x={x + 7}
                y={30 - index * 4}
                width="4"
                height={12 + index * 2}
                fill={WINDOW}
              />
            </g>
          ))}
          <path d="M5 17h45v-5l10 9-10 9v-5H5z" fill={colours.accent} opacity="0.9" />
        </g>
      ) : tier === 2 ? (
        <g>
          <rect x="7" y="21" width="42" height="33" fill={colours.structure} />
          {[13, 24, 35].map((x) => (
            <g key={x}>
              <rect x={x} y="27" width="7" height="21" fill={INK} />
              <rect x={x + 2} y="30" width="3" height="13" fill={WINDOW} />
            </g>
          ))}
          <path d="M48 23h7v-6l8 10-8 10v-6h-7z" fill={colours.accent} />
          <rect x="48" y="43" width="12" height="5" fill={colours.glow} />
          <path d="M11 17h35" stroke={colours.accent} strokeWidth="3" />
        </g>
      ) : (
        <g>
          <rect x="7" y="18" width="35" height="36" fill={colours.structure} />
          {[13, 23, 33].map((x) => (
            <g key={x}>
              <rect x={x} y="24" width="6" height="23" fill={INK} />
              <rect x={x + 2} y="27" width="2" height="12" fill={WINDOW} />
            </g>
          ))}
          <path d="M44 27h9v-6l7 10-7 10v-6h-9z" fill={colours.accent} />
          <rect x="44" y="45" width="14" height="4" fill={colours.glow} />
        </g>
      );
    case "alignment-institute":
      return (
        <g>
          <rect x="10" y="28" width="44" height="26" fill={colours.structure} />
          <path d="M8 28l24-15 24 15z" fill={INK} />
          <rect x="29" y="9" width="6" height="9" fill={colours.accent} />
          <rect x="17" y="34" width="7" height="13" fill={colours.glow} />
          <rect x="40" y="34" width="7" height="13" fill={colours.glow} />
          <rect x="29" y="34" width="6" height="20" fill={INK} />
          <rect x="14" y="50" width="36" height="4" fill={colours.accent} />
        </g>
      );
    case "interpretability-lab":
      return (
        <g>
          <rect x="8" y="22" width="40" height="32" fill={colours.structure} />
          <rect x="13" y="28" width="25" height="18" fill="#22353e" />
          <rect x="17" y="32" width="4" height="4" fill={WINDOW} />
          <rect x="29" y="32" width="4" height="4" fill={colours.accent} />
          <path d="M21 34h8M19 40l8-4 6 5" stroke={colours.glow} strokeWidth="2" />
          <path
            d="M42 18h10v10H42zM49 27l9 10"
            fill="none"
            stroke={INK}
            strokeWidth="4"
          />
        </g>
      );
    case "eval-range":
      return (
        <g>
          <rect x="7" y="43" width="50" height="11" fill={colours.structure} />
          <path
            d="M32 10h8v4h5v5h4v8h-4v5h-5v4h-8v-4h-5v-5h-4v-8h4v-5h5z"
            fill={colours.accent}
          />
          <rect x="32" y="18" width="8" height="10" fill={colours.glow} />
          <rect x="35" y="21" width="2" height="4" fill={INK} />
          <path d="M14 43V29h7v14M48 43V33h6v10" stroke={INK} strokeWidth="3" />
        </g>
      );
    case "security-operations":
      return (
        <g>
          <rect x="9" y="24" width="46" height="30" fill={colours.structure} />
          <rect x="14" y="29" width="16" height="13" fill="#1f3037" />
          <rect x="17" y="32" width="10" height="3" fill={WINDOW} />
          <rect x="34" y="29" width="16" height="13" fill="#1f3037" />
          <rect x="37" y="32" width="10" height="3" fill={colours.glow} />
          <path
            d="M32 7l12 5v9c0 8-5 12-12 15-7-3-12-7-12-15v-9z"
            fill={colours.accent}
          />
          <rect x="29" y="14" width="6" height="11" fill={INK} />
        </g>
      );
    case "robotics-lab":
      return (
        <g>
          <rect x="7" y="45" width="50" height="9" fill={colours.structure} />
          <rect x="12" y="39" width="13" height="7" fill={INK} />
          <rect x="17" y="27" width="7" height="14" fill={colours.accent} />
          <rect x="21" y="22" width="18" height="7" fill={colours.accent} />
          <rect x="35" y="17" width="7" height="11" fill={INK} />
          <path d="M39 15l8-6 3 4-7 7z" fill={colours.glow} />
          <rect x="45" y="10" width="9" height="4" fill={INK} />
          <rect x="46" y="34" width="8" height="8" fill={WINDOW} />
        </g>
      );
    case "scientific-laboratory":
      return (
        <g>
          <rect x="8" y="34" width="48" height="20" fill={colours.structure} />
          <path
            d="M23 9h18v5h-4v13l10 19H17l10-19V14h-4z"
            fill="#e8f0e5"
            stroke={INK}
            strokeWidth="3"
          />
          <path d="M22 38h20l5 8H17z" fill={colours.accent} />
          <rect x="27" y="22" width="10" height="4" fill={colours.glow} />
          <rect x="12" y="40" width="6" height="8" fill={WINDOW} />
          <rect x="46" y="40" width="6" height="8" fill={WINDOW} />
        </g>
      );
    case "secure-bunker":
      return (
        <g>
          <path
            d="M7 54V35l10-14h30l10 14v19z"
            fill={colours.structure}
            stroke={INK}
            strokeWidth="3"
          />
          <rect x="23" y="29" width="20" height="25" fill="#46514f" />
          <rect x="27" y="33" width="12" height="17" fill="#7f8b87" />
          <rect x="36" y="40" width="3" height="3" fill={colours.accent} />
          <rect x="12" y="31" width="7" height="4" fill={colours.glow} />
          <rect x="45" y="31" width="7" height="4" fill={colours.glow} />
        </g>
      );
    case "staff-commons":
      return (
        <g>
          <rect x="7" y="34" width="50" height="20" fill={colours.structure} />
          <rect x="11" y="39" width="12" height="9" fill={WINDOW} />
          <rect x="42" y="39" width="11" height="9" fill={WINDOW} />
          <rect x="29" y="35" width="7" height="19" fill={INK} />
          <rect x="28" y="17" width="9" height="18" fill="#72513b" />
          <path d="M18 20h11v-8h8v7h10v10H18z" fill="#63a765" />
          <rect x="12" y="50" width="13" height="3" fill={colours.accent} />
          <rect x="40" y="50" width="13" height="3" fill={colours.accent} />
        </g>
      );
    case "collaboration":
      if (variantId.includes("embedding-space")) {
        return (
          <g>
            <rect x="7" y="33" width="22" height="21" fill={colours.structure} />
            <rect x="35" y="24" width="22" height="30" fill={colours.structure} />
            <path d="M18 33l17-9M29 43h12" stroke={colours.accent} strokeWidth="4" />
            {[12, 21, 40, 49].map((x, index) => (
              <rect
                key={x}
                x={x}
                y={index < 2 ? 39 : 31}
                width="6"
                height="7"
                fill={index % 2 === 0 ? WINDOW : colours.glow}
              />
            ))}
            <path
              d="M9 27l8-8 8 8M37 18l8-8 8 8"
              fill="none"
              stroke={INK}
              strokeWidth="3"
            />
          </g>
        );
      }
      if (variantId.includes("cross-attention")) {
        return (
          <g>
            <rect x="7" y="32" width="50" height="22" fill={colours.structure} />
            <rect x="23" y="17" width="18" height="37" fill="#bcb7ce" />
            <path d="M5 32h18V15h18v17h18" fill="none" stroke={INK} strokeWidth="4" />
            <rect x="28" y="23" width="8" height="10" fill={colours.glow} />
            <path
              d="M11 39h12M41 39h12M32 9v9M27 13h10"
              stroke={colours.accent}
              strokeWidth="3"
            />
            <rect x="28" y="42" width="8" height="12" fill={INK} />
          </g>
        );
      }
      return (
        <g>
          {[9, 23, 37].map((x, index) => (
            <g key={x}>
              <rect
                x={x}
                y={18 + index * 5}
                width="18"
                height={36 - index * 5}
                fill={colours.structure}
              />
              <rect
                x={x + 3}
                y={23 + index * 5}
                width="12"
                height={22 - index * 3}
                fill={INK}
              />
              <rect
                x={x + 5}
                y={27 + index * 5}
                width="8"
                height="4"
                fill={colours.glow}
              />
            </g>
          ))}
          <path d="M7 14h43l7 7" fill="none" stroke={colours.accent} strokeWidth="3" />
          <rect x="6" y="11" width="5" height="7" fill={colours.accent} />
          <rect x="53" y="18" width="5" height="7" fill={colours.accent} />
        </g>
      );
    case "public-engagement":
      if (variantId.includes("press-office")) {
        return (
          <g>
            <rect x="8" y="30" width="48" height="24" fill={colours.structure} />
            <rect x="13" y="36" width="14" height="10" fill={WINDOW} />
            <rect x="39" y="36" width="12" height="18" fill={INK} />
            <path
              d="M31 34V16M31 16l11-6v12z"
              fill={colours.accent}
              stroke={INK}
              strokeWidth="2"
            />
            <path
              d="M15 25c7-8 16-8 23 0M18 28c5-5 11-5 17 0"
              fill="none"
              stroke={colours.glow}
              strokeWidth="2"
            />
          </g>
        );
      }
      if (variantId.includes("visitor-centre")) {
        return (
          <g>
            <rect x="6" y="34" width="52" height="20" fill={colours.structure} />
            <path d="M4 34l28-17 28 17z" fill={INK} />
            <rect x="14" y="37" width="12" height="11" fill={WINDOW} />
            <rect x="38" y="37" width="12" height="11" fill={WINDOW} />
            <rect x="29" y="34" width="7" height="20" fill={colours.accent} />
            <path d="M20 14h24M24 10v8M40 10v8" stroke={colours.glow} strokeWidth="3" />
          </g>
        );
      }
      return (
        <g>
          <path d="M8 51h48L49 29H15z" fill={colours.structure} />
          <path
            d="M15 29C17 8 47 8 49 29z"
            fill={colours.glow}
            stroke={INK}
            strokeWidth="3"
          />
          <path d="M22 29c1-11 19-11 20 0z" fill={colours.accent} />
          <rect x="27" y="34" width="10" height="17" fill={INK} />
          <path
            d="M5 52h54M12 46h40M32 7V2M19 11l-3-5M45 11l3-5"
            stroke={colours.accent}
            strokeWidth="3"
          />
        </g>
      );
    case "argus-array":
      return (
        <g>
          {[7, 26, 45].map((x, index) => (
            <g key={x}>
              <path
                d={`M${String(x)} ${String(22 + index * 4)}h15c-1 8-6 13-15 14z`}
                fill={colours.structure}
                stroke={INK}
                strokeWidth="2"
              />
              <path
                d={`M${String(x + 8)} ${String(34 + index * 4)}v${String(14 - index * 2)}`}
                stroke={INK}
                strokeWidth="3"
              />
              <rect
                x={x + 3}
                y={20 + index * 4}
                width="4"
                height="4"
                fill={colours.accent}
              />
            </g>
          ))}
          <rect x="4" y="50" width="56" height="4" fill={colours.structure} />
          <path d="M2 14h60M8 9v10M56 9v10" stroke={colours.glow} strokeWidth="2" />
          <rect x="29" y="7" width="6" height="12" fill={colours.accent} />
        </g>
      );
    case "fusion-reactor-array":
      return (
        <g>
          <path
            d="M8 50h48L49 25H15z"
            fill={colours.structure}
            stroke={INK}
            strokeWidth="3"
          />
          <path
            d="M18 25c2-12 8-17 14-17s12 5 14 17z"
            fill={colours.glow}
            stroke={INK}
            strokeWidth="3"
          />
          <rect x="20" y="34" width="24" height="8" fill={INK} />
          <rect x="24" y="36" width="16" height="4" fill={colours.accent} />
          <path d="M32 11l-4 8h4l-2 7 7-10h-4l3-5z" fill={colours.accent} />
        </g>
      );
    case "hadron-collider":
      return (
        <g>
          <path
            d="M12 20h7v-6h26v6h7v7h6v19h-6v7h-7v5H19v-5h-7v-7H6V27h6zm9 5v21h22V25z"
            fill={colours.structure}
          />
          <path
            d="M18 20h28v7h7v19h-7v7H18v-7h-7V27h7z"
            fill="none"
            stroke={INK}
            strokeWidth="3"
          />
          <rect x="28" y="31" width="8" height="8" fill={colours.glow} />
          <rect x="31" y="26" width="2" height="18" fill={colours.accent} />
          <rect x="24" y="34" width="18" height="2" fill={colours.accent} />
        </g>
      );
    case "boson-factory":
      return (
        <g>
          <path d="M7 54V27l13 7V25l14 8V22l23 12v20z" fill={colours.structure} />
          <rect x="12" y="39" width="8" height="9" fill={WINDOW} />
          <rect x="25" y="39" width="8" height="9" fill={WINDOW} />
          <rect x="39" y="39" width="12" height="15" fill={INK} />
          <path d="M10 18h37" stroke={colours.accent} strokeWidth="3" />
          <rect x="15" y="14" width="5" height="8" fill={colours.glow} />
          <rect x="29" y="14" width="5" height="8" fill={colours.glow} />
          <rect x="43" y="14" width="5" height="8" fill={colours.glow} />
        </g>
      );
    case "time-sphere":
      return (
        <g>
          <path
            d="M26 8h12v4h7v6h6v8h5v12h-5v8h-6v6h-7v4H26v-4h-7v-6h-6v-8H8V26h5v-8h6v-6h7z"
            fill={colours.structure}
          />
          <path
            d="M28 15h8v4h6v6h4v14h-4v6h-6v4h-8v-4h-6v-6h-4V25h4v-6h6z"
            fill="#27333c"
          />
          <rect x="30" y="22" width="4" height="13" fill={colours.glow} />
          <rect x="32" y="32" width="10" height="4" fill={colours.accent} />
          <rect x="30" y="32" width="6" height="6" fill={colours.accent} />
        </g>
      );
    case "biofoundry":
      return (
        <g>
          <rect x="8" y="28" width="48" height="26" fill={colours.structure} />
          <rect x="13" y="34" width="13" height="14" fill={WINDOW} />
          <rect x="39" y="34" width="12" height="20" fill={INK} />
          <path
            d="M28 8h9v6h-2v12l7 13H23l7-13V14h-2z"
            fill={colours.glow}
            stroke={INK}
            strokeWidth="2"
          />
          <path d="M27 32h11l4 7H23z" fill={colours.accent} />
          <path d="M14 18c8-8 13-1 13 6-8 2-13-1-13-6z" fill="#65ad6b" />
        </g>
      );
    case "nanofoundry":
      return (
        <g>
          <rect x="13" y="13" width="38" height="38" fill={INK} />
          <rect x="18" y="18" width="28" height="28" fill={colours.structure} />
          <rect x="23" y="23" width="18" height="18" fill="#263a40" />
          <rect x="27" y="27" width="10" height="10" fill={colours.glow} />
          <rect x="30" y="30" width="4" height="4" fill={colours.accent} />
          {[18, 27, 36, 45].map((value) => (
            <g key={value} fill={colours.accent}>
              <rect x={value} y="8" width="3" height="5" />
              <rect x={value} y="51" width="3" height="5" />
              <rect x="8" y={value} width="5" height="3" />
              <rect x="51" y={value} width="5" height="3" />
            </g>
          ))}
        </g>
      );
    case "orbital-solar-relay":
      return (
        <g>
          <path
            d="M10 46h30V22c-17 1-27 8-30 24z"
            fill={colours.structure}
            stroke={INK}
            strokeWidth="3"
          />
          <path d="M13 42l24-17M20 46l20-13" stroke={colours.glow} strokeWidth="2" />
          <rect x="30" y="43" width="5" height="11" fill={INK} />
          <rect x="22" y="52" width="21" height="3" fill={INK} />
          <path
            d="M43 12h11v11H43zM39 16h4M54 16h5M48 7v5M48 23v5"
            fill={colours.accent}
            stroke={colours.accent}
            strokeWidth="2"
          />
        </g>
      );
    default:
      return (
        <g>
          <rect x="10" y="23" width="44" height="31" fill={colours.structure} />
          <path d="M7 23l25-13 25 13z" fill={colours.accent} />
          <rect x="16" y="30" width="8" height="9" fill={WINDOW} />
          <rect x="40" y="30" width="8" height="9" fill={WINDOW} />
          <rect x="29" y="39" width="7" height="15" fill={INK} />
        </g>
      );
  }
}

export function FacilityPixelIcon({
  family,
  displayName,
  tier = 1,
  variantId = displayName,
}: FacilityPixelIconProps): ReactElement {
  const colours = palette(family);
  return (
    <svg
      className={`facility-icon facility-icon-${family}`}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Pixel-art illustration of ${displayName}`}
      shapeRendering="crispEdges"
    >
      <rect width="64" height="64" fill={colours.sky} />
      <path
        d="M0 10h10v2h8v-2h10M43 15h8v-3h13"
        stroke={colours.glow}
        strokeWidth="2"
        opacity="0.7"
      />
      <rect y="54" width="64" height="10" fill={colours.ground} />
      <g className="facility-glyph" data-facility-variant={variantId}>
        <FacilityGlyph
          family={family}
          colours={colours}
          tier={tier}
          variantId={variantId}
        />
      </g>
      <rect y="59" width="64" height="5" fill={INK} opacity="0.55" />
    </svg>
  );
}
