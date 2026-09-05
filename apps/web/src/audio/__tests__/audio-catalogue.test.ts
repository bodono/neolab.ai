import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALL_AUDIO_ASSETS,
  CUE_ASSETS,
  MUSIC_ASSETS,
  preferredAudioUrl,
} from "../audio-catalogue.ts";
import { AUDIO_CUE_IDS, MUSIC_TRACK_IDS } from "../audio-types.ts";

const soundtrackRoot = resolve(process.cwd(), "soundtrack");
const manifest = readFileSync(resolve(soundtrackRoot, "track-manifest.yaml"), "utf8");

function manifestIds(section: "tracks" | "eventCues"): readonly string[] {
  const start = manifest.indexOf(`${section}:`);
  const end =
    section === "tracks"
      ? manifest.indexOf("eventCues:", start)
      : manifest.indexOf("provenance:", start);
  // Retired tracks stay in the manifest and on disk for audition reference,
  // but the game bundle no longer carries them.
  return manifest
    .slice(start, end)
    .split(/\n  - /)
    .slice(1)
    .filter((entry) => !entry.includes("state: retired-reference"))
    .map((entry) => /(?:\{ )?id: ([a-z0-9-]+)/.exec(entry)![1]!);
}

function filesBelow(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("audio catalogue", () => {
  it("prefers Opus when supported and retains AAC fallback", () => {
    const urls = { opus: "/music.opus", aac: "/music.m4a" };
    expect(preferredAudioUrl(urls, () => "probably")).toBe("/music.opus");
    expect(preferredAudioUrl(urls, () => "")).toBe("/music.m4a");
  });

  it("matches every manifest track and event cue exactly", () => {
    expect(Object.keys(MUSIC_ASSETS)).toEqual(manifestIds("tracks"));
    expect(Object.keys(CUE_ASSETS)).toEqual(manifestIds("eventCues"));
    expect(MUSIC_TRACK_IDS).toHaveLength(27);
    expect(AUDIO_CUE_IDS).toHaveLength(20);
    expect(ALL_AUDIO_ASSETS).toHaveLength(MUSIC_TRACK_IDS.length + AUDIO_CUE_IDS.length);
  });

  it("ships every listening asset and loops everything except the extinction ending", () => {
    // 54 on disk (34 tracks + 20 cues); the seven retired tracks stay for
    // audition.html but only 47 are bundled into the game.
    const assets = filesBelow(soundtrackRoot).filter((path) => path.endsWith(".m4a"));
    expect(assets).toHaveLength(54);
    for (const asset of assets) expect(existsSync(asset)).toBe(true);
    expect(
      Object.values(MUSIC_ASSETS)
        .filter((track) => !track.loop)
        .map((track) => track.id),
    ).toEqual(["nothing-left-to-read"]);
  });

  it("keeps Web Audio and audio filenames outside the deterministic simulation", () => {
    const simulationSource = filesBelow(resolve(process.cwd(), "packages/sim/src"))
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(simulationSource).not.toMatch(/AudioContext|\.m4a|\.mp3|\.opus/);
  });
});
