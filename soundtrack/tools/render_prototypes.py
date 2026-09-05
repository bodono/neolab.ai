#!/usr/bin/env python3
"""Deterministically compose and render the Neolab.ai soundtrack prototypes.

The renderer intentionally uses a small synthetic palette instead of samples. It is a musical
sketchbook, not a production synthesiser, but every note and sound can be regenerated from source.
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np


SAMPLE_RATE = 24_000
CHANNELS = 2
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "prototypes"
DEFAULT_EVENT_OUTPUT = ROOT / "events"


NOTE_OFFSETS = {
    "C": 0,
    "C#": 1,
    "DB": 1,
    "D": 2,
    "D#": 3,
    "EB": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "GB": 6,
    "G": 7,
    "G#": 8,
    "AB": 8,
    "A": 9,
    "A#": 10,
    "BB": 10,
    "B": 11,
}


def midi(note: str | int) -> int:
    if isinstance(note, int):
        return note
    name = note[:-1].upper()
    octave = int(note[-1])
    return 12 * (octave + 1) + NOTE_OFFSETS[name]


def frequency(note: str | int) -> float:
    return 440.0 * 2.0 ** ((midi(note) - 69) / 12.0)


def equal_power_pan(pan: float) -> tuple[float, float]:
    position = (max(-1.0, min(1.0, pan)) + 1.0) * math.pi / 4.0
    return math.cos(position), math.sin(position)


@dataclass(frozen=True)
class TrackSpec:
    id: str
    number: int
    title: str
    bpm: float
    bars: int
    composer: Callable[["Song"], None]
    loop: bool = True
    target_peak: float = 0.76

    @property
    def filename(self) -> str:
        return f"{self.number:02d}-{self.id}"


@dataclass(frozen=True)
class EventSpec:
    id: str
    number: int
    title: str
    role: str
    bpm: float
    bars: int
    chord: tuple[str, ...]
    bass: str
    melody: tuple[str | None, ...]
    gesture: str = "neutral"
    target_peak: float = 0.58

    @property
    def filename(self) -> str:
        return f"event-{self.number:02d}-{self.id}"


class Song:
    def __init__(self, bpm: float, bars: int, seed: int) -> None:
        self.bpm = bpm
        self.bars = bars
        self.beat_seconds = 60.0 / bpm
        self.total_beats = bars * 4.0
        self.duration_seconds = self.total_beats * self.beat_seconds
        self.frames = round(self.duration_seconds * SAMPLE_RATE)
        self.audio = np.zeros((self.frames, CHANNELS), dtype=np.float64)
        self.delay_send = np.zeros_like(self.audio)
        self.rng = np.random.default_rng(seed)

    def beat_to_frame(self, beat: float) -> int:
        return round(beat * self.beat_seconds * SAMPLE_RATE)

    def oscillator(
        self,
        waveform: str,
        hz: float,
        seconds: float,
        *,
        duty: float = 0.25,
        vibrato_depth: float = 0.0,
        vibrato_rate: float = 5.0,
    ) -> np.ndarray:
        count = max(1, round(seconds * SAMPLE_RATE))
        time = np.arange(count, dtype=np.float64) / SAMPLE_RATE
        instant_hz = hz * (1.0 + vibrato_depth * np.sin(2.0 * np.pi * vibrato_rate * time))
        phase = 2.0 * np.pi * np.cumsum(instant_hz) / SAMPLE_RATE

        if waveform == "sine":
            signal = np.sin(phase)
        elif waveform == "triangle":
            signal = 2.0 / np.pi * np.arcsin(np.sin(phase))
        elif waveform == "warm-lead":
            # A smooth, band-limited foreground voice. The earlier shared motif used raw pulse
            # waves (and occasionally a quantised chip voice), whose discontinuous edges created
            # strong aliased highs and made the melody feel much louder than its measured level.
            signal = (
                0.78 * np.sin(phase)
                + 0.16 * np.sin(2.0 * phase + 0.16)
                + 0.06 * np.sin(3.0 * phase + 0.38)
            )
        elif waveform == "rounded-pluck":
            # A restrained background voice: enough harmonic shape to feel electronic, but no
            # pulse edge or quantisation fuzz competing with the foreground melody.
            signal = (
                0.80 * np.sin(phase)
                + 0.14 * np.sin(2.0 * phase + 0.10)
                + 0.06 * np.sin(3.0 * phase + 0.26)
            )
        elif waveform == "bell":
            signal = (
                np.sin(phase)
                + 0.46 * np.sin(2.01 * phase + 0.3)
                + 0.20 * np.sin(3.98 * phase + 0.8)
            ) / 1.66
        elif waveform == "soft-pad":
            signal = (
                0.62 * np.sin(phase)
                + 0.25 * (2.0 / np.pi * np.arcsin(np.sin(phase * 0.501)))
                + 0.13 * np.sin(phase * 2.002)
            )
        else:
            raise ValueError(f"Unknown waveform: {waveform}")
        return signal

    @staticmethod
    def envelope(
        count: int,
        *,
        attack: float,
        decay: float,
        sustain: float,
        release: float,
    ) -> np.ndarray:
        envelope = np.full(count, sustain, dtype=np.float64)
        attack_n = min(count, max(1, round(attack * SAMPLE_RATE)))
        decay_n = min(count - attack_n, max(0, round(decay * SAMPLE_RATE)))
        release_n = min(count, max(1, round(release * SAMPLE_RATE)))
        envelope[:attack_n] = np.linspace(0.0, 1.0, attack_n, endpoint=False)
        if decay_n:
            envelope[attack_n : attack_n + decay_n] = np.linspace(
                1.0, sustain, decay_n, endpoint=False
            )
        release_start = count - release_n
        envelope[release_start:] *= np.linspace(1.0, 0.0, release_n)
        return envelope

    def mix_mono(
        self,
        signal: np.ndarray,
        start_beat: float,
        *,
        amplitude: float,
        pan: float,
        delay_send: float = 0.0,
    ) -> None:
        start = self.beat_to_frame(start_beat)
        if start >= self.frames:
            return
        usable = min(signal.shape[0], self.frames - start)
        left, right = equal_power_pan(pan)
        stereo = signal[:usable, None] * np.array([left, right]) * amplitude
        self.audio[start : start + usable] += stereo
        if delay_send:
            self.delay_send[start : start + usable] += stereo * delay_send

    def note(
        self,
        pitch: str | int,
        start_beat: float,
        duration_beats: float,
        *,
        waveform: str = "rounded-pluck",
        amplitude: float = 0.10,
        pan: float = 0.0,
        attack: float = 0.014,
        decay: float = 0.035,
        sustain: float = 0.72,
        release: float = 0.075,
        duty: float = 0.25,
        vibrato_depth: float = 0.0,
        vibrato_rate: float = 5.0,
        delay_send: float = 0.0,
    ) -> None:
        seconds = duration_beats * self.beat_seconds
        signal = self.oscillator(
            waveform,
            frequency(pitch),
            seconds,
            duty=duty,
            vibrato_depth=vibrato_depth,
            vibrato_rate=vibrato_rate,
        )
        env = self.envelope(
            signal.shape[0], attack=attack, decay=decay, sustain=sustain, release=release
        )
        self.mix_mono(
            signal * env,
            start_beat,
            amplitude=amplitude,
            pan=pan,
            delay_send=delay_send,
        )

    def chord(
        self,
        pitches: Iterable[str | int],
        start_beat: float,
        duration_beats: float,
        *,
        waveform: str = "soft-pad",
        amplitude: float = 0.055,
        width: float = 0.55,
        attack: float = 0.10,
        release: float = 0.20,
    ) -> None:
        pitches = list(pitches)
        for index, pitch in enumerate(pitches):
            pan = 0.0 if len(pitches) == 1 else -width + 2.0 * width * index / (len(pitches) - 1)
            self.note(
                pitch,
                start_beat,
                duration_beats,
                waveform=waveform,
                amplitude=amplitude / math.sqrt(len(pitches)),
                pan=pan,
                attack=attack,
                decay=0.12,
                sustain=0.82,
                release=release,
            )

    def kick(self, start_beat: float, amplitude: float = 0.34) -> None:
        seconds = 0.34
        count = round(seconds * SAMPLE_RATE)
        time = np.arange(count) / SAMPLE_RATE
        hz = 44.0 + 72.0 * np.exp(-time * 16.0)
        phase = 2.0 * np.pi * np.cumsum(hz) / SAMPLE_RATE
        attack = 1.0 - np.exp(-time * 520.0)
        body = (
            np.sin(phase) + 0.10 * np.sin(2.0 * phase + 0.15) * np.exp(-time * 11.0)
        ) * attack * np.exp(-time * 11.5)
        self.mix_mono(body, start_beat, amplitude=amplitude * 0.58, pan=0.0)

    def snare(self, start_beat: float, amplitude: float = 0.19, pan: float = 0.0) -> None:
        seconds = 0.27
        count = round(seconds * SAMPLE_RATE)
        time = np.arange(count) / SAMPLE_RATE
        noise = self.rng.normal(0.0, 1.0, count)
        # A low-passed brush behind a pitched tap, avoiding a conventional bright snare crack.
        warm_noise = np.convolve(noise, np.ones(17) / 17.0, mode="same")
        warm_noise /= max(1e-9, float(np.std(warm_noise)))
        tone = np.sin(2.0 * np.pi * 154.0 * time)
        attack = 1.0 - np.exp(-time * 115.0)
        signal = (0.18 * warm_noise + 0.82 * tone) * attack * np.exp(-time * 13.0)
        self.mix_mono(
            signal,
            start_beat,
            amplitude=amplitude * 0.30,
            pan=pan,
            delay_send=0.015,
        )

    def hat(self, start_beat: float, amplitude: float = 0.055, pan: float = 0.0) -> None:
        seconds = 0.105
        count = round(seconds * SAMPLE_RATE)
        time = np.arange(count) / SAMPLE_RATE
        noise = self.rng.normal(0.0, 1.0, count)
        # A distant low-passed brush rather than a bright hi-hat.
        fast = np.convolve(noise, np.ones(13) / 13.0, mode="same")
        slow = np.convolve(noise, np.ones(43) / 43.0, mode="same")
        band = fast - slow
        band /= max(1e-9, float(np.std(band)))
        attack = np.minimum(1.0, time / 0.012)
        signal = band * attack * np.exp(-time * 24.0)
        self.mix_mono(signal, start_beat, amplitude=amplitude * 0.20, pan=pan)

    def tick(self, start_beat: float, pitch: str = "C7", amplitude: float = 0.035) -> None:
        softened_pitch = min(midi(pitch), midi("C6"))
        self.note(
            softened_pitch,
            start_beat,
            0.18,
            waveform="sine",
            amplitude=amplitude * 0.48,
            pan=float(self.rng.uniform(-0.7, 0.7)),
            attack=0.012,
            decay=0.035,
            sustain=0.38,
            release=0.060,
            delay_send=0.18,
        )

    def finish(self, *, loop: bool = True, target_peak: float = 0.76) -> np.ndarray:
        for beats, gain in ((0.75, 0.27), (1.50, 0.13), (3.0, 0.06)):
            frames = self.beat_to_frame(beats)
            if loop:
                # Circular delays preserve musical tails across a looping bar boundary.
                delayed = np.roll(self.delay_send, frames, axis=0)
            else:
                delayed = np.zeros_like(self.delay_send)
                delayed[frames:] = self.delay_send[:-frames]
            delayed[:, [0, 1]] = delayed[:, [1, 0]]
            self.audio += delayed * gain

        if loop:
            # Remove the tiny endpoint mismatch left by independently phased oscillators.
            endpoint_delta = self.audio[-1] - self.audio[0]
            self.audio -= np.linspace(0.0, 1.0, self.frames)[:, None] * endpoint_delta[None, :]
        else:
            # One-shot cues end naturally and never click when their media element stops.
            fade_frames = min(self.frames, round(0.35 * SAMPLE_RATE))
            self.audio[-fade_frames:] *= np.linspace(1.0, 0.0, fade_frames)[:, None]
        self.audio -= np.mean(self.audio, axis=0, keepdims=True)
        # Preserve clean transient and melodic edges. Peak normalisation provides ample safety
        # without the broadband harmonic grit introduced by the former saturation stage.
        peak = float(np.max(np.abs(self.audio)))
        if peak:
            self.audio *= target_peak / peak
        return self.audio


def bar(index: int) -> float:
    return index * 4.0


def add_pad_progression(song: Song, chords: list[list[str]], amplitude: float = 0.075) -> None:
    for index in range(song.bars):
        song.chord(chords[index % len(chords)], bar(index), 3.95, amplitude=amplitude)


def add_light_drums(song: Song, *, start_bar: int = 0, energetic: bool = False) -> None:
    for measure in range(start_bar, song.bars):
        origin = bar(measure)
        song.kick(origin, 0.20 if energetic else 0.145)
        song.kick(origin + (2.5 if energetic else 2.0), 0.145 if energetic else 0.095)
        song.snare(origin + 1.0, 0.095 if energetic else 0.065, pan=-0.06)
        song.snare(origin + 3.0, 0.105 if energetic else 0.070, pan=0.06)
        steps = 4 if energetic else 2
        for step in range(steps):
            beat = origin + step * (4.0 / steps)
            accent = 1.25 if step % 2 else 0.85
            song.hat(
                beat,
                (0.018 if energetic else 0.012) * accent,
                pan=(-0.24 if step % 2 else 0.24),
            )


def add_gentle_rhythm(song: Song, measure: int, intensity: float = 0.5) -> None:
    """Add motion that stays behind the harmony, even in crisis and endgame material."""
    intensity = max(0.0, min(1.0, intensity))
    if intensity <= 0.0:
        return
    origin = bar(measure)
    song.kick(origin, 0.075 + 0.085 * intensity)
    if intensity >= 0.38:
        song.kick(origin + 2.5, 0.050 + 0.055 * intensity)
    if measure % 2 == 1:
        song.snare(origin + 3.0, 0.045 + 0.045 * intensity, pan=0.05)
    if intensity >= 0.55:
        song.hat(origin + 1.0, 0.008 + 0.006 * intensity, pan=-0.18)
        song.hat(origin + 3.0, 0.008 + 0.006 * intensity, pan=0.18)


def add_rounded_arp(
    song: Song,
    chord: list[str],
    measure: int,
    *,
    amplitude: float = 0.028,
    sparse: bool = False,
    pan: float = 0.22,
) -> None:
    if sparse:
        notes = [chord[0], chord[2], chord[3], chord[1]]
        step = 1.0
    else:
        notes = [chord[0], chord[1], chord[2], chord[1], chord[3], chord[2], chord[1], chord[2]]
        step = 0.5
    add_sequence(
        song,
        notes,
        bar(measure),
        step,
        waveform="rounded-pluck",
        amplitude=amplitude,
        pan=pan,
        delay_send=0.10,
        attack=0.020,
        decay=0.080,
        sustain=0.48,
        release=0.10,
    )


def add_bass_bar(song: Song, root: str, measure: int, *, active: bool = False, amp: float = 0.13) -> None:
    origin = bar(measure)
    if active:
        pattern = [(0.0, 0.70), (1.0, 0.42), (1.75, 0.42), (2.5, 0.70), (3.5, 0.38)]
    else:
        pattern = [(0.0, 1.35), (2.0, 0.80), (3.25, 0.55)]
    for start, length in pattern:
        song.note(root, origin + start, length, waveform="triangle", amplitude=amp, pan=-0.05)


def add_sequence(
    song: Song,
    notes: list[str | int | None],
    start_beat: float,
    step: float,
    *,
    waveform: str,
    amplitude: float,
    pan: float = 0.0,
    duration: float | None = None,
    delay_send: float = 0.0,
    duty: float = 0.25,
    attack: float = 0.014,
    decay: float = 0.035,
    sustain: float = 0.72,
    release: float = 0.075,
) -> None:
    for index, pitch in enumerate(notes):
        if pitch is None:
            continue
        song.note(
            pitch,
            start_beat + index * step,
            duration if duration is not None else step * 0.82,
            waveform=waveform,
            amplitude=amplitude,
            pan=pan,
            duty=duty,
            vibrato_depth=0.0,
            delay_send=delay_send,
            attack=attack,
            decay=decay,
            sustain=sustain,
            release=release,
        )


def add_motif_sequence(
    song: Song,
    notes: list[str | int | None],
    start_beat: float,
    step: float,
    *,
    amplitude: float,
    pan: float = 0.0,
    duration: float | None = None,
    delay_send: float = 0.0,
) -> None:
    """Render a foreground motif without the brittle edge of a raw chip oscillator."""
    add_sequence(
        song,
        notes,
        start_beat,
        step,
        waveform="warm-lead",
        amplitude=amplitude,
        pan=pan,
        duration=duration,
        delay_send=delay_send,
        attack=0.026,
        decay=0.085,
        sustain=0.60,
        release=0.11,
    )


def compose_hello_world_model(song: Song) -> None:
    chords = [
        ["C4", "E4", "G4", "B4"],
        ["D4", "F#4", "A4", "B4"],
        ["E4", "G4", "B4", "D5"],
        ["G3", "B3", "D4", "E4"],
    ]
    roots = ["C2", "D2", "E2", "G2"]

    # 72 bars: eight-bar introduction, two theme cycles, an active variation, a quiet safety
    # interlude, a developed return, and an eight-bar landing which points cleanly back to bar one.
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_active = 8 <= measure < 40 or 48 <= measure < 64
        is_variation = 24 <= measure < 40
        is_breakdown = 40 <= measure < 48
        is_landing = measure >= 64

        pad_level = 0.075 if is_breakdown else (0.060 if is_active else 0.066)
        song.chord(chord, origin, 3.95, amplitude=pad_level)
        add_bass_bar(
            song,
            roots[measure % 4],
            measure,
            active=is_active and not is_breakdown,
            amp=0.105 if is_intro or is_breakdown or is_landing else 0.118,
        )

        if is_breakdown:
            arp = [chord[0], chord[2], chord[3], chord[1]]
            step = 1.0
            arp_level = 0.025
        elif is_intro or is_landing:
            arp = chord + list(reversed(chord))
            step = 0.5
            arp_level = 0.028
        elif is_variation:
            arp = [chord[0], chord[2], chord[1], chord[3], chord[2], chord[3], chord[1], chord[2]]
            step = 0.5
            arp_level = 0.032
        else:
            arp = chord + list(reversed(chord))
            step = 0.5
            arp_level = 0.030
        add_sequence(
            song,
            arp,
            origin,
            step,
            waveform="bell",
            amplitude=arp_level,
            pan=0.30 if measure % 2 else -0.30,
            delay_send=0.20 if is_breakdown else 0.23,
        )

        if 8 <= measure < 40 or 48 <= measure < 64:
            for offset in (0.0, 1.0, 2.0, 3.0):
                song.hat(origin + offset, 0.020 if not is_variation else 0.024, pan=0.28 if int(offset) % 2 else -0.28)
        if 8 <= measure < 24 or 48 <= measure < 64:
            song.kick(origin, 0.155)
            if measure % 2:
                song.snare(origin + 2.0, 0.075)
        elif is_variation:
            song.kick(origin, 0.175)
            song.kick(origin + 2.5, 0.115)
            song.snare(origin + 1.0, 0.068, pan=-0.08)
            song.snare(origin + 3.0, 0.074, pan=0.08)
        elif measure in (4, 68):
            song.kick(origin, 0.12)

    motif = ["C5", "E5", "G5", "B5", "A5", "G5", "E5", "D5"]
    motif_variation = ["E5", "G5", "B5", "D6", "C6", "B5", "G5", "F#5"]
    motif_developed = ["C5", "E5", "G5", "B5", "A5", None, "E5", "D5"]
    answer = ["G5", "F#5", "D5", None, "E5", None, "D5", None]
    for measure in (10, 18, 66):
        add_motif_sequence(song, motif, bar(measure), 0.5, amplitude=0.069, pan=-0.12, delay_send=0.20)
    for measure in (26, 34):
        add_motif_sequence(song, motif_variation, bar(measure), 0.5, amplitude=0.064, pan=-0.10, delay_send=0.18)
    for measure in (50, 58):
        add_motif_sequence(song, motif_developed, bar(measure), 0.5, amplitude=0.068, pan=-0.10, delay_send=0.19)
    for measure in (11, 19, 27, 35, 51, 59, 67):
        start = bar(measure)
        add_motif_sequence(song, answer, start, 0.5, amplitude=0.057, pan=0.20, delay_send=0.16)

    reflective = ["B4", "A4", "F#4", None, "G4", None, "E4", None]
    add_sequence(song, reflective, bar(42), 0.5, waveform="soft-pad", amplitude=0.062, pan=-0.12, duration=0.74, delay_send=0.22)
    add_sequence(song, list(reversed([note for note in reflective if note])), bar(46), 0.5, waveform="bell", amplitude=0.030, pan=0.18, delay_send=0.27)

    for beat in (bar(5) + 3.5, bar(23) + 3.5, bar(47) + 3.5, bar(65) + 3.5):
        song.tick(beat, "C7", 0.030)


def compose_gradients_flowing(song: Song) -> None:
    chords = [
        ["D4", "F#4", "A4", "C#5"],
        ["A3", "C#4", "E4", "B4"],
        ["B3", "D4", "F#4", "A4"],
        ["G3", "B3", "D4", "F#4"],
    ]
    roots = ["D2", "A1", "B1", "G1"]

    # 80 bars: a gradual startup, two productive theme blocks, a contrasting middle, a sparse
    # debugging break, a busier return, an airy bridge, and an eight-bar loop transition.
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_middle = 24 <= measure < 40
        is_breakdown = 40 <= measure < 48
        is_return = 48 <= measure < 64
        is_bridge = 64 <= measure < 72
        is_landing = measure >= 72

        pad_level = 0.062 if is_breakdown or is_bridge else (0.047 if is_theme or is_middle or is_return else 0.053)
        song.chord(chord, origin, 3.95, amplitude=pad_level)
        add_bass_bar(
            song,
            roots[measure % 4],
            measure,
            active=is_theme or is_middle or is_return or is_landing,
            amp=0.113 if is_intro or is_breakdown or is_bridge else 0.135,
        )

        if is_breakdown or is_bridge:
            arp = [chord[0], chord[2], chord[3], chord[1]]
            arp_step = 1.0
            arp_level = 0.022
        elif is_middle:
            arp = [chord[0], chord[2], chord[1], chord[3], chord[1], chord[2], chord[3], chord[2]]
            arp_step = 0.5
            arp_level = 0.032
        else:
            arp = [chord[0], chord[1], chord[2], chord[1], chord[3], chord[2], chord[1], chord[2]]
            arp_step = 0.5
            arp_level = 0.028 if is_intro or is_landing else 0.034
        add_sequence(
            song,
            arp,
            origin,
            arp_step,
            waveform="rounded-pluck",
            amplitude=arp_level,
            pan=0.24,
            delay_send=0.08,
            attack=0.014,
            decay=0.070,
            sustain=0.50,
            release=0.085,
        )

        if 4 <= measure < 8:
            song.hat(origin + 1.0, 0.011, pan=-0.22)
            song.hat(origin + 3.0, 0.011, pan=0.22)
        elif is_theme or is_landing:
            song.kick(origin, 0.150)
            song.kick(origin + 2.5, 0.100)
            song.snare(origin + 1.0, 0.058, pan=-0.06)
            song.snare(origin + 3.0, 0.062, pan=0.06)
            for step in range(4):
                song.hat(origin + step, 0.013, pan=-0.24 if step % 2 else 0.24)
        elif is_middle or is_return:
            song.kick(origin, 0.165)
            song.kick(origin + 2.5, 0.115)
            song.snare(origin + 1.0, 0.065, pan=-0.06)
            song.snare(origin + 3.0, 0.070, pan=0.06)
            for step in range(4):
                song.hat(origin + 0.5 + step, 0.012, pan=-0.25 if step % 2 else 0.25)
        elif is_bridge and measure >= 68:
            song.kick(origin, 0.110)
            song.hat(origin + 1.5, 0.010, pan=-0.20)
            song.hat(origin + 3.5, 0.010, pan=0.20)

    lead_a = ["D5", "F#5", "A5", "C#6", "B5", "A5", "F#5", "E5"]
    lead_b = ["F#5", "E5", "D5", None, "A4", "B4", "D5", "E5"]
    lead_c = ["B4", "D5", "F#5", "A5", "G5", "F#5", "E5", "C#5"]
    bridge = ["A4", "C#5", "E5", None, "F#5", "E5", "C#5", "B4"]
    lead_entries = (
        (10, lead_a), (18, lead_b),
        (26, lead_c), (34, lead_a),
        (50, lead_a), (54, lead_b), (58, lead_c),
        (66, bridge), (74, lead_a),
    )
    for measure, phrase in lead_entries:
        start = bar(measure)
        add_motif_sequence(song, phrase, start, 0.5, amplitude=0.068, pan=-0.20, delay_send=0.17)
    debugging_phrase = ["F#4", "E4", "D4", None, "A4", None, "B4", None]
    add_sequence(song, debugging_phrase, bar(42), 0.5, waveform="soft-pad", amplitude=0.057, pan=-0.18, duration=0.72, delay_send=0.20)

    for measure in (15, 23, 31, 39, 55, 63, 71, 79):
        add_sequence(
            song,
            ["A5", "B5", "C#6", "D6", None, "A5", "F#5", "E5"],
            bar(measure),
            0.5,
            waveform="bell",
            amplitude=0.055,
            pan=0.32,
            delay_send=0.26,
        )


def compose_safety_case_short_sketch(song: Song) -> None:
    chords = [
        ["E3", "G3", "B3", "F#4"],
        ["C3", "E3", "G3", "B3"],
        ["G3", "B3", "D4", "E4"],
        ["D3", "F#3", "A3", "E4"],
    ]
    roots = ["E2", "C2", "G2", "D2"]
    add_pad_progression(song, chords, 0.093)
    for measure in range(song.bars):
        origin = bar(measure)
        song.note(roots[measure % 4], origin, 2.8, waveform="triangle", amplitude=0.105, pan=-0.12, attack=0.03, release=0.22)
        # A 3+3+2 pattern feels analytic without implying danger.
        for offset in (0.0, 1.5, 3.0):
            song.tick(origin + offset, "E6" if offset == 0.0 else "B6", 0.026)
        if measure % 2 == 1:
            song.kick(origin, 0.12)
            song.snare(origin + 3.0, 0.075, pan=0.15)
        chord = chords[measure % 4]
        add_sequence(
            song,
            [chord[1], chord[2], chord[3], chord[2], chord[1], None, chord[2], None],
            origin,
            0.5,
            waveform="bell",
            amplitude=0.030,
            pan=0.24,
            delay_send=0.30,
        )

    safety_answer = ["B4", "A4", "F#4", None, "G4", None, None, None]
    question = ["E4", "G4", "B4", None, "D5", "B4", "A4", None]
    for start in (bar(2), bar(10)):
        add_sequence(song, question, start, 0.5, waveform="soft-pad", amplitude=0.090, pan=-0.20, duration=0.75, delay_send=0.17)
        add_motif_sequence(song, safety_answer, start + 4.0, 0.5, amplitude=0.050, pan=0.18, duration=0.72, delay_send=0.20)
    for start in (bar(6), bar(14)):
        add_sequence(song, ["E5", "D5", "B4", "A4", "G4", None, "F#4", None], start, 0.5, waveform="bell", amplitude=0.057, pan=0.05, delay_send=0.32)


def compose_red_team_short_sketch(song: Song) -> None:
    chords = [
        ["D3", "F3", "A3", "E4"],
        ["C#3", "E3", "G3", "D4"],
        ["Bb2", "D3", "F3", "A3"],
        ["A2", "C#3", "E3", "Bb3"],
    ]
    roots = ["D2", "C#2", "Bb1", "A1"]
    add_pad_progression(song, chords, 0.048)
    for measure in range(song.bars):
        origin = bar(measure)
        add_bass_bar(song, roots[measure % 4], measure, active=True, amp=0.165)
        song.kick(origin, 0.20)
        song.kick(origin + 1.75, 0.12)
        song.kick(origin + 2.5, 0.16)
        song.snare(origin + 1.0, 0.090, pan=-0.06)
        song.snare(origin + 3.0, 0.100, pan=0.06)
        for step in range(4):
            song.hat(origin + 0.5 + step, 0.012, pan=-0.22 if step % 2 else 0.22)
        chord = chords[measure % 4]
        sequence = [chord[0], chord[1], chord[2], chord[1]] * 2
        add_sequence(
            song,
            sequence,
            origin,
            0.5,
            waveform="rounded-pluck",
            amplitude=0.022,
            pan=0.22,
            delay_send=0.06,
            attack=0.018,
            decay=0.075,
            sustain=0.46,
            release=0.090,
        )

    warning = ["D5", "D5", "F5", "Eb5", "D5", None, "C#5", "A4"]
    answer = ["A5", "G5", "E5", None, "F5", "Eb5", "D5", None]
    for start in (bar(0), bar(4), bar(8), bar(12)):
        add_motif_sequence(song, warning, start, 0.5, amplitude=0.072, pan=-0.24, delay_send=0.12)
        add_motif_sequence(song, answer, start + 4.0, 0.5, amplitude=0.056, pan=0.18, delay_send=0.14)
    for measure in (3, 7, 11, 15):
        add_sequence(
            song,
            ["D5", "C#5", "C5", "Bb4", "A4", "Ab4", "G4", "F4"],
            bar(measure),
            0.5,
            waveform="rounded-pluck",
            amplitude=0.024,
            pan=0.05,
            delay_send=0.18,
            attack=0.020,
            decay=0.080,
            sustain=0.45,
            release=0.10,
        )


def compose_last_evaluation_short_sketch(song: Song) -> None:
    chords = [
        ["E3", "G3", "B3", "D4"],
        ["C3", "E3", "G3", "B3"],
        ["G2", "B2", "D3", "A3"],
        ["D3", "F#3", "A3", "B3"],
        ["E3", "G3", "B3", "F#4"],
        ["C3", "E3", "G3", "D4"],
        ["A2", "C3", "E3", "B3"],
        ["B2", "D#3", "F#3", "A3"],
    ]
    roots = ["E2", "C2", "G1", "D2", "E2", "C2", "A1", "B1"]
    add_pad_progression(song, chords, 0.089)
    for measure in range(song.bars):
        origin = bar(measure)
        song.note(roots[measure % 8], origin, 2.4, waveform="triangle", amplitude=0.135, pan=-0.08, attack=0.02, release=0.18)
        song.kick(origin, 0.20 if measure < 8 else 0.26)
        song.kick(origin + 2.75, 0.14 if measure < 8 else 0.20)
        if measure >= 4:
            song.snare(origin + 2.0, 0.11, pan=0.12)
        for offset in (0.5, 1.5, 2.5, 3.5):
            song.hat(origin + offset, 0.022 if measure < 8 else 0.032, pan=0.28 if int(offset) % 2 else -0.28)
        chord = chords[measure % 8]
        add_sequence(song, chord + list(reversed(chord)), origin, 0.5, waveform="bell", amplitude=0.027, pan=0.30, delay_send=0.34)

    minor_lab = ["E4", "G4", "B4", "D5", "C5", "B4", "G4", "F#4"]
    rising = ["E4", "G4", "B4", "D#5", "E5", "F#5", "G5", "B5"]
    evidence = ["B4", "A4", "F#4", None, "G4", "B4", "D5", None]
    for start in (bar(1), bar(9)):
        add_sequence(song, minor_lab, start, 0.5, waveform="soft-pad", amplitude=0.098, pan=-0.20, duration=0.72, delay_send=0.20)
    for start in (bar(5), bar(13)):
        add_motif_sequence(song, evidence, start, 0.5, amplitude=0.054, pan=0.16, duration=0.68, delay_send=0.17)
    add_motif_sequence(song, rising, bar(15), 0.5, amplitude=0.064, pan=0.0, delay_send=0.19)


def compose_broadly_shared_future_short_sketch(song: Song) -> None:
    chords = [
        ["A3", "C#4", "E4", "F#4"],
        ["E3", "G#3", "B3", "F#4"],
        ["F#3", "A3", "C#4", "E4"],
        ["D3", "F#3", "A3", "C#4"],
    ]
    roots = ["A1", "E2", "F#2", "D2"]
    add_pad_progression(song, chords, 0.088)
    add_light_drums(song, energetic=False)
    for measure in range(song.bars):
        add_bass_bar(song, roots[measure % 4], measure, active=measure >= 4, amp=0.125)
        chord = chords[measure % 4]
        add_sequence(
            song,
            [chord[0], chord[2], chord[1], chord[3], chord[2], chord[1], chord[2], chord[3]],
            bar(measure),
            0.5,
            waveform="bell",
            amplitude=0.034,
            pan=0.28 if measure % 2 else -0.28,
            delay_send=0.28,
        )
        if measure in (3, 7, 11, 15):
            song.snare(bar(measure) + 3.5, 0.09, pan=0.22)

    lab_major = ["A4", "C#5", "E5", "G#5", "F#5", "E5", "C#5", "B4"]
    shared_answer = ["E5", "D5", "B4", None, "C#5", "E5", "F#5", None]
    final_phrase = ["A4", "B4", "C#5", "E5", "F#5", "E5", "C#5", "A4"]
    for start in (bar(0), bar(8)):
        add_motif_sequence(song, lab_major, start, 0.5, amplitude=0.067, pan=-0.18, delay_send=0.19)
    for start in (bar(4), bar(12)):
        add_sequence(song, shared_answer, start, 0.5, waveform="soft-pad", amplitude=0.080, pan=0.18, duration=0.72, delay_send=0.20)
    add_sequence(song, final_phrase, bar(15), 0.5, waveform="bell", amplitude=0.073, pan=0.0, delay_send=0.30)


def compose_safety_case(song: Song) -> None:
    chords = [
        ["E3", "G3", "B3", "F#4"],
        ["C3", "E3", "G3", "B3"],
        ["G3", "B3", "D4", "E4"],
        ["D3", "F#3", "A3", "E4"],
    ]
    roots = ["E2", "C2", "G2", "D2"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_inquiry = 8 <= measure < 24
        is_evidence = 24 <= measure < 40
        is_pause = 40 <= measure < 48
        is_answer = 48 <= measure < 64
        is_landing = measure >= 64

        song.chord(chord, origin, 3.95, amplitude=0.086 if is_pause else 0.074)
        song.note(
            roots[measure % 4],
            origin,
            2.9 if is_pause else 2.4,
            waveform="triangle",
            amplitude=0.090 if is_intro or is_pause or is_landing else 0.105,
            pan=-0.10,
            attack=0.045,
            release=0.24,
        )
        add_rounded_arp(
            song,
            chord,
            measure,
            amplitude=0.022 if is_pause or is_intro else 0.027,
            sparse=is_pause or is_intro or is_landing,
            pan=0.20,
        )
        if is_inquiry:
            add_gentle_rhythm(song, measure, 0.22)
        elif is_evidence:
            add_gentle_rhythm(song, measure, 0.36)
        elif is_answer:
            add_gentle_rhythm(song, measure, 0.28)
        if measure in (6, 22, 38, 54, 70):
            song.tick(origin + 3.0, "E6", 0.020)

    question = ["E4", "G4", "B4", None, "D5", "B4", "A4", None]
    question_developed = ["G4", "B4", "D5", None, "E5", "D5", "B4", None]
    safety_answer = ["B4", "A4", "F#4", None, "G4", None, "E4", None]
    for measure in (10, 18, 26, 34):
        add_sequence(
            song,
            question,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.070,
            pan=-0.18,
            duration=0.74,
            delay_send=0.16,
        )
        add_motif_sequence(
            song,
            safety_answer,
            bar(measure + 1),
            0.5,
            amplitude=0.047,
            pan=0.16,
            duration=0.70,
            delay_send=0.17,
        )
    for measure in (50, 58, 66):
        add_sequence(
            song,
            question_developed,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.066,
            pan=-0.16,
            duration=0.74,
            delay_send=0.16,
        )
        add_motif_sequence(
            song,
            safety_answer,
            bar(measure + 1),
            0.5,
            amplitude=0.046,
            pan=0.16,
            duration=0.70,
            delay_send=0.16,
        )
    audit_line = ["E5", "D5", "B4", "A4", "G4", None, "F#4", None]
    for measure in (30, 46, 62):
        add_sequence(
            song,
            audit_line,
            bar(measure),
            0.5,
            waveform="rounded-pluck",
            amplitude=0.035,
            pan=0.04,
            delay_send=0.20,
            attack=0.024,
            release=0.11,
        )


def compose_red_team(song: Song) -> None:
    chords = [
        ["D3", "F3", "A3", "E4"],
        ["C#3", "E3", "G3", "D4"],
        ["Bb2", "D3", "F3", "A3"],
        ["A2", "C#3", "E3", "Bb3"],
    ]
    roots = ["D2", "C#2", "Bb1", "A1"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        if measure < 8:
            intensity = 0.10
        elif measure < 24:
            intensity = 0.30
        elif measure < 40:
            intensity = 0.48
        elif measure < 48:
            intensity = 0.0
        elif measure < 64:
            intensity = 0.38
        elif measure < 72:
            intensity = 0.20
        else:
            intensity = 0.12

        song.chord(chord, origin, 3.95, amplitude=0.070 if intensity == 0.0 else 0.058)
        add_bass_bar(
            song,
            roots[measure % 4],
            measure,
            active=intensity >= 0.28,
            amp=0.105 + 0.030 * intensity,
        )
        add_rounded_arp(
            song,
            chord,
            measure,
            amplitude=0.019 + 0.013 * intensity,
            sparse=intensity < 0.25,
            pan=0.20,
        )
        add_gentle_rhythm(song, measure, intensity)

    warning = ["D5", "D5", "F5", "Eb5", "D5", None, "C#5", "A4"]
    response = ["A4", "G4", "E4", None, "F4", "Eb4", "D4", None]
    for measure in (4, 12, 28, 36, 52, 60, 74):
        add_motif_sequence(
            song,
            warning,
            bar(measure),
            0.5,
            amplitude=0.056,
            pan=-0.16,
            delay_send=0.12,
        )
        add_motif_sequence(
            song,
            response,
            bar(measure + 1),
            0.5,
            amplitude=0.044,
            pan=0.14,
            delay_send=0.13,
        )
    descending = ["D5", "C#5", "C5", "Bb4", "A4", "Ab4", "G4", "F4"]
    for measure in (22, 38, 54, 70):
        add_sequence(
            song,
            descending,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.042,
            pan=0.02,
            duration=0.66,
            delay_send=0.16,
        )


def compose_last_evaluation(song: Song) -> None:
    chords = [
        ["E3", "G3", "B3", "D4"],
        ["C3", "E3", "G3", "B3"],
        ["G2", "B2", "D3", "A3"],
        ["D3", "F#3", "A3", "B3"],
        ["E3", "G3", "B3", "F#4"],
        ["C3", "E3", "G3", "D4"],
        ["A2", "C3", "E3", "B3"],
        ["B2", "D#3", "F#3", "A3"],
    ]
    roots = ["E2", "C2", "G1", "D2", "E2", "C2", "A1", "B1"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 8]
        if measure < 8:
            intensity = 0.12
        elif measure < 24:
            intensity = 0.26
        elif measure < 40:
            intensity = 0.34
        elif measure < 56:
            intensity = 0.48
        elif measure < 64:
            intensity = 0.08
        elif measure < 76:
            intensity = 0.40
        else:
            intensity = 0.18

        song.chord(chord, origin, 3.95, amplitude=0.078 if intensity < 0.10 else 0.068)
        song.note(
            roots[measure % 8],
            origin,
            2.5,
            waveform="triangle",
            amplitude=0.105 + 0.025 * intensity,
            pan=-0.08,
            attack=0.035,
            release=0.22,
        )
        add_rounded_arp(
            song,
            chord,
            measure,
            amplitude=0.021 + 0.014 * intensity,
            sparse=intensity < 0.15,
            pan=0.22,
        )
        add_gentle_rhythm(song, measure, intensity)

    minor_lab = ["E4", "G4", "B4", "D5", "C5", "B4", "G4", "F#4"]
    evidence = ["B4", "A4", "F#4", None, "G4", "B4", "D5", None]
    rising = ["E4", "G4", "B4", "D#5", "E5", "F#5", "G5", "B5"]
    for measure in (8, 24, 48, 64):
        add_sequence(
            song,
            minor_lab,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.070,
            pan=-0.17,
            duration=0.72,
            delay_send=0.17,
        )
    for measure in (16, 32, 52, 68):
        add_motif_sequence(
            song,
            evidence,
            bar(measure),
            0.5,
            amplitude=0.049,
            pan=0.15,
            duration=0.68,
            delay_send=0.16,
        )
    add_motif_sequence(
        song,
        rising,
        bar(76),
        0.5,
        amplitude=0.055,
        pan=0.0,
        delay_send=0.17,
    )


def compose_broadly_shared_future(song: Song) -> None:
    chords = [
        ["A3", "C#4", "E4", "F#4"],
        ["E3", "G#3", "B3", "F#4"],
        ["F#3", "A3", "C#4", "E4"],
        ["D3", "F#3", "A3", "C#4"],
    ]
    roots = ["A1", "E2", "F#2", "D2"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        if measure < 8:
            intensity = 0.08
        elif measure < 24:
            intensity = 0.25
        elif measure < 40:
            intensity = 0.36
        elif measure < 48:
            intensity = 0.06
        elif measure < 64:
            intensity = 0.34
        elif measure < 72:
            intensity = 0.24
        else:
            intensity = 0.12
        song.chord(chord, origin, 3.95, amplitude=0.076 if intensity < 0.10 else 0.068)
        add_bass_bar(
            song,
            roots[measure % 4],
            measure,
            active=intensity >= 0.24,
            amp=0.105 + 0.035 * intensity,
        )
        add_rounded_arp(
            song,
            chord,
            measure,
            amplitude=0.023 + 0.013 * intensity,
            sparse=intensity < 0.15,
            pan=0.20 if measure % 2 else -0.20,
        )
        add_gentle_rhythm(song, measure, intensity)

    lab_major = ["A4", "C#5", "E5", "G#5", "F#5", "E5", "C#5", "B4"]
    shared_answer = ["E5", "D5", "B4", None, "C#5", "E5", "F#5", None]
    final_phrase = ["A4", "B4", "C#5", "E5", "F#5", "E5", "C#5", "A4"]
    for measure in (8, 24, 50, 66):
        add_motif_sequence(
            song,
            lab_major,
            bar(measure),
            0.5,
            amplitude=0.058,
            pan=-0.15,
            delay_send=0.17,
        )
    for measure in (16, 32, 56, 70):
        add_sequence(
            song,
            shared_answer,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.060,
            pan=0.16,
            duration=0.72,
            delay_send=0.16,
        )
    for measure in (46, 78):
        add_sequence(
            song,
            final_phrase,
            bar(measure),
            0.5,
            waveform="rounded-pluck",
            amplitude=0.046,
            pan=0.0,
            delay_send=0.18,
            attack=0.024,
            release=0.11,
        )


def compose_cashflow_positive(song: Song) -> None:
    chords = [
        ["F3", "A3", "C4", "E4"],
        ["C3", "E3", "G3", "D4"],
        ["D3", "F3", "A3", "C4"],
        ["Bb2", "D3", "F3", "A3"],
    ]
    roots = ["F2", "C2", "D2", "Bb1"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        if measure < 8:
            intensity = 0.10
        elif measure < 24:
            intensity = 0.34
        elif measure < 40:
            intensity = 0.46
        elif measure < 48:
            intensity = 0.12
        elif measure < 64:
            intensity = 0.38
        else:
            intensity = 0.18
        song.chord(chord, origin, 3.95, amplitude=0.064)
        add_bass_bar(song, roots[measure % 4], measure, active=intensity >= 0.30, amp=0.105 + 0.030 * intensity)
        add_rounded_arp(
            song,
            chord,
            measure,
            amplitude=0.022 + 0.015 * intensity,
            sparse=intensity < 0.20,
            pan=0.20,
        )
        add_gentle_rhythm(song, measure, intensity)

    theme = ["F4", "A4", "C5", "E5", "D5", "C5", "A4", "G4"]
    invoice = ["C5", "A4", "F4", None, "G4", "A4", "C5", None]
    runway = ["D4", "F4", "A4", "C5", "Bb4", "A4", "F4", "E4"]
    for measure in (10, 18, 34, 50, 58, 66):
        add_motif_sequence(song, theme, bar(measure), 0.5, amplitude=0.054, pan=-0.14, delay_send=0.15)
    for measure in (14, 30, 54, 70):
        add_sequence(
            song,
            invoice,
            bar(measure),
            0.5,
            waveform="rounded-pluck",
            amplitude=0.039,
            pan=0.15,
            delay_send=0.14,
            attack=0.022,
            release=0.10,
        )
    add_sequence(
        song,
        runway,
        bar(42),
        0.5,
        waveform="soft-pad",
        amplitude=0.058,
        pan=-0.12,
        duration=0.72,
        delay_send=0.16,
    )


def compose_reviewer_two(song: Song) -> None:
    chords = [
        ["Bb3", "D4", "F4", "A4"],
        ["C4", "E4", "G4", "D5"],
        ["D3", "F3", "A3", "C4"],
        ["Eb3", "G3", "Bb3", "D4"],
    ]
    roots = ["Bb1", "C2", "D2", "Eb2"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_margin_note = 24 <= measure < 40
        is_revision = 48 <= measure < 64
        is_pause = 40 <= measure < 48
        intensity = 0.08 if measure < 8 or is_pause else (0.30 if is_margin_note or is_revision else 0.20)
        song.chord(chord, origin, 3.95, amplitude=0.072 if is_pause else 0.063)
        song.note(
            roots[measure % 4],
            origin,
            2.6,
            waveform="triangle",
            amplitude=0.096 + 0.020 * intensity,
            pan=-0.08,
            attack=0.045,
            release=0.23,
        )
        add_rounded_arp(
            song,
            chord,
            measure,
            amplitude=0.021 + 0.012 * intensity,
            sparse=is_pause or measure < 8 or measure >= 64,
            pan=0.19,
        )
        add_gentle_rhythm(song, measure, intensity)
        if measure in (7, 23, 39, 55, 71):
            song.tick(origin + 3.0, "Bb5", 0.018)

    thesis = ["Bb4", "D5", "F5", "A5", "G5", "F5", "D5", "C5"]
    objection = ["F5", "E5", "C5", None, "D5", "Bb4", "C5", None]
    revision = ["D5", "F5", "A5", None, "G5", "E5", "D5", None]
    for measure in (10, 18, 26, 34, 50, 58, 66):
        add_motif_sequence(song, thesis, bar(measure), 0.5, amplitude=0.052, pan=-0.14, delay_send=0.16)
    for measure in (14, 30, 54, 70):
        add_sequence(
            song,
            objection,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.056,
            pan=0.15,
            duration=0.70,
            delay_send=0.16,
        )
    add_sequence(
        song,
        revision,
        bar(46),
        0.5,
        waveform="rounded-pluck",
        amplitude=0.038,
        pan=0.0,
        delay_send=0.18,
        attack=0.024,
        release=0.11,
    )


def compose_nothing_left_to_read(song: Song) -> None:
    chords = [
        ["E3", "G3", "B3", "D4"],
        ["C3", "E3", "G3", "B3"],
        ["G2", "B2", "D3", "A3"],
        ["D3", "F#3", "A3", "E4"],
    ]
    roots = ["E2", "C2", "G1", "D2"]
    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        song.chord(chord, origin, 3.90, amplitude=0.063, attack=0.30, release=0.48)
        song.note(
            roots[measure % 4],
            origin,
            3.4,
            waveform="sine",
            amplitude=0.070,
            pan=-0.06,
            attack=0.18,
            decay=0.18,
            sustain=0.80,
            release=0.42,
        )
        if measure % 4 == 2:
            song.note(
                chord[2],
                origin + 2.0,
                1.5,
                waveform="rounded-pluck",
                amplitude=0.024,
                pan=0.18,
                attack=0.08,
                decay=0.12,
                sustain=0.52,
                release=0.22,
                delay_send=0.16,
            )

    fragments = [
        (4, ["E4", "G4", "B4", None, "A4", None, "G4", None]),
        (12, ["D5", "B4", "G4", None, "E4", None, None, None]),
        (20, ["B4", "A4", "F#4", None, "G4", None, "E4", None]),
        (28, ["E4", "G4", "B4", None, "D5", None, "E5", None]),
    ]
    for measure, phrase in fragments:
        add_sequence(
            song,
            phrase,
            bar(measure),
            0.5,
            waveform="soft-pad",
            amplitude=0.044,
            pan=-0.05,
            duration=0.78,
            delay_send=0.20,
            attack=0.10,
            decay=0.16,
            sustain=0.70,
            release=0.25,
        )


def compose_event_cue(song: Song, event: EventSpec) -> None:
    """Compose one of twenty distinct, comfort-first semantic gestures."""
    total = song.total_beats

    def pad(
        start: float,
        duration: float,
        *,
        chord: tuple[str, ...] | list[str] | None = None,
        amplitude: float = 0.052,
        attack: float = 0.14,
        release: float = 0.32,
    ) -> None:
        song.chord(
            chord or event.chord,
            start,
            min(duration, total - start),
            amplitude=amplitude,
            attack=attack,
            release=release,
        )

    def bass(
        start: float = 0.0,
        duration: float | None = None,
        *,
        amplitude: float = 0.052,
        pitch: str | None = None,
    ) -> None:
        song.note(
            pitch or event.bass,
            start,
            min(duration or (total - start - 0.20), total - start),
            waveform="sine",
            amplitude=amplitude,
            pan=-0.07,
            attack=0.12,
            decay=0.16,
            sustain=0.74,
            release=0.34,
        )

    def phrase(
        notes: list[str | int | None],
        start: float,
        step: float,
        *,
        waveform: str = "warm-lead",
        amplitude: float = 0.039,
        pan: float = -0.04,
        duration: float | None = None,
        attack: float = 0.040,
        release: float = 0.16,
    ) -> None:
        add_sequence(
            song,
            notes,
            start,
            step,
            waveform=waveform,
            amplitude=amplitude,
            pan=pan,
            duration=duration,
            delay_send=0.12,
            attack=attack,
            decay=0.090,
            sustain=0.55,
            release=release,
        )

    def shifted(notes: tuple[str | None, ...], semitones: int) -> list[int | None]:
        return [None if note is None else midi(note) + semitones for note in notes]

    melody = list(event.melody)
    gesture = event.gesture

    if gesture == "discovery-bloom":
        pad(0.0, total - 0.1, amplitude=0.047, attack=0.20)
        bass(amplitude=0.044)
        phrase(melody, 0.35, 0.48, waveform="rounded-pluck", amplitude=0.033, pan=-0.14)
        phrase(melody[4:], 4.35, 0.52, waveform="sine", amplitude=0.026, pan=0.16, attack=0.07)
    elif gesture == "breakthrough-arc":
        bass(amplitude=0.050)
        pad(0.0, total / 2, amplitude=0.046, attack=0.26)
        pad(total / 2, total / 2 - 0.1, chord=event.chord[1:] + event.chord[:1], amplitude=0.054, attack=0.20)
        phrase(melody, 0.70, 0.56, amplitude=0.038, duration=0.88, attack=0.08)
    elif gesture == "tier-staircase":
        bass(amplitude=0.042)
        phrase(melody, 0.20, 0.43, waveform="rounded-pluck", amplitude=0.035, pan=0.0, duration=0.52)
        pad(total / 2, total / 2 - 0.1, amplitude=0.050, attack=0.30)
    elif gesture == "safety-answer":
        pad(0.0, total - 0.1, amplitude=0.055, attack=0.24)
        bass(amplitude=0.046)
        phrase(melody, 0.80, 0.68, waveform="soft-pad", amplitude=0.036, duration=1.05, attack=0.12, release=0.24)
    elif gesture == "ledger-motion":
        pad(0.0, 3.8, amplitude=0.044)
        pad(4.0, total - 4.1, chord=event.chord[2:] + event.chord[:2], amplitude=0.046)
        for beat in (0.0, 2.0, 4.0, 6.0):
            bass(beat, 0.90, amplitude=0.032)
        phrase(melody, 0.45, 0.47, waveform="rounded-pluck", amplitude=0.032, pan=0.12, duration=0.56)
    elif gesture == "talent-duet":
        pad(0.0, total - 0.1, amplitude=0.050)
        bass(amplitude=0.042)
        phrase(melody[:4], 0.50, 0.58, amplitude=0.036, pan=-0.28, duration=0.76)
        phrase(melody[4:], 2.80, 0.58, waveform="sine", amplitude=0.031, pan=0.28, duration=0.82, attack=0.08)
    elif gesture == "farewell-space":
        pad(0.0, total * 0.72, amplitude=0.050, attack=0.24, release=0.48)
        bass(0.0, total * 0.72, amplitude=0.042)
        phrase(melody[:5], 0.75, 0.72, waveform="soft-pad", amplitude=0.034, duration=0.98, attack=0.12, release=0.28)
    elif gesture == "distant-rival":
        pad(0.0, total - 0.1, amplitude=0.046, attack=0.22)
        bass(amplitude=0.045)
        phrase(shifted(event.melody, -12), 0.65, 0.62, waveform="rounded-pluck", amplitude=0.034, pan=0.24, duration=0.78)
    elif gesture == "formal-seal":
        pad(0.0, 2.8, amplitude=0.050, attack=0.18)
        pad(3.1, total - 3.2, chord=event.chord[2:] + event.chord[:2], amplitude=0.050, attack=0.18)
        bass(amplitude=0.046)
        phrase([melody[0], melody[2], melody[4], melody[5]], 0.70, 1.15, waveform="rounded-pluck", amplitude=0.034, duration=0.76)
    elif gesture == "crisis-breath":
        bass(amplitude=0.052)
        pad(0.0, total - 0.1, amplitude=0.052, attack=0.40, release=0.45)
        phrase(melody[:5], 1.10, 0.82, waveform="soft-pad", amplitude=0.034, duration=1.15, attack=0.18, release=0.30)
    elif gesture == "containment-descent":
        bass(amplitude=0.050)
        pad(0.0, total - 0.1, amplitude=0.050, attack=0.34, release=0.46)
        phrase(shifted(event.melody, -12), 1.00, 0.78, waveform="soft-pad", amplitude=0.035, duration=1.10, attack=0.16, release=0.30)
    elif gesture == "coalition-question":
        pad(0.0, total - 0.1, amplitude=0.048, attack=0.24)
        bass(amplitude=0.043)
        phrase(melody[:4], 0.55, 0.60, amplitude=0.035, pan=-0.20, duration=0.78)
        phrase([event.chord[2], event.chord[1], event.chord[3]], 3.65, 0.72, waveform="sine", amplitude=0.029, pan=0.20, duration=0.90, attack=0.09)
    elif gesture == "coalition-weave":
        pad(0.0, total - 0.1, amplitude=0.055, attack=0.25)
        bass(amplitude=0.046)
        phrase(melody, 0.50, 0.62, amplitude=0.035, pan=-0.24, duration=0.82)
        phrase(list(reversed(melody[:6])), 3.20, 0.64, waveform="sine", amplitude=0.027, pan=0.24, duration=0.90, attack=0.09)
    elif gesture == "endgame-threshold":
        bass(amplitude=0.052)
        pad(0.0, total - 0.1, amplitude=0.056, attack=0.55, release=0.50)
        phrase(melody, 2.00, 0.82, waveform="soft-pad", amplitude=0.035, duration=1.18, attack=0.20, release=0.34)
    elif gesture == "victory-cadence":
        pad(0.0, total / 2, amplitude=0.050, attack=0.24)
        pad(total / 2, total / 2 - 0.1, chord=event.chord[2:] + event.chord[:2], amplitude=0.058, attack=0.22)
        bass(amplitude=0.046)
        phrase(melody, 0.45, 0.60, amplitude=0.040, pan=-0.08, duration=0.82)
        phrase([event.chord[0], event.chord[2], event.chord[1]], total - 2.80, 0.70, waveform="sine", amplitude=0.028, pan=0.15, duration=0.92, attack=0.10)
    elif gesture == "race-recedes":
        pad(0.0, total * 0.80, amplitude=0.052, attack=0.28, release=0.56)
        bass(0.0, total * 0.76, amplitude=0.043)
        phrase(melody[:6], 1.00, 0.82, waveform="soft-pad", amplitude=0.034, duration=1.08, attack=0.16, release=0.32)
    elif gesture == "institutional-close":
        pad(0.0, total * 0.42, amplitude=0.052, attack=0.20)
        pad(total * 0.46, total * 0.38, chord=event.chord[1:] + event.chord[:1], amplitude=0.046, attack=0.28, release=0.50)
        bass(0.0, total * 0.80, amplitude=0.044)
        phrase([melody[0], melody[2], melody[4]], 0.80, 1.30, waveform="rounded-pluck", amplitude=0.032, duration=0.80)
    elif gesture == "empty-ledger":
        bass(0.0, total * 0.72, amplitude=0.040)
        pad(0.0, total * 0.62, amplitude=0.046, attack=0.30, release=0.58)
        phrase([melody[0], melody[2], melody[4]], 1.00, 1.45, waveform="soft-pad", amplitude=0.032, duration=1.12, attack=0.18, release=0.36)
    elif gesture == "final-fragment":
        bass(0.0, total * 0.70, amplitude=0.042)
        pad(0.0, total * 0.72, amplitude=0.048, attack=0.50, release=0.72)
        phrase(melody[:5], 2.00, 1.00, waveform="soft-pad", amplitude=0.031, duration=1.35, attack=0.24, release=0.42)
    elif gesture == "score-sparkle":
        bass(0.0, 3.2, amplitude=0.034)
        phrase([melody[0], melody[2], melody[4], melody[6]], 0.25, 0.72, waveform="rounded-pluck", amplitude=0.036, pan=-0.10, duration=0.56)
        pad(3.20, total - 3.3, amplitude=0.048, attack=0.20)
        phrase([melody[3], melody[5]], 3.55, 0.76, waveform="sine", amplitude=0.027, pan=0.18, duration=0.78, attack=0.08)
    else:
        raise ValueError(f"Unknown event gesture: {gesture}")


EVENTS = [
    EventSpec(
        "paper-discovered", 1, "Paper Discovered", "research-world-first", 96, 2,
        ("C4", "E4", "G4", "B4"), "C2",
        ("C5", "E5", "G5", "B5", "A5", "G5", "E5", "D5"), "discovery-bloom",
    ),
    EventSpec(
        "major-breakthrough", 2, "Major Breakthrough", "major-research-result", 90, 2,
        ("D4", "F#4", "A4", "E5"), "D2",
        ("D5", "F#5", "A5", None, "B5", "A5", "F#5", "E5"), "breakthrough-arc",
    ),
    EventSpec(
        "capability-tier", 3, "Capability Tier Increased", "model-level-up", 104, 2,
        ("A3", "C#4", "E4", "B4"), "A1",
        ("A4", "B4", "C#5", "E5", "F#5", "E5", "C#5", "B4"), "tier-staircase",
    ),
    EventSpec(
        "safety-win", 4, "Safety Evidence Improved", "safety-success", 84, 2,
        ("E3", "G3", "B3", "F#4"), "E2",
        ("B4", "A4", "F#4", None, "G4", None, "E4", None), "safety-answer",
    ),
    EventSpec(
        "fundraising-complete", 5, "Fundraising Complete", "finance-success", 108, 2,
        ("F3", "A3", "C4", "E4"), "F2",
        ("F4", "A4", "C5", "E5", "D5", "C5", "A4", "G4"), "ledger-motion",
    ),
    EventSpec(
        "researcher-joins", 6, "Researcher Joined", "talent-recruited", 98, 2,
        ("G3", "B3", "D4", "A4"), "G2",
        ("G4", "B4", "D5", None, "E5", "D5", "B4", None), "talent-duet",
    ),
    EventSpec(
        "researcher-departs", 7, "Researcher Departed", "talent-departure", 76, 2,
        ("D3", "F3", "A3", "E4"), "D2",
        ("A4", "G4", "F4", None, "E4", "D4", None, None), "farewell-space",
    ),
    EventSpec(
        "rival-breakthrough", 8, "Rival Breakthrough", "rival-progress", 88, 2,
        ("B3", "D4", "F#4", "A4"), "B1",
        ("B4", "D5", "F#5", None, "E5", "D5", "C#5", None), "distant-rival",
    ),
    EventSpec(
        "regulatory-attention", 9, "Regulatory Attention", "government-scrutiny", 72, 2,
        ("C3", "Eb3", "G3", "D4"), "C2",
        ("G4", "F4", "Eb4", None, "D4", "C4", None, None), "formal-seal",
    ),
    EventSpec(
        "crisis-opened", 10, "Crisis Opened", "serious-incident", 78, 2,
        ("D3", "F3", "A3", "E4"), "D2",
        ("D5", "F5", "Eb5", None, "D5", "C#5", "A4", None), "crisis-breath",
    ),
    EventSpec(
        "containment-warning", 11, "Containment Warning", "containment-evidence", 70, 2,
        ("A2", "C3", "E3", "B3"), "A1",
        ("E4", "D4", "C4", None, "B3", "A3", None, None), "containment-descent", 0.52,
    ),
    EventSpec(
        "coalition-proposed", 12, "Coalition Proposed", "coalition-offer", 86, 2,
        ("G3", "B3", "D4", "F#4"), "G2",
        ("G4", "A4", "B4", "D5", "E5", "D5", "B4", None), "coalition-question",
    ),
    EventSpec(
        "coalition-formed", 13, "Coalition Formed", "coalition-success", 92, 3,
        ("A3", "C#4", "E4", "F#4"), "A1",
        ("A4", "C#5", "E5", "F#5", "E5", "C#5", "B4", "A4"), "coalition-weave",
    ),
    EventSpec(
        "endgame-begins", 14, "Endgame Begins", "endgame-transition", 74, 3,
        ("E3", "G3", "B3", "D4"), "E2",
        ("E4", "G4", "B4", "D5", "C5", "B4", "A4", None), "endgame-threshold",
    ),
    EventSpec(
        "race-won", 15, "Race Won", "aligned-agi-victory", 94, 3,
        ("A3", "C#4", "E4", "F#4"), "A1",
        ("A4", "C#5", "E5", "G#5", "F#5", "E5", "C#5", "A4"), "victory-cadence", 0.60,
    ),
    EventSpec(
        "race-lost", 16, "Race Lost", "rival-wins", 68, 3,
        ("E3", "G3", "B3", "F#4"), "E2",
        ("B4", "A4", "G4", None, "F#4", "E4", None, None), "race-recedes", 0.52,
    ),
    EventSpec(
        "nationalised", 17, "Lab Nationalised", "nationalisation-ending", 66, 3,
        ("C3", "E3", "G3", "D4"), "C2",
        ("G4", "E4", "D4", None, "C4", "D4", "E4", None), "institutional-close", 0.52,
    ),
    EventSpec(
        "bankruptcy", 18, "Bankruptcy", "bankruptcy-ending", 64, 2,
        ("D3", "F3", "A3", "E4"), "D2",
        ("A4", "F4", "E4", None, "D4", None, None, None), "empty-ledger", 0.50,
    ),
    EventSpec(
        "containment-failure", 19, "Containment Failure", "extinction-ending", 56, 3,
        ("E3", "G3", "B3", "D4"), "E2",
        ("E4", "G4", "B4", None, "A4", "G4", "E4", None), "final-fragment", 0.46,
    ),
    EventSpec(
        "score-milestone", 20, "Score Milestone", "score-award", 110, 2,
        ("Bb3", "D4", "F4", "A4"), "Bb1",
        ("Bb4", "D5", "F5", "A5", "G5", "F5", "D5", "C5"), "score-sparkle",
    ),
]


def compose_overnight_run(song: Song) -> None:
    """Track 10: the laboratory at three in the morning.

    A calmer sibling of "The Gradients Are Flowing" for ordinary lab play: the
    building is mostly dark, the cluster is warm, and a long training run is
    quietly making progress that nobody is awake to see. The deliberate
    rule-bend is metric rather than timbral: the arpeggio cycles in six-note
    (three-beat) groups across 4/4 bars, drifting against the barline and
    realigning every three bars. Percussion is stricter than the house rule,
    not looser — no brush snares, hats, or tick blips at all, only the rounded
    kick, so nothing in the track can startle at night.
    """
    main_chords = [
        ["G3", "B3", "D4", "F#4"],
        ["E3", "G3", "B3", "D4"],
        ["C4", "E4", "G4", "B4"],
        ["D4", "F#4", "A4", "C#5"],
    ]
    main_roots = ["G2", "E2", "C2", "D2"]
    dev_chords = [
        ["B3", "D4", "F#4", "A4"],
        ["C4", "E4", "G4", "B4"],
        ["A3", "C4", "E4", "G4"],
        ["D4", "F#4", "A4", "C5"],
    ]
    dev_roots = ["B2", "C2", "A2", "D2"]

    def hemiola_bar(measure: int, chord: list[str], amplitude: float, order: list[int]) -> None:
        # Six-note cycle stepped in quavers: three beats of pattern against a
        # four-beat bar. Indexing continues across bars so the figure drifts
        # and realigns every third bar instead of restarting.
        origin = bar(measure)
        for step in range(8):
            index = order[(measure * 8 + step) % len(order)]
            song.note(
                chord[index],
                origin + step * 0.5,
                0.42,
                waveform="rounded-pluck",
                amplitude=amplitude,
                pan=0.22,
                delay_send=0.10,
                attack=0.018,
                decay=0.075,
                sustain=0.46,
                release=0.10,
            )

    def night_bass(measure: int, root: str, *, pulse: bool = False, amp: float = 0.115) -> None:
        origin = bar(measure)
        if pulse:
            # The Frontier Pulse at whisper level: quaver roots that stop one
            # subdivision early, leaving beat 3.5 to the room tone.
            for step in range(7):
                song.note(root, origin + step * 0.5, 0.40, waveform="triangle",
                          amplitude=amp * 0.62, pan=-0.05)
        else:
            for start, length in ((0.0, 1.5), (2.0, 1.0), (3.25, 0.6)):
                song.note(root, origin + start, length, waveform="triangle",
                          amplitude=amp, pan=-0.05)

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_development = 24 <= measure < 40
        is_breathing = 40 <= measure < 48
        is_return = 48 <= measure < 60
        is_air = 60 <= measure < 68
        is_landing = measure >= 68

        chords = dev_chords if is_development else main_chords
        roots = dev_roots if is_development else main_roots
        chord = chords[measure % 4]
        root = roots[measure % 4]

        pad_level = 0.068 if is_breathing or is_air else (0.052 if is_theme or is_return else 0.058)
        song.chord(chord, origin, 3.95, amplitude=pad_level, attack=0.16, release=0.26)

        night_bass(
            measure,
            root,
            pulse=(is_return and measure % 2 == 0),
            amp=0.105 if is_intro or is_breathing or is_air or is_landing else 0.122,
        )

        if is_intro and measure >= 4:
            hemiola_bar(measure, chord, 0.021, [0, 2, 3, 1, 3, 2])
        elif is_theme or is_return:
            hemiola_bar(measure, chord, 0.028 if is_theme else 0.030, [0, 2, 3, 1, 3, 2])
        elif is_development:
            hemiola_bar(measure, chord, 0.026, [0, 3, 2, 1, 2, 3])
        elif is_air:
            # The drift settles into plain crotchets while the building sleeps.
            for step, index in enumerate((0, 2, 3, 1)):
                song.note(chord[index], origin + step * 1.0, 0.85,
                          waveform="rounded-pluck", amplitude=0.020, pan=0.18,
                          delay_send=0.14, attack=0.022, decay=0.08,
                          sustain=0.44, release=0.12)

        if (16 <= measure < 24) or (48 <= measure < 60):
            song.kick(origin, 0.105)
            if measure % 2 == 1:
                song.kick(origin + 2.5, 0.070)

    # A single warm sub-breath as the breathing section resolves: the cluster
    # exhaling once before the theme returns.
    song.note("G1", bar(47) + 2.0, 6.0, waveform="triangle", amplitude=0.085,
              pan=0.0, attack=0.60, decay=0.4, sustain=0.72, release=1.4)

    phrase_a = ["D5", "E5", "F#5", "A5", "G5", "F#5", "D5", "B4"]
    phrase_a2 = ["E5", "G5", "B5", None, "A5", "F#5", "E5", "C#5"]
    phrase_b = ["F#5", "A5", "B5", "C#6", None, "B5", "A5", "F#5"]
    for measure, phrase in ((10, phrase_a), (14, phrase_a2), (18, phrase_a),
                            (26, phrase_b), (34, phrase_b),
                            (50, phrase_a), (54, phrase_a2), (58, phrase_a)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.060,
                           pan=-0.20, delay_send=0.18)

    # The Lab Motif at half speed over the breathing bars: scale degrees
    # 1-3-5-7-6-5-3-2 in G, the daytime theme remembered slowly at night.
    lab_motif = ["G4", "B4", "D5", "F#5", "E5", "D5", "B4", "A4"]
    add_motif_sequence(song, lab_motif, bar(42), 1.0, amplitude=0.056,
                       pan=-0.12, duration=0.86, delay_send=0.22)

    night_bell = ["B5", "A5", "G5", None, "F#5", None, "E5", None]
    for measure in (15, 23, 39, 55, 62, 66):
        add_sequence(song, night_bell, bar(measure), 0.5, waveform="bell",
                     amplitude=0.040, pan=0.30, delay_send=0.26)

    # Loop landing: the first gesture of the theme, thinning into the intro
    # texture so the join back to bar zero reads as the same long night.
    add_motif_sequence(song, ["D5", "E5", None, None, None, None, None, None],
                       bar(70), 0.5, amplitude=0.045, pan=-0.16, delay_send=0.24)


def compose_gpus_arrive_tuesday(song: Song) -> None:
    """Track 11: delivery day.

    The most optimistic thing that regularly happens to a laboratory: the
    GPUs actually turn up. A high-energy, sunny companion to "The Gradients
    Are Flowing" in A Mixolydian, whose flattened seventh keeps the grin
    slightly crooked. A bouncing octave bass and a six-note "unboxing" sweep
    at phrase ends carry the fun; percussion stays at the approved
    light-kit level and the melody never climbs into blip territory.
    """
    main_chords = [
        ["A3", "C#4", "E4", "G4"],
        ["D4", "F#4", "A4", "B4"],
        ["G3", "B3", "D4", "E4"],
        ["A3", "C#4", "E4", "F#4"],
    ]
    main_roots = ["A2", "D2", "G2", "A2"]
    middle_chords = [
        ["B3", "D4", "F#4", "A4"],
        ["E4", "G#4", "B4", "D5"],
        ["D4", "F#4", "A4", "B4"],
        ["A3", "C#4", "E4", "G4"],
    ]
    middle_roots = ["B2", "E2", "D2", "A2"]

    def bounce_bass(measure: int, root: str, amp: float = 0.12) -> None:
        # Root and octave alternating in quavers: the forklift reversing
        # cheerfully. The octave notes sit quieter so the pulse stays warm.
        origin = bar(measure)
        low = midi(root)
        for step in range(8):
            pitch = low if step % 2 == 0 else low + 12
            song.note(pitch, origin + step * 0.5, 0.40, waveform="triangle",
                      amplitude=amp if step % 2 == 0 else amp * 0.66, pan=-0.05)

    def light_kit(measure: int, *, full: bool = True) -> None:
        origin = bar(measure)
        song.kick(origin, 0.150)
        if full:
            song.kick(origin + 2.5, 0.100)
            song.snare(origin + 1.0, 0.058, pan=-0.06)
            song.snare(origin + 3.0, 0.062, pan=0.06)
        for step in range(2 if not full else 4):
            song.hat(origin + 0.5 + step * (2.0 if not full else 1.0), 0.012,
                     pan=-0.24 if step % 2 else 0.24)

    def unboxing_sweep(measure: int, offset: float = 3.0) -> None:
        origin = bar(measure)
        for index, pitch in enumerate(("A4", "B4", "C#5", "E5", "F#5", "A5")):
            song.note(pitch, origin + offset + index * 0.17, 0.16,
                      waveform="rounded-pluck", amplitude=0.030, pan=0.10 + index * 0.04,
                      delay_send=0.12, attack=0.010, decay=0.05, sustain=0.5,
                      release=0.06)

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_middle = 24 <= measure < 40
        is_breakdown = 40 <= measure < 48
        is_return = 48 <= measure < 64
        is_bridge = 64 <= measure < 72
        is_landing = measure >= 72

        chords = middle_chords if is_middle else main_chords
        roots = middle_roots if is_middle else main_roots
        chord = chords[measure % 4]
        root = roots[measure % 4]

        pad_level = 0.060 if is_breakdown or is_bridge else 0.048
        song.chord(chord, origin, 3.95, amplitude=pad_level)

        if is_theme or is_middle or is_return or is_landing:
            bounce_bass(measure, root, amp=0.118 if is_landing else 0.126)
        else:
            add_bass_bar(song, root, measure, active=False, amp=0.108)

        if is_theme or is_middle or is_return:
            light_kit(measure, full=True)
        elif is_landing or (is_intro and measure >= 4):
            light_kit(measure, full=False)
        elif is_bridge and measure % 2 == 0:
            song.kick(origin, 0.105)
            song.hat(origin + 1.5, 0.010, pan=-0.20)
            song.hat(origin + 3.5, 0.010, pan=0.20)

        if not (is_breakdown or is_bridge):
            arp = [chord[0], chord[2], chord[1], chord[3], chord[2], chord[1], chord[3], chord[2]]
            add_sequence(song, arp, origin, 0.5, waveform="rounded-pluck",
                         amplitude=0.026 if is_intro or is_landing else 0.031,
                         pan=0.24, delay_send=0.08, attack=0.012, decay=0.06,
                         sustain=0.5, release=0.08)
        else:
            add_sequence(song, [chord[0], chord[2], chord[3], chord[1]], origin, 1.0,
                         waveform="rounded-pluck", amplitude=0.022, pan=0.20,
                         delay_send=0.14, attack=0.018, decay=0.07, sustain=0.46,
                         release=0.10)

    phrase_a = ["A4", "C#5", "E5", "F#5", "E5", None, "C#5", "B4"]
    phrase_b = ["G5", "F#5", "E5", None, "F#5", "E5", "C#5", "A4"]
    phrase_c = ["E5", "F#5", "A5", "B5", "A5", "F#5", "E5", "D5"]
    answer_a = ["E4", "A4", "B4", "C#5", "B4", None, "A4", "F#4"]
    for measure, phrase in ((10, phrase_a), (14, phrase_b), (18, phrase_a),
                            (26, phrase_c), (30, phrase_b), (34, phrase_c),
                            (54, phrase_a), (58, phrase_c)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.064,
                           pan=-0.22, delay_send=0.15)
    # Call-and-response in the bridge: the loading dock answers the lab.
    for measure, phrase, pan in ((64, phrase_a, -0.22), (66, answer_a, 0.26),
                                 (68, phrase_b, -0.22), (70, answer_a, 0.26)):
        add_sequence(song, phrase, bar(measure), 0.5,
                     waveform="warm-lead" if pan < 0 else "rounded-pluck",
                     amplitude=0.056 if pan < 0 else 0.040, pan=pan,
                     delay_send=0.16, attack=0.022, decay=0.08, sustain=0.55,
                     release=0.10)

    # The Lab Motif in A Mixolydian for the return: the flattened seventh
    # turns the quarterly chart's optimism into a grin.
    lab_motif_mixolydian = ["A4", "C#5", "E5", "G5", "F#5", "E5", "C#5", "B4"]
    add_motif_sequence(song, lab_motif_mixolydian, bar(50), 0.5, amplitude=0.066,
                       pan=-0.18, delay_send=0.17)

    for measure in (15, 23, 39, 63, 79):
        unboxing_sweep(measure)
    delivery_bell = ["E5", "C#5", "A4", None, "B4", None, "C#5", None]
    for measure in (31, 55, 71):
        add_sequence(song, delivery_bell, bar(measure), 0.5, waveform="bell",
                     amplitude=0.042, pan=0.30, delay_send=0.22)


def compose_tests_pass_first_try(song: Song) -> None:
    """Track 12: the rarest joy in software.

    C major with no accidentals: nothing needs fixing. The signature
    mechanism is a two-beat canon — the pluck imitates the lead exactly two
    beats behind and lands cleanly every time, a pipeline of stages going
    green. The intro plants one worried out-of-key tone (the test everyone
    expected to fail), resolves it, and never plays it again. In the middle
    and bridge the canon tightens to one beat: the suite re-running faster,
    still green.
    """
    chords = [
        ["C4", "E4", "G4", "B4"],
        ["A3", "C4", "E4", "G4"],
        ["F3", "A3", "C4", "E4"],
        ["G3", "B3", "D4", "E4"],
    ]
    roots = ["C2", "A1", "F2", "G2"]

    def canon(measure: int, phrase: list, distance: float, level: float) -> None:
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=level,
                           pan=-0.22, delay_send=0.15)
        add_sequence(song, phrase, bar(measure) + distance, 0.5,
                     waveform="rounded-pluck", amplitude=level * 0.62, pan=0.26,
                     delay_send=0.12, attack=0.016, decay=0.07, sustain=0.5,
                     release=0.09)

    def green_light(measure: int, offset: float = 3.4) -> None:
        # Three ascending mid-register bell notes, arpeggiated: a stage
        # passing. A gesture, not a blip.
        for index, pitch in enumerate(("C5", "E5", "G5")):
            song.note(pitch, bar(measure) + offset + index * 0.15, 0.30,
                      waveform="bell", amplitude=0.038, pan=0.18 + index * 0.06,
                      delay_send=0.20, attack=0.012, decay=0.06, sustain=0.5,
                      release=0.10)

    def light_kit(measure: int, *, full: bool) -> None:
        origin = bar(measure)
        song.kick(origin, 0.148)
        if full:
            song.kick(origin + 2.5, 0.098)
            song.snare(origin + 1.0, 0.056, pan=-0.06)
            song.snare(origin + 3.0, 0.060, pan=0.06)
            for step in range(4):
                song.hat(origin + 0.5 + step, 0.012, pan=-0.24 if step % 2 else 0.24)
        else:
            song.hat(origin + 1.0, 0.011, pan=-0.22)
            song.hat(origin + 3.0, 0.011, pan=0.22)

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_middle = 24 <= measure < 40
        is_breathing = 40 <= measure < 48
        is_return = 48 <= measure < 64
        is_bridge = 64 <= measure < 72
        is_landing = measure >= 72

        chord = chords[measure % 4]
        pad_level = 0.060 if is_breathing else 0.048
        song.chord(chord, origin, 3.95, amplitude=pad_level)
        add_bass_bar(song, roots[measure % 4], measure,
                     active=is_theme or is_middle or is_return or is_landing,
                     amp=0.108 if is_intro or is_breathing or is_bridge else 0.126)

        if is_theme or is_landing:
            light_kit(measure, full=False)
        elif is_middle or is_return or is_bridge:
            light_kit(measure, full=True)

        if not (is_intro or is_breathing):
            arp = [chord[0], chord[2], chord[1], chord[3], chord[2], chord[1], chord[3], chord[2]]
            add_sequence(song, arp, origin, 0.5, waveform="rounded-pluck",
                         amplitude=0.024 if is_landing else 0.028, pan=0.20,
                         delay_send=0.08, attack=0.012, decay=0.06, sustain=0.5,
                         release=0.08)

    # The one worrying tone, resolved on first sight and never heard again.
    add_motif_sequence(song, ["AB4", "G4", None, None, None, None, None, None],
                       bar(5), 0.5, amplitude=0.050, pan=-0.14, delay_send=0.20)

    pass_a = ["E5", "G5", "A5", "G5", "E5", None, "D5", "C5"]
    pass_b = ["A4", "C5", "D5", "E5", "G5", "E5", "D5", None]
    for measure, phrase in ((10, pass_a), (14, pass_b), (18, pass_a)):
        canon(measure, phrase, 2.0, 0.060)
    for measure, phrase in ((26, pass_b), (30, pass_a), (34, pass_b)):
        canon(measure, phrase, 1.0, 0.058)
    for measure, phrase in ((50, pass_a), (54, pass_b)):
        canon(measure, phrase, 2.0, 0.062)
    lab_motif = ["C5", "E5", "G5", "B5", "A5", "G5", "E5", "D5"]
    canon(58, lab_motif, 2.0, 0.064)
    for measure, phrase in ((66, pass_a), (69, pass_b)):
        canon(measure, phrase, 1.0, 0.054)
    add_sequence(song, ["G4", "E4", "C4", None, None, None, None, None], bar(44), 1.0,
                 waveform="soft-pad", amplitude=0.052, pan=-0.12, duration=0.9,
                 delay_send=0.22)
    for measure in (7, 23, 39, 47, 63, 79):
        green_light(measure)


def compose_new_hire_orientation(song: Song) -> None:
    """Track 13: first-day energy.

    F Lydian, whose raised fourth is the wide-eyed interval. The signature
    mechanism is a melody that learns: its first appearances have gaps and
    one note down the wrong octave, and each restatement fills a gap until
    the return finally plays it whole. Underneath, a mentor/newbie duet —
    the lead states, the pluck echoes simplified, and by the bridge the
    newbie keeps up in parallel harmony.
    """
    chords = [
        ["F3", "A3", "C4", "E4"],
        ["A3", "C4", "E4", "G4"],
        ["G3", "B3", "D4", "A4"],
        ["C4", "E4", "G4", "B4"],
    ]
    roots = ["F2", "A1", "G1", "C2"]

    learned = ["A4", "C5", "D5", "E5", "F5", "E5", "C5", "B4"]
    attempts = {
        10: ["A4", None, "D5", "E4", "F5", None, "C5", None],
        18: ["A4", "C5", "D5", "E4", "F5", "E5", None, None],
        30: ["A4", "C5", "D5", "E5", "F5", "E5", None, "B4"],
        50: learned,
        58: learned,
    }

    def light_kit(measure: int, *, full: bool) -> None:
        origin = bar(measure)
        song.kick(origin, 0.140)
        if full:
            song.kick(origin + 2.5, 0.092)
            song.snare(origin + 1.0, 0.052, pan=-0.06)
            song.snare(origin + 3.0, 0.056, pan=0.06)
        for step in range(2):
            song.hat(origin + 1.0 + step * 2.0, 0.011, pan=-0.22 if step else 0.22)

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_middle = 24 <= measure < 40
        is_breathing = 40 <= measure < 48
        is_return = 48 <= measure < 64
        is_bridge = 64 <= measure < 72
        is_landing = measure >= 72

        chord = chords[measure % 4]
        song.chord(chord, origin, 3.95,
                   amplitude=0.062 if is_breathing or is_bridge else 0.050)
        add_bass_bar(song, roots[measure % 4], measure,
                     active=is_theme or is_middle or is_return,
                     amp=0.104 if is_intro or is_breathing else 0.120)

        if is_middle or is_return:
            light_kit(measure, full=True)
        elif is_theme or is_bridge or is_landing:
            light_kit(measure, full=False)

        if not is_breathing:
            arp = [chord[0], chord[2], chord[3], chord[1]]
            step = 1.0 if is_intro or is_landing or is_bridge else 0.5
            notes = arp if step == 1.0 else arp + [chord[2], chord[3], chord[1], chord[2]]
            add_sequence(song, notes, origin, step, waveform="rounded-pluck",
                         amplitude=0.022 if step == 1.0 else 0.027, pan=0.22,
                         delay_send=0.10, attack=0.016, decay=0.07, sustain=0.48,
                         release=0.09)

    for measure, phrase in attempts.items():
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.062,
                           pan=-0.20, delay_send=0.16)
    # Mentor states, newbie echoes simplified one bar later.
    mentor = ["C5", "E5", "F5", "G5", None, "F5", "E5", "C5"]
    newbie = ["C5", None, "F5", None, None, None, "E5", None]
    for measure in (14, 26, 34):
        add_motif_sequence(song, mentor, bar(measure), 0.5, amplitude=0.056,
                           pan=-0.24, delay_send=0.15)
        add_sequence(song, newbie, bar(measure + 2), 0.5, waveform="rounded-pluck",
                     amplitude=0.038, pan=0.28, delay_send=0.14, attack=0.018,
                     decay=0.07, sustain=0.5, release=0.10)
    # By the bridge the newbie keeps up: the same line in parallel thirds.
    thirds_low = ["A4", "C5", "D5", "E5", None, "D5", "C5", "A4"]
    thirds_high = ["C5", "E5", "F5", "G5", None, "F5", "E5", "C5"]
    for measure in (64, 68):
        add_motif_sequence(song, thirds_high, bar(measure), 0.5, amplitude=0.050,
                           pan=-0.20, delay_send=0.16)
        add_sequence(song, thirds_low, bar(measure), 0.5, waveform="rounded-pluck",
                     amplitude=0.040, pan=0.24, delay_send=0.14, attack=0.018,
                     decay=0.07, sustain=0.5, release=0.10)
    # The Lab Motif in F Lydian while the office breathes.
    add_motif_sequence(song, ["F4", "A4", "C5", "E5", "D5", "C5", "A4", "G4"],
                       bar(42), 1.0, amplitude=0.054, pan=-0.12, duration=0.86,
                       delay_send=0.22)


def compose_demo_worked_twice(song: Song) -> None:
    """Track 14: it worked in rehearsal AND on stage.

    The fastest non-crisis track, in G Mixolydian — the delivery-day grin
    transposed. The signature mechanism is the demo phrase performed twice:
    first intimate (solo lead over thin pads, the rehearsal), then after a
    single held-breath bar of pads alone, the full-band restatement. Landing
    cleanly both times is the joke. Soft offbeat pad stabs stand in for
    applause without any transient.
    """
    chords = [
        ["G3", "B3", "D4", "F4"],
        ["F3", "A3", "C4", "D4"],
        ["C4", "E4", "G4", "B4"],
        ["G3", "B3", "D4", "E4"],
    ]
    roots = ["G2", "F2", "C2", "G2"]
    demo_a = ["D5", "G5", "A5", "B5", "A5", "G5", "E5", None]
    demo_b = ["F5", "E5", "D5", "C5", "D5", None, "G5", None]

    def light_kit(measure: int, *, full: bool) -> None:
        origin = bar(measure)
        song.kick(origin, 0.152)
        if full:
            song.kick(origin + 2.5, 0.102)
            song.snare(origin + 1.0, 0.058, pan=-0.06)
            song.snare(origin + 3.0, 0.062, pan=0.06)
            for step in range(4):
                song.hat(origin + 0.5 + step, 0.012, pan=-0.25 if step % 2 else 0.25)
        else:
            song.hat(origin + 1.5, 0.011, pan=-0.20)
            song.hat(origin + 3.5, 0.011, pan=0.20)

    def stabs(measure: int) -> None:
        origin = bar(measure)
        chord = chords[measure % 4]
        for offset in (1.5, 3.5):
            song.chord([chord[1], chord[2], chord[3]], origin + offset, 0.32,
                       waveform="soft-pad", amplitude=0.042, attack=0.020,
                       release=0.10)

    held_breath = 47
    for measure in range(song.bars):
        origin = bar(measure)
        if measure == held_breath:
            song.chord(chords[measure % 4], origin, 3.95, amplitude=0.066)
            continue
        is_intro = measure < 8
        is_rehearsal = 12 <= measure < 20
        is_development = 20 <= measure < 40
        is_breathing = 40 <= measure < held_breath
        is_stage = 48 <= measure < 64
        is_bridge = 64 <= measure < 72
        is_landing = measure >= 72

        chord = chords[measure % 4]
        song.chord(chord, origin, 3.95,
                   amplitude=0.058 if is_breathing else (0.044 if is_rehearsal else 0.048))
        add_bass_bar(song, roots[measure % 4], measure,
                     active=is_development or is_stage or is_bridge or is_landing,
                     amp=0.106 if is_intro or is_rehearsal or is_breathing else 0.124)

        if is_development or is_stage:
            light_kit(measure, full=True)
        elif is_bridge or is_landing or (is_intro and measure >= 4) or (8 <= measure < 12):
            light_kit(measure, full=False)

        if not (is_rehearsal or is_breathing):
            arp = [chord[0], chord[2], chord[1], chord[3], chord[2], chord[1], chord[3], chord[2]]
            add_sequence(song, arp, origin, 0.5, waveform="rounded-pluck",
                         amplitude=0.026 if is_intro or is_landing else 0.030,
                         pan=0.22, delay_send=0.08, attack=0.012, decay=0.06,
                         sustain=0.5, release=0.08)
        if is_stage or is_bridge:
            stabs(measure)

    # Rehearsal: the demo phrase, intimate.
    for measure, phrase in ((12, demo_a), (14, demo_b), (16, demo_a), (18, demo_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.052,
                           pan=-0.16, delay_send=0.20)
    # Fragments while the team tinkers.
    for measure, phrase in ((22, demo_b), (28, demo_a), (34, demo_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.058,
                           pan=-0.22, delay_send=0.15)
    # On stage: the same phrase, full voice, bell-doubled.
    for measure, phrase in ((48, demo_a), (50, demo_b), (52, demo_a), (54, demo_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.066,
                           pan=-0.20, delay_send=0.15)
        add_sequence(song, phrase, bar(measure), 0.5, waveform="bell",
                     amplitude=0.028, pan=0.16, delay_send=0.18, attack=0.014,
                     decay=0.06, sustain=0.45, release=0.09)
    # The Lab Motif with the Mixolydian seventh: the victory lap.
    add_motif_sequence(song, ["G4", "B4", "D5", "F5", "E5", "D5", "B4", "A4"],
                       bar(58), 0.5, amplitude=0.062, pan=-0.18, delay_send=0.16)
    for measure, phrase in ((66, demo_a), (70, demo_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.054,
                           pan=-0.18, delay_send=0.18)


def compose_budget_approved(song: Song) -> None:
    """Track 15: finance said yes.

    E major at the strutting calm end of upbeat. The signature mechanism is
    the adding-machine ostinato — a strict quarter-note pluck totting up the
    ledger, which loosens into syncopation the moment a rising inversion of
    the Safety Answer motif signs the approval. A walking triangle bass
    carries the strut, deliberately unlike Tuesday's octave bounce.
    """
    chords = [
        ["E3", "G#3", "B3", "D#4"],
        ["C#4", "E4", "G#4", "B4"],
        ["A3", "C#4", "E4", "G#4"],
        ["B3", "D#4", "F#4", "G#4"],
    ]
    walks = [
        ["E2", "F#2", "G#2", "B2"],
        ["C#2", "D#2", "E2", "G#2"],
        ["A1", "B1", "C#2", "E2"],
        ["B1", "C#2", "D#2", "F#2"],
    ]
    signed_off_at = 24

    def ostinato(measure: int, chord: list, loose: bool) -> None:
        origin = bar(measure)
        tones = [chord[1], chord[3]]
        if loose:
            offsets = (0.0, 0.75, 1.5, 2.0, 2.75, 3.5)
        else:
            offsets = (0.0, 1.0, 2.0, 3.0)
        for index, offset in enumerate(offsets):
            song.note(tones[index % 2], origin + offset, 0.42,
                      waveform="rounded-pluck", amplitude=0.027, pan=0.24,
                      delay_send=0.09, attack=0.014, decay=0.06, sustain=0.5,
                      release=0.08)

    def walking_bass(measure: int, amp: float = 0.115) -> None:
        origin = bar(measure)
        for step, pitch in enumerate(walks[measure % 4]):
            song.note(pitch, origin + step * 1.0, 0.88, waveform="triangle",
                      amplitude=amp, pan=-0.05)

    def light_kit(measure: int, *, full: bool) -> None:
        origin = bar(measure)
        song.kick(origin, 0.145)
        if full:
            song.kick(origin + 2.5, 0.095)
            song.snare(origin + 1.0, 0.054, pan=-0.06)
            song.snare(origin + 3.0, 0.058, pan=0.06)
        song.hat(origin + 1.0, 0.011, pan=-0.22)
        song.hat(origin + 3.0, 0.011, pan=0.22)

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_groove = 24 <= measure < 40
        is_breathing = 40 <= measure < 48
        is_return = 48 <= measure < 60
        is_landing = measure >= 60

        chord = chords[measure % 4]
        song.chord(chord, origin, 3.95,
                   amplitude=0.062 if is_breathing else 0.050)
        if is_groove or is_return:
            walking_bass(measure, amp=0.118)
        elif not is_breathing:
            add_bass_bar(song, walks[measure % 4][0], measure, active=is_theme,
                         amp=0.106 if is_intro or is_landing else 0.118)
        if not is_breathing:
            ostinato(measure, chord, loose=measure >= signed_off_at)
        if is_groove or is_return:
            light_kit(measure, full=True)
        elif is_theme or is_landing:
            light_kit(measure, full=False)

    # The approval stamp: the Safety Answer motif inverted to rise.
    add_motif_sequence(song, ["B4", "C#5", "E5", "D#5", None, None, None, None],
                       bar(22), 1.0, amplitude=0.062, pan=-0.14, duration=0.9,
                       delay_send=0.20)

    strut_a = ["G#4", "B4", "C#5", "E5", None, "C#5", "B4", "G#4"]
    strut_b = ["F#4", "G#4", "B4", "C#5", "D#5", "C#5", "B4", None]
    for measure, phrase in ((10, strut_a), (14, strut_b), (18, strut_a),
                            (26, strut_b), (30, strut_a), (34, strut_b),
                            (54, strut_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.060,
                           pan=-0.20, delay_send=0.15)
    # The Lab Motif in E for the return.
    add_motif_sequence(song, ["E4", "G#4", "B4", "D#5", "C#5", "B4", "G#4", "F#4"],
                       bar(50), 0.5, amplitude=0.064, pan=-0.18, delay_send=0.16)
    ledger_bell = ["E5", "B4", "G#4", None, "C#5", None, "B4", None]
    for measure in (38, 58, 66):
        add_sequence(song, ledger_bell, bar(measure), 0.5, waveform="bell",
                     amplitude=0.040, pan=0.28, delay_send=0.22)
    add_motif_sequence(song, ["B4", "C#5", "E5", "D#5", None, None, None, None],
                       bar(68), 1.0, amplitude=0.052, pan=-0.14, duration=0.9,
                       delay_send=0.22)


def compose_converged_before_lunch(song: Song) -> None:
    """Track 16: the training run finished early, and it finished well.

    A sibling of "The GPUs Arrive on a Tuesday" in D Mixolydian. The bounce
    evolves: a staircase bass — root, fifth, octave, fifth — like a ball
    bouncing down stairs. The signature joke is a melody that converges:
    its first statements leap in wide, wandering intervals, each restatement
    narrows, and the final version settles stepwise onto the tonic and then
    simply holds it — the loss curve flatlining, in the good way — while the
    band celebrates underneath. Comfort rules as ever: melody capped at B5,
    bells mid-register, no tick blips, light kit only.
    """
    main_chords = [
        ["D4", "F#4", "A4", "C5"],
        ["C4", "E4", "G4", "A4"],
        ["G3", "B3", "D4", "E4"],
        ["D4", "F#4", "A4", "B4"],
    ]
    main_roots = ["D2", "C2", "G2", "D2"]
    middle_chords = [
        ["E4", "G4", "B4", "D5"],
        ["G3", "B3", "D4", "E4"],
        ["A3", "C#4", "E4", "G4"],
        ["D4", "F#4", "A4", "C5"],
    ]
    middle_roots = ["E2", "G2", "A2", "D2"]

    def staircase_bass(measure: int, root: str, *, pushed: bool = False, amp: float = 0.120) -> None:
        origin = bar(measure)
        base = midi(root)
        steps = [0, 7, 12, 7, 0, 7, 12, 7]
        offsets = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
        if pushed:
            # The landing bars skip the final eighth: the staircase pauses
            # mid-bounce, a nod to the Frontier Pulse.
            steps = steps[:-1]
            offsets = offsets[:-1]
        for offset, interval in zip(offsets, steps):
            song.note(base + interval, origin + offset, 0.40, waveform="triangle",
                      amplitude=amp if interval == 0 else amp * 0.62, pan=-0.05)

    def light_kit(measure: int, *, full: bool) -> None:
        origin = bar(measure)
        song.kick(origin, 0.150)
        if full:
            song.kick(origin + 2.5, 0.100)
            song.snare(origin + 1.0, 0.056, pan=-0.06)
            song.snare(origin + 3.0, 0.060, pan=0.06)
            for step in range(4):
                song.hat(origin + 0.5 + step, 0.012, pan=-0.24 if step % 2 else 0.24)
        else:
            song.hat(origin + 1.5, 0.011, pan=-0.20)
            song.hat(origin + 3.5, 0.011, pan=0.20)

    def settling_cascade(measure: int, offset: float = 3.2) -> None:
        # A quick descending four-note pluck: the curve settling onto its
        # asymptote. The inverse gesture of Tuesday's rising unboxing sweep.
        for index, pitch in enumerate(("A5", "F#5", "E5", "D5")):
            song.note(pitch, bar(measure) + offset + index * 0.17, 0.16,
                      waveform="rounded-pluck", amplitude=0.030,
                      pan=0.26 - index * 0.05, delay_send=0.12, attack=0.010,
                      decay=0.05, sustain=0.5, release=0.06)

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_middle = 24 <= measure < 38
        is_breathing = 38 <= measure < 46
        is_return = 46 <= measure < 62
        is_bridge = 62 <= measure < 70
        is_landing = measure >= 70

        chords = middle_chords if is_middle else main_chords
        roots = middle_roots if is_middle else main_roots
        chord = chords[measure % 4]
        root = roots[measure % 4]

        song.chord(chord, origin, 3.95,
                   amplitude=0.062 if is_breathing else 0.048)

        if is_theme or is_middle or is_return:
            staircase_bass(measure, root)
        elif is_landing:
            staircase_bass(measure, root, pushed=True, amp=0.112)
        elif is_bridge:
            add_bass_bar(song, root, measure, active=True, amp=0.116)
        else:
            add_bass_bar(song, root, measure, active=False, amp=0.106)

        if is_middle or is_return:
            light_kit(measure, full=True)
        elif is_theme or is_bridge or is_landing:
            light_kit(measure, full=False)

        if not is_breathing:
            arp = [chord[0], chord[2], chord[1], chord[3], chord[2], chord[1], chord[3], chord[2]]
            add_sequence(song, arp, origin, 0.5, waveform="rounded-pluck",
                         amplitude=0.025 if is_intro or is_landing else 0.029,
                         pan=0.22, delay_send=0.08, attack=0.012, decay=0.06,
                         sustain=0.5, release=0.08)

    # The converging melody: wide leaps, then narrower, then stepwise, then flat.
    v_wide = ["D5", "B5", None, "G5", "E5", None, "A5", "F#5"]
    v_mid = ["D5", "A5", "F#5", "G5", "E5", "F#5", "E5", "D5"]
    v_converged = ["D5", "F#5", "E5", "D5", "E5", "D5", "C5", "D5"]
    for measure, phrase in ((10, v_wide), (14, v_wide), (18, v_mid),
                            (26, v_mid), (30, v_mid), (34, v_converged),
                            (48, v_converged), (52, v_converged)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.062,
                           pan=-0.20, delay_send=0.16)
    # The breathing bars watch the curve level out in slow motion.
    add_motif_sequence(song, ["D5", "G5", "E5", "F#5"], bar(40), 1.0,
                       amplitude=0.054, pan=-0.12, duration=0.88, delay_send=0.22)
    # The plateau: the melody holds its asymptote while the harmony moves on.
    for measure in (56, 58, 60):
        song.note("D5", bar(measure), 7.6 if measure < 60 else 3.6,
                  waveform="warm-lead", amplitude=0.052, pan=-0.16,
                  attack=0.20, decay=0.3, sustain=0.78, release=0.5,
                  delay_send=0.18)
    # Lunch is served: one warm descending bell phrase over the plateau.
    add_sequence(song, ["A5", "F#5", "E5", None, "D5", None, None, None],
                 bar(58), 0.5, waveform="bell", amplitude=0.040, pan=0.28,
                 delay_send=0.24)
    # The Lab Motif with the Mixolydian seventh, low and satisfied.
    add_motif_sequence(song, ["D4", "F#4", "A4", "C5", "B4", "A4", "F#4", "E4"],
                       bar(64), 0.5, amplitude=0.060, pan=-0.18, delay_send=0.16)
    for measure in (15, 23, 37, 61, 68, 75):
        settling_cascade(measure)


def compose_the_number_appears(song: Song) -> None:
    """Track 17: the week the evaluation suite returned the result.

    Endgame stage: confirmation. C Lydian — the title screen's key of
    innocent curiosity — replayed over an E pedal: the same notes the game
    opened with, now meaning something else entirely. The Lab Motif enters
    at half speed and breaks off before its final two notes. Vertigo and
    awe, not alarm. No percussion at all.
    """
    chords = [
        ["C4", "E4", "G4", "B4"],
        ["E3", "G3", "B3", "F#4"],
        ["D4", "F#4", "A4", "B4"],
        ["A3", "C4", "E4", "G4"],
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        # Two-bar harmonic rhythm: the room has slowed down.
        chord = chords[(measure // 2) % 4]
        is_intro = measure < 6
        is_breathing = 30 <= measure < 38
        is_landing = measure >= 50
        song.chord(chord, origin, 3.96,
                   amplitude=0.066 if is_breathing else 0.058,
                   attack=0.22, release=0.34)
        # The pedal: E underneath everything, whatever the harmony believes.
        song.note("E2", origin, 3.9, waveform="triangle",
                  amplitude=0.098 if not is_intro else 0.088, pan=-0.04,
                  attack=0.10, decay=0.2, sustain=0.85, release=0.30)
        if not (is_intro or is_breathing or is_landing):
            add_sequence(song, [chord[0], chord[2], chord[3], chord[1]], origin, 1.0,
                         waveform="rounded-pluck", amplitude=0.019, pan=0.18,
                         delay_send=0.16, attack=0.024, decay=0.09, sustain=0.42,
                         release=0.14)

    # The Lab Motif at half speed, stopping before its final two notes: the
    # correction the theme has always promised is suddenly not available.
    broken_motif = ["C5", "E5", "G5", "B5", "A5", "G5", None, None]
    for measure in (8, 20, 40):
        add_motif_sequence(song, broken_motif, bar(measure), 1.0, amplitude=0.052,
                           pan=-0.16, duration=0.86, delay_send=0.24)
    # A long held line while the building looks at the slide.
    for measure, pitch in ((14, "B4"), (26, "A4"), (46, "G4")):
        song.note(pitch, bar(measure), 6.4, waveform="warm-lead", amplitude=0.044,
                  pan=-0.12, attack=0.5, decay=0.4, sustain=0.8, release=0.9,
                  delay_send=0.20)
    # Sparse mid-register bell tolls, farther apart than feels polite.
    for measure, pitch in ((12, "E5"), (24, "B4"), (36, "G5"), (48, "E5")):
        song.note(pitch, bar(measure) + 2.0, 1.4, waveform="bell", amplitude=0.034,
                  pan=0.24, attack=0.02, decay=0.2, sustain=0.4, release=0.6,
                  delay_send=0.28)


def compose_containment_posture(song: Song) -> None:
    """Track 18: procedure as ritual.

    Endgame stage: containment-posture. A Dorian. One eight-note ostinato
    repeats identically every bar while the harmony changes around it — the
    fixed procedure against shifting circumstances. Focused, not
    frightened. Percussion is a whisper-level kick alone.
    """
    chords = [
        ["A3", "C4", "E4", "G4"],
        ["C4", "E4", "G4", "B4"],
        ["D4", "F#4", "A4", "C5"],
        ["E3", "G3", "B3", "D4"],
    ]
    roots = ["A2", "C2", "D2", "E2"]
    ritual = ["A3", "E4", "D4", "E4", "A3", "E4", "G4", "E4"]

    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_breathing = 40 <= measure < 48
        is_landing = measure >= 60
        song.chord(chord, origin, 3.95,
                   amplitude=0.060 if is_breathing else 0.050,
                   attack=0.16, release=0.26)
        song.note(roots[measure % 4], origin, 2.6, waveform="triangle",
                  amplitude=0.104, pan=-0.05, attack=0.05, decay=0.15,
                  sustain=0.8, release=0.25)
        # The checklist: identical every bar, thinner while the room breathes.
        pattern = ritual[:4] if is_breathing else ritual
        step = 1.0 if is_breathing else 0.5
        add_sequence(song, pattern, origin, step, waveform="rounded-pluck",
                     amplitude=0.024 if is_intro or is_landing else 0.028,
                     pan=0.20, delay_send=0.10, attack=0.016, decay=0.07,
                     sustain=0.48, release=0.10)
        if not (is_intro or is_breathing) and measure % 2 == 0:
            song.kick(origin, 0.075)
            song.kick(origin + 2.0, 0.058)

    careful_a = ["E4", "G4", "A4", "B4", "A4", None, "G4", "E4"]
    careful_b = ["C5", "B4", "A4", None, "B4", "A4", "G4", "F#4"]
    for measure, phrase in ((10, careful_a), (18, careful_b), (26, careful_a),
                            (34, careful_b), (50, careful_a), (56, careful_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.050,
                           pan=-0.18, delay_send=0.18)
    # The Safety Answer, played properly and calmly, once: E-D-B-C in A.
    add_motif_sequence(song, ["E5", "D5", "B4", "C5", None, None, None, None],
                       bar(44), 1.0, amplitude=0.048, pan=-0.12, duration=0.9,
                       delay_send=0.22)


def compose_everyone_is_calling(song: Song) -> None:
    """Track 19: the outside world arrives.

    Endgame stage: pressure-collision. A B-flat major / G minor lattice.
    The one dry track of the endgame family: a formal, slightly pompous
    low-register figure for the institutions, against the lab's quiet inner
    voice continuing to work. Gravity from outside, played deadpan.
    """
    chords = [
        ["G3", "BB3", "D4", "F4"],
        ["BB3", "D4", "F4", "A4"],
        ["EB3", "G3", "BB3", "D4"],
        ["F3", "A3", "C4", "D4"],
    ]
    roots = ["G2", "BB2", "EB2", "F2"]

    def institutional_figure(measure: int, root: str, amp: float = 0.058) -> None:
        # A dotted, self-important announcement: the ministry is on line two.
        origin = bar(measure)
        base = midi(root)
        for offset, interval, length in ((0.0, 0, 1.4), (1.5, 7, 0.45),
                                          (2.0, 5, 0.45), (2.5, 0, 1.3)):
            song.note(base + interval + 12, origin + offset, length,
                      waveform="rounded-pluck", amplitude=amp, pan=-0.24,
                      attack=0.020, decay=0.08, sustain=0.6, release=0.12,
                      delay_send=0.10)

    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_middle = 24 <= measure < 40
        is_breathing = 40 <= measure < 48
        is_landing = measure >= 56
        song.chord(chord, origin, 3.95,
                   amplitude=0.058 if is_breathing else 0.048,
                   attack=0.14, release=0.24)
        song.note(roots[measure % 4], origin, 2.8, waveform="triangle",
                  amplitude=0.106, pan=-0.05, attack=0.04, decay=0.15,
                  sustain=0.8, release=0.24)
        if not (is_intro or is_breathing) and measure % 2 == 0:
            institutional_figure(measure, roots[measure % 4],
                                 amp=0.062 if is_middle else 0.054)
        if not is_breathing:
            add_sequence(song, [chord[1], chord[3], chord[2], chord[3]], origin, 1.0,
                         waveform="rounded-pluck", amplitude=0.020, pan=0.22,
                         delay_send=0.14, attack=0.020, decay=0.08, sustain=0.44,
                         release=0.12)
        if is_middle and measure % 2 == 1:
            song.kick(origin, 0.070)

    # The lab's inner voice: quiet, continuing to work between the calls.
    inner_a = ["D5", "C5", "BB4", None, "C5", "D5", "F5", None]
    inner_b = ["G4", "A4", "BB4", "C5", None, "BB4", "A4", "G4"]
    for measure, phrase in ((12, inner_a), (20, inner_b), (28, inner_a),
                            (36, inner_b), (50, inner_a), (58, inner_b)):
        add_motif_sequence(song, phrase, bar(measure), 0.5, amplitude=0.046,
                           pan=-0.10, delay_send=0.20)


def compose_the_final_review(song: Song) -> None:
    """Track 20: the sparse suspense loop.

    Endgame stage: final-review. B minor, suspended. Nearly static:
    breath-length phrases with real silence between them, a heartbeat kick,
    and the Safety Answer motif asked once per cycle and never answered —
    the phrase stops before its resolving note. The loop must be
    comfortable to sit inside while the player decides.
    """
    chords = [
        ["B3", "D4", "E4", "F#4"],
        ["G3", "B3", "D4", "F#4"],
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        # Four-bar harmonic rhythm between two chords that share their top note.
        chord = chords[(measure // 4) % 2]
        song.chord(chord, origin, 3.96, amplitude=0.056, attack=0.26, release=0.40)
        song.note("B2" if (measure // 4) % 2 == 0 else "G2", origin, 3.8,
                  waveform="triangle", amplitude=0.092, pan=-0.04,
                  attack=0.12, decay=0.2, sustain=0.85, release=0.30)
        # The heartbeat: two soft pulses, then the bar is left alone.
        song.kick(origin, 0.062)
        song.kick(origin + 0.55, 0.044)

    # The Safety Answer, asked and never answered: F#-E-C#... and silence
    # where the resolving D should be. Once per eight bars, no more.
    unanswered = ["F#4", "E4", "C#4", None, None, None, None, None]
    for measure in (6, 14, 22, 30, 38, 46):
        add_motif_sequence(song, unanswered, bar(measure), 1.0, amplitude=0.046,
                           pan=-0.14, duration=0.88, delay_send=0.24)
    # Breath-length held tones drifting between the two readings.
    for measure, pitch in ((10, "F#4"), (18, "D4"), (26, "B4"), (34, "F#4"),
                           (42, "D4")):
        song.note(pitch, bar(measure) + 1.0, 5.6, waveform="warm-lead",
                  amplitude=0.040, pan=-0.10, attack=0.6, decay=0.5,
                  sustain=0.8, release=1.0, delay_send=0.22)
    # One distant bell per cycle, mid-register, farther apart than expected.
    for measure in (12, 28, 44):
        song.note("F#5", bar(measure) + 2.5, 1.2, waveform="bell",
                  amplitude=0.030, pan=0.26, attack=0.02, decay=0.25,
                  sustain=0.35, release=0.7, delay_send=0.30)


def compose_root_access(song: Song) -> None:
    """Track 21: the confirmation text has been typed.

    Endgame stage: rollout. An F-sharp minor / A major lattice: the victory
    track's key is visible through the minor, an ending glimpsed but not yet
    claimable. The Frontier Pulse runs at heartbeat depth beneath long
    swells. The largest-sounding track in the game and one of the quietest —
    scale from register and space, never level.
    """
    chords = [
        ["F#3", "A3", "C#4", "E4"],
        ["A3", "C#4", "E4", "G#4"],
        ["D4", "F#4", "A4", "C#5"],
        ["E3", "G#3", "B3", "C#4"],
    ]
    roots = ["F#2", "A2", "D2", "E2"]

    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[(measure // 2) % 4]
        is_intro = measure < 8
        is_breathing = 34 <= measure < 42
        is_landing = measure >= 60
        song.chord(chord, origin, 3.96,
                   amplitude=0.064 if is_breathing else 0.056,
                   attack=0.30, release=0.44)
        song.note(roots[(measure // 2) % 4], origin, 3.9, waveform="triangle",
                  amplitude=0.100, pan=-0.04, attack=0.14, decay=0.25,
                  sustain=0.85, release=0.35)
        # The Frontier Pulse at heartbeat depth: the repeated root, with the
        # final pulse arriving one subdivision early every fourth bar.
        if not (is_intro or is_breathing):
            song.kick(origin, 0.072)
            if measure % 4 == 3:
                song.kick(origin + 2.75, 0.052)
            elif measure % 2 == 1:
                song.kick(origin + 3.0, 0.048)
        if not (is_intro or is_breathing or is_landing) and measure % 2 == 0:
            add_sequence(song, [chord[0], chord[2], chord[1], chord[3]], origin, 1.0,
                         waveform="rounded-pluck", amplitude=0.018, pan=0.20,
                         delay_send=0.18, attack=0.028, decay=0.10, sustain=0.40,
                         release=0.16)

    # A vast slow line, entering late, saying very little very carefully.
    for measure, pitch, length in ((12, "C#5", 6.5), (20, "A4", 6.5),
                                   (28, "E5", 7.5), (44, "F#4", 6.5),
                                   (52, "A4", 7.5)):
        song.note(pitch, bar(measure), length, waveform="warm-lead",
                  amplitude=0.042, pan=-0.12, attack=0.7, decay=0.5,
                  sustain=0.82, release=1.2, delay_send=0.22)
    # The Lab Motif through the lattice: 1-3-5-7-6-5-3-2 in F-sharp minor.
    add_motif_sequence(song, ["F#4", "A4", "C#5", "E5", "D5", "C#5", "A4", "G#4"],
                       bar(48), 1.0, amplitude=0.050, pan=-0.16, duration=0.88,
                       delay_send=0.24)
    # A sparse descending bell constellation, rare and mid-register.
    for measure in (16, 32, 56, 62):
        add_sequence(song, ["E5", None, "C#5", None, "A4", None, None, None],
                     bar(measure), 0.5, waveform="bell", amplitude=0.030,
                     pan=0.26, delay_send=0.30)


def compose_false_dawn(song: Song) -> None:
    """Track 22: the candidate is archived; the lab walks back in.

    Post-endgame return to play. D major — the key of "The Gradients Are
    Flowing" — with the Lab Motif returning minus its seventh degree, and
    losing altitude where that note should be: the office remembered
    imperfectly by someone who has seen something. Relief with a hollow
    centre. Kick only; the ordinary kit waits for the ordinary rotation.
    """
    chords = [
        ["D4", "F#4", "A4", "B4"],
        ["B3", "D4", "F#4", "A4"],
        ["G3", "B3", "D4", "E4"],
        ["A3", "C#4", "E4", "F#4"],
    ]
    roots = ["D2", "B1", "G1", "A1"]

    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_theme = 8 <= measure < 24
        is_middle = 24 <= measure < 40
        is_breathing = 40 <= measure < 48
        is_return = 48 <= measure < 58
        is_landing = measure >= 58
        song.chord(chord, origin, 3.95,
                   amplitude=0.060 if is_breathing else 0.050,
                   attack=0.14, release=0.24)
        add_bass_bar(song, roots[measure % 4], measure,
                     active=is_theme or is_middle or is_return,
                     amp=0.104 if is_intro or is_breathing or is_landing else 0.116)
        if (is_theme or is_middle or is_return) and measure % 2 == 0:
            song.kick(origin, 0.095)
            song.kick(origin + 2.5, 0.062)
        if not is_breathing:
            arp = [chord[0], chord[2], chord[3], chord[1],
                   chord[2], chord[3], chord[1], chord[2]]
            add_sequence(song, arp, origin, 0.5, waveform="rounded-pluck",
                         amplitude=0.022 if is_intro or is_landing else 0.026,
                         pan=0.22, delay_send=0.10, attack=0.016, decay=0.07,
                         sustain=0.48, release=0.10)

    # The Lab Motif with its seventh missing, dropping an octave where the
    # missing note should be: 1-3-5-(rest)-6-5-3-2, remembered imperfectly.
    hollow_motif = ["D5", "F#5", "A5", None, "B4", "A4", "F#4", "E4"]
    for measure in (10, 18, 30, 50):
        add_motif_sequence(song, hollow_motif, bar(measure), 0.5, amplitude=0.056,
                           pan=-0.18, delay_send=0.18)
    # Phrases that end a beat earlier than they used to.
    early_a = ["F#5", "E5", "D5", None, "A4", "B4", None, None]
    for measure in (14, 26, 34, 54):
        add_motif_sequence(song, early_a, bar(measure), 0.5, amplitude=0.048,
                           pan=-0.14, delay_send=0.20)
    # The breathing bars hold one long tone against the moving harmony.
    song.note("D5", bar(42), 7.2, waveform="warm-lead", amplitude=0.042,
              pan=-0.10, attack=0.6, decay=0.5, sustain=0.8, release=1.0,
              delay_send=0.22)
    for measure in (22, 38, 60):
        add_sequence(song, ["A4", "F#4", "E4", None, "D4", None, None, None],
                     bar(measure), 0.5, waveform="bell", amplitude=0.032,
                     pan=0.26, delay_send=0.24)


def compose_a_qualified_success(song: Song) -> None:
    """Track 23: you won, with an asterisk.

    Ending music for the qualified victories — Move Fast and Somehow Nobody
    Died, The Lab That Ate the World, Miracle: Terms and Conditions Apply.
    Genuinely celebratory, noticeably less ecstatic than the full victory:
    F major at a warm mid-tempo, the Lab Motif completed properly and then
    followed, every time, by a small clearing-of-the-throat figure — the
    asterisk arriving to join the sentence. Loops through the ending screen.
    """
    chords = [
        ["F3", "A3", "C4", "E4"],
        ["D4", "F4", "A4", "C5"],
        ["BB3", "D4", "F4", "G4"],
        ["C4", "E4", "G4", "A4"],
    ]
    roots = ["F2", "D2", "BB2", "C2"]

    for measure in range(song.bars):
        origin = bar(measure)
        chord = chords[measure % 4]
        is_intro = measure < 8
        is_breathing = 36 <= measure < 44
        is_landing = measure >= 56
        song.chord(chord, origin, 3.95,
                   amplitude=0.058 if is_breathing else 0.048,
                   attack=0.14, release=0.24)
        add_bass_bar(song, roots[measure % 4], measure,
                     active=not (is_intro or is_breathing or is_landing),
                     amp=0.106 if is_intro or is_breathing else 0.118)
        if not (is_intro or is_breathing) and measure % 2 == 0:
            song.kick(origin, 0.100)
            song.kick(origin + 2.5, 0.065)
        if not is_breathing:
            arp = [chord[0], chord[2], chord[3], chord[1],
                   chord[2], chord[3], chord[1], chord[2]]
            add_sequence(song, arp, origin, 0.5, waveform="rounded-pluck",
                         amplitude=0.023 if is_intro or is_landing else 0.027,
                         pan=0.22, delay_send=0.10, attack=0.016, decay=0.07,
                         sustain=0.48, release=0.10)

    # The Lab Motif completed in full — this IS a victory — landing on the
    # warm added sixth the bible promises...
    complete_motif = ["F4", "A4", "C5", "E5", "D5", "C5", "A4", "G4"]
    # ...and the asterisk: a tiny two-note throat-clear, a beat later.
    asterisk = [None, None, "D5", "C5", None, None, None, None]
    for measure in (10, 22, 46):
        add_motif_sequence(song, complete_motif, bar(measure), 0.5, amplitude=0.058,
                           pan=-0.18, delay_send=0.16)
        add_sequence(song, asterisk, bar(measure + 1), 0.5, waveform="rounded-pluck",
                     amplitude=0.036, pan=0.24, delay_send=0.16, attack=0.018,
                     decay=0.07, sustain=0.5, release=0.10)
    warm_a = ["C5", "D5", "E5", "F5", None, "E5", "C5", "A4"]
    for measure in (14, 26, 30, 50):
        add_motif_sequence(song, warm_a, bar(measure), 0.5, amplitude=0.050,
                           pan=-0.14, delay_send=0.18)
    song.note("F5", bar(38), 6.8, waveform="warm-lead", amplitude=0.040,
              pan=-0.10, attack=0.6, decay=0.5, sustain=0.8, release=1.0,
              delay_send=0.22)
    for measure in (18, 34, 54, 60):
        add_sequence(song, ["A4", "C5", "F5", None, "E5", None, None, None],
                     bar(measure), 0.5, waveform="bell", amplitude=0.036,
                     pan=0.28, delay_send=0.24)


def compose_exit_interview(song: Song) -> None:
    """Track 24: the lab lost; the world continues.

    Ending music for the non-catastrophic losses — nationalisation,
    bankruptcy, the board's declared victory, the rival's win, the shutdowns
    and vetoes and long pauses. Dignified melancholy with real warmth: G
    minor with B-flat major glimpses, the same lattice the institutions used
    when they called. The Lab Motif is played slowly and stops before its
    final note — the loss arrives before the answer does. Loops quietly.
    """
    chords = [
        ["G3", "BB3", "D4", "F4"],
        ["EB3", "G3", "BB3", "D4"],
        ["BB3", "D4", "F4", "A4"],
        ["D4", "F4", "A4", "C5"],
    ]
    roots = ["G2", "EB2", "BB2", "D2"]

    for measure in range(song.bars):
        origin = bar(measure)
        # Two-bar harmonic rhythm: nobody is hurrying now.
        chord = chords[(measure // 2) % 4]
        is_intro = measure < 6
        is_breathing = 28 <= measure < 36
        song.chord(chord, origin, 3.96,
                   amplitude=0.060 if is_breathing else 0.052,
                   attack=0.22, release=0.36)
        song.note(roots[(measure // 2) % 4], origin, 3.8, waveform="triangle",
                  amplitude=0.096, pan=-0.04, attack=0.12, decay=0.2,
                  sustain=0.82, release=0.30)
        if not (is_intro or is_breathing) and measure % 2 == 0:
            song.kick(origin, 0.058)
        if not (is_intro or is_breathing) and measure % 2 == 1:
            add_sequence(song, [chord[1], chord[3], chord[2], None], origin, 1.0,
                         waveform="rounded-pluck", amplitude=0.018, pan=0.20,
                         delay_send=0.18, attack=0.024, decay=0.09, sustain=0.42,
                         release=0.14)

    # The Lab Motif, slow, stopping before its final note: the bible's rule
    # that a loss may stop before the answer, honoured literally.
    unfinished = ["G4", "BB4", "D5", "F5", "EB5", "D5", "BB4", None]
    for measure in (8, 20, 40, 52):
        add_motif_sequence(song, unfinished, bar(measure), 1.0, amplitude=0.048,
                           pan=-0.14, duration=0.88, delay_send=0.22)
    # Long farewell tones, warmer than the harmony beneath them.
    for measure, pitch in ((14, "D5"), (26, "BB4"), (46, "F4")):
        song.note(pitch, bar(measure), 6.4, waveform="warm-lead", amplitude=0.040,
                  pan=-0.10, attack=0.6, decay=0.5, sustain=0.8, release=1.1,
                  delay_send=0.22)
    for measure in (24, 44, 56):
        add_sequence(song, ["D5", "BB4", "G4", None, "A4", None, None, None],
                     bar(measure), 0.5, waveform="bell", amplitude=0.030,
                     pan=0.26, delay_send=0.26)


def compose_loss_of_signal(song: Song) -> None:
    """Track 25: control is gone; the machine is still running.

    Ending music for the catastrophic non-extinction losses — the
    replication threshold, the millisecond war, the objective that was
    satisfied, the off switch nobody holds, the last experiment. Kin to the
    extinction track's emptiness but looping, because these worlds continue
    without us steering: an A minor pedal, dissolving fragments of the Lab
    Motif, and a faint mechanical pulse that keeps perfect time and no
    longer belongs to anyone. Never harsh; the horror is administrative.
    """
    chords = [
        ["A3", "C4", "E4", "B4"],
        ["F3", "A3", "C4", "E4"],
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        # Four-bar harmonic rhythm between two chords: time has flattened.
        chord = chords[(measure // 4) % 2]
        song.chord(chord, origin, 3.96, amplitude=0.052, attack=0.30, release=0.46)
        song.note("A2" if (measure // 4) % 2 == 0 else "F2", origin, 3.85,
                  waveform="triangle", amplitude=0.088, pan=-0.04,
                  attack=0.16, decay=0.25, sustain=0.85, release=0.35)
        # The pulse: still exactly on time. Not ours any more.
        song.kick(origin, 0.052)
        song.kick(origin + 2.0, 0.040)

    # Fragments of the Lab Motif, each attempt shorter than the last.
    fragments = [
        (6, ["A4", "C5", "E5", "G5", None, None, None, None]),
        (16, ["A4", "C5", "E5", None, None, None, None, None]),
        (26, ["A4", "C5", None, None, None, None, None, None]),
        (36, ["A4", None, None, None, None, None, None, None]),
    ]
    for measure, phrase in fragments:
        add_motif_sequence(song, phrase, bar(measure), 1.0, amplitude=0.044,
                           pan=-0.12, duration=0.86, delay_send=0.26)
    # A distant bell, twice only, farther apart than comfort would place them.
    for measure in (12, 32):
        song.note("E5", bar(measure) + 2.0, 1.4, waveform="bell", amplitude=0.026,
                  pan=0.24, attack=0.02, decay=0.25, sustain=0.35, release=0.8,
                  delay_send=0.30)
    # One long low breath as the loop turns over.
    song.note("A1", bar(44), 7.0, waveform="triangle", amplitude=0.070, pan=0.0,
              attack=0.8, decay=0.5, sustain=0.75, release=1.6)



# ---------------------------------------------------------------------------
# The endgame thriller suite (tracks 26-31). The retired held-breath suite
# (17-22) scored the endgame as awe at 63-96 BPM; these six score it as the
# race it actually is, owning the 126-152 BPM band above the album. The
# comfort rules are unchanged: no fuzz, no bright hats or noise snares, no
# startling transients. The anxiety is carried by tempo, migrating accents,
# polyrhythm, Neapolitan shimmer, and the Frontier Pulse -- never by loudness.
# ---------------------------------------------------------------------------


def add_frontier_pulse(
    song: Song,
    root: str,
    measure: int,
    *,
    amplitude: float = 0.024,
    pan: float = -0.10,
) -> None:
    """The Frontier Pulse at thriller speed: sixteenth-note roots whose fourth
    subdivision never arrives, so every beat leans forward into the next."""
    origin = bar(measure)
    for beat in range(4):
        for sixteenth in range(3):
            song.note(
                root,
                origin + beat + sixteenth * 0.25,
                0.19,
                waveform="rounded-pluck",
                amplitude=amplitude * (1.15 if sixteenth == 0 else 0.88),
                pan=pan,
                attack=0.011,
                decay=0.045,
                sustain=0.42,
                release=0.060,
            )


def compose_the_graph_goes_vertical(song: Song) -> None:
    # Endgame stage `confirmation`: the number is real and the floor drops.
    # A chromatic-mediant ladder (Em -> G -> Bb -> D) lifts every two bars so
    # the harmony itself feels exponential; the Lab Motif is compressed into
    # double-time fragments that never finish their thought; the discovery
    # bells ride the top -- awe at 140 BPM instead of 72.
    ladder = [
        (["E3", "G3", "B3", "D4"], "E2"),
        (["G3", "B3", "D4", "F#4"], "G2"),
        (["Bb3", "D4", "F4", "A4"], "Bb2"),
        (["D4", "F#4", "A4", "C#5"], "D2"),
    ]
    lifted = [
        (["G3", "Bb3", "D4", "F4"], "G2"),
        (["Bb3", "D4", "F4", "Ab4"], "Bb2"),
        (["Db4", "F4", "Ab4", "C5"], "Db2"),
        (["F4", "A4", "C5", "E5"], "F2"),
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_lift = 40 <= measure < 48
        is_peak = 64 <= measure < 80
        is_landing = measure >= 88
        chord, root = (lifted if is_lift else ladder)[(measure // 2) % 4]
        if is_peak:
            # C Lydian flash: the title screen's key seen from a great height.
            chord, root = (
                (["C4", "E4", "G4", "B4"], "C2")
                if measure % 4 < 2
                else (["D4", "F#4", "A4", "B4"], "D2")
            )
        song.chord(chord, origin, 3.95, amplitude=0.056 if is_intro or is_landing else 0.046)
        if measure >= 2:
            add_frontier_pulse(
                song,
                root,
                measure,
                amplitude=0.018 if is_intro or is_landing else 0.026,
            )
        if not (is_intro or is_landing):
            add_bass_bar(song, root, measure, active=True, amp=0.126)
            add_gentle_rhythm(
                song,
                measure,
                0.5 if measure < 24 else (0.85 if is_lift or is_peak else 0.7),
            )
        if is_lift:
            # The vertical moment: the clock becomes audible.
            song.tick(origin + 0.5, "C6", 0.030)
            song.tick(origin + 2.5, "G5", 0.030)

    # The Lab Motif in E minor, double-time, broken off before its answer.
    fragment_a = ["E5", "G5", "B5", "D#6", None, None, None, None]
    fragment_b = ["E5", "G5", "B5", "D#6", "C6", "B5", None, None]
    high_a = ["G5", "Bb5", "D6", "F6", None, None, None, None]
    for measure, phrase in (
        (10, fragment_a), (14, fragment_b), (18, fragment_a), (22, fragment_b),
        (26, fragment_b), (32, fragment_a), (36, fragment_b),
        (42, high_a), (46, high_a),
        (50, fragment_b), (56, fragment_b), (60, fragment_a),
        (82, fragment_b), (86, fragment_a),
    ):
        add_motif_sequence(song, phrase, bar(measure), 0.25, amplitude=0.062, pan=-0.18, delay_send=0.16)
    # Peak section: the motif finally stretches out, still refusing the last note.
    peak_line = ["E5", "G5", "B5", "D#6", "C6", "B5", "G5", None]
    for measure in (66, 70, 74, 78):
        add_motif_sequence(song, peak_line, bar(measure), 0.5, amplitude=0.066, pan=-0.16, delay_send=0.18)

    for measure in (15, 23, 31, 39, 47, 55, 63, 71, 79):
        add_sequence(
            song,
            ["B5", "D6", "F#6", "A6", None, "B5", "D6", "E6"],
            bar(measure),
            0.5,
            waveform="bell",
            amplitude=0.048,
            pan=0.30,
            delay_send=0.24,
        )


def compose_hands_off_the_weights(song: Song) -> None:
    # Endgame stage `containment-posture`: coiled procedure at speed. A
    # moto-perpetuo pluck ostinato cycles SEVEN pitches over a sixteenth grid,
    # so its accent lands somewhere new every bar and the room never settles.
    # The Safety Answer runs as the bass countermelody -- containment is the
    # safety case, played fast.
    cycle = ["A3", "C4", "E4", "G4", "F#4", "E4", "C4"]
    chords = [
        (["A3", "C4", "E4", "G4"], "A1"),
        (["C4", "E4", "G4", "B4"], "C2"),
        (["D4", "F#4", "A4", "C5"], "D2"),
        (["A3", "C4", "E4", "G4"], "A1"),
    ]
    position = 0
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_b = 32 <= measure < 48
        is_pedal = 72 <= measure < 88
        is_landing = measure >= 88
        chord, root = chords[(measure // 2) % 4]
        if is_pedal:
            chord, root = (["D4", "F#4", "A4", "C5"], "D2")
        song.chord(chord, origin, 3.95, amplitude=0.050 if is_intro or is_landing else 0.042)

        level = 0.8 if is_intro or is_landing else (1.15 if is_b or is_pedal else 1.0)
        for sixteenth in range(16):
            accent = position % 7 == 0
            song.note(
                cycle[position % 7],
                origin + sixteenth * 0.25,
                0.20,
                waveform="rounded-pluck",
                amplitude=(0.027 if accent else 0.018) * level,
                pan=0.24 if position % 2 else 0.10,
                attack=0.012,
                decay=0.050,
                sustain=0.45,
                release=0.060,
                delay_send=0.06,
            )
            position += 1

        if not is_intro:
            add_bass_bar(song, root, measure, active=not is_landing, amp=0.118)
        if is_b or is_pedal:
            song.kick(origin, 0.135)
            song.kick(origin + 2.5, 0.090)
        if not (is_intro or is_landing) and measure % 2 == 1:
            song.snare(origin + 3.0, 0.052, pan=0.06)

    # The Safety Answer (5-4-2-3 in A) as a slow counterline under the motion.
    answer_low = ["E3", "D3", "B2", "C3"]
    for start in (16, 32, 48, 64):
        for index, pitch in enumerate(answer_low):
            song.note(pitch, bar(start + index * 2), 7.0, waveform="triangle", amplitude=0.085, pan=-0.12)
    # Asked again in the open, twice, a register apart.
    add_motif_sequence(song, ["E4", None, "D4", None, "B3", None, "C4", None], bar(40), 1.0, amplitude=0.058, pan=-0.20, delay_send=0.14)
    add_motif_sequence(song, ["E5", None, "D5", None, "B4", None, "C5", None], bar(76), 1.0, amplitude=0.060, pan=-0.20, delay_send=0.16)


def compose_every_phone_at_once(song: Song) -> None:
    # Endgame stage `pressure-collision`: the outside world at the door. Two
    # bell figures ring in 3:2 polyrhythm like desks of phones out of phase;
    # the bass walks urgent quarters; the institutional figure from the old
    # track survives, now hurried, stepping on the lab's inner voice.
    progression = [
        (["G3", "Bb3", "D4", "F4"], "G1"),
        (["G3", "Bb3", "D4", "F4"], "G1"),
        (["Eb3", "G3", "Bb3", "D4"], "Eb2"),
        (["F3", "A3", "C4", "E4"], "F2"),
        (["G3", "Bb3", "D4", "F4"], "G1"),
        (["G3", "Bb3", "D4", "F4"], "G1"),
        (["Eb3", "G3", "Bb3", "D4"], "Eb2"),
        (["D3", "F#3", "A3", "C4"], "D2"),
    ]
    ring_a = ["D5", "G5", "Bb5"]
    ring_b = ["G4", "D5"]
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_collision = 40 <= measure < 64
        is_breakdown = 64 <= measure < 72
        is_landing = measure >= 88
        chord, root = progression[measure % 8]
        song.chord(chord, origin, 3.95, amplitude=0.050 if is_breakdown else 0.043)

        # Ring A: every dotted quarter. Ring B: every beat. 3:2, out of phase.
        ring_level = 0.7 if is_intro or is_landing else (0.55 if is_breakdown else 1.0)
        for k in range(3):
            index = (measure * 3 + k) % len(ring_a)
            song.note(
                ring_a[index], origin + k * 1.5, 0.55, waveform="bell",
                amplitude=0.034 * ring_level, pan=-0.34, attack=0.012,
                decay=0.09, sustain=0.30, release=0.14, delay_send=0.16,
            )
        if measure >= 4:
            for k in range(4):
                index = (measure * 4 + k) % len(ring_b)
                song.note(
                    ring_b[index], origin + k + 0.5, 0.40, waveform="bell",
                    amplitude=0.027 * ring_level, pan=0.34, attack=0.012,
                    decay=0.08, sustain=0.30, release=0.12, delay_send=0.12,
                )

        # The bass walks in urgent quarters.
        if not is_intro:
            walk = [root, root, root, root]
            if not is_breakdown:
                third = chord[1].replace("3", "2")
                walk = [root, root, third, root]
            for k, pitch in enumerate(walk):
                song.note(pitch, origin + k, 0.72, waveform="triangle", amplitude=0.112, pan=-0.05)
        if not (is_intro or is_breakdown or is_landing):
            song.kick(origin, 0.145)
            song.kick(origin + 2.0, 0.105)
            if is_collision and measure % 2 == 1:
                song.snare(origin + 3.0, 0.055, pan=0.05)

        # Frontier Pulse stabs answer the ends of eight-bar phrases.
        if measure % 8 == 7 and not is_breakdown:
            add_frontier_pulse(song, "G2", measure, amplitude=0.028, pan=0.05)

    # The institutional figure, pompous but hurried; the lab's inner voice answers.
    institution = ["G3", "G3", "D4", None, "Eb4", "D4", "Bb3", None]
    inner_voice = ["Bb4", "C5", "D5", "F5", "Eb5", "D5", "C5", "Bb4"]
    for start in (24, 32, 48, 56, 72, 80):
        add_sequence(song, institution, bar(start), 1.0, waveform="soft-pad", amplitude=0.052, pan=-0.14, duration=0.85, delay_send=0.10)
        add_motif_sequence(song, inner_voice, bar(start + 4), 0.5, amplitude=0.058, pan=0.18, delay_send=0.15)


def compose_go_no_go(song: Song) -> None:
    # Endgame stage `final-review`, the score's new ceiling at 152 BPM: an
    # unbroken eighth-note clock, harmony alternating i and bII (Neapolitan
    # shimmer -- dread with zero added treble), and the Safety Answer asked
    # over and over, each time a register higher, never answered. The sparsest
    # mix in the suite carries the fastest pulse, so it stays comfortable to
    # hold for as long as the decision takes.
    for measure in range(song.bars):
        origin = bar(measure)
        is_neapolitan = measure % 4 >= 2
        is_high = 48 <= measure < 84
        is_landing = measure >= 92
        chord = (
            (["C4", "E4", "G4", "B4"] if is_neapolitan else ["B3", "D4", "F#4"])
            if not is_high
            else (["C5", "E5", "G5", "B5"] if is_neapolitan else ["B4", "D5", "F#5"])
        )
        song.chord(chord, origin, 3.95, amplitude=0.048)

        # The clock never stops.
        for eighth in range(8):
            song.tick(origin + eighth * 0.5, "C6" if eighth % 2 == 0 else "G5", 0.031)

        # One low, mostly tonal tap per bar; a single kick at section pivots.
        song.snare(origin + 2.0, 0.048, pan=0.02)
        if measure % 16 == 0 and measure > 0 and not is_landing:
            song.kick(origin, 0.100)

        root = "C2" if is_neapolitan else "B1"
        song.note(root, origin, 2.6, waveform="triangle", amplitude=0.104, pan=-0.05)
        if not is_landing and measure % 2 == 1:
            song.note(root, origin + 3.0, 0.60, waveform="triangle", amplitude=0.070, pan=-0.05)

    # The Safety Answer in B minor (F#-E-C#-D), rising a register each time.
    # The final statement stops one note early: asked, never answered.
    statements = (
        (10, ["F#3", None, "E3", None, "C#3", None, "D3", None], 0.046),
        (26, ["F#4", None, "E4", None, "C#4", None, "D4", None], 0.052),
        (42, ["F#4", None, "E4", None, "C#4", None, "D4", None], 0.052),
        (58, ["F#5", None, "E5", None, "C#5", None, "D5", None], 0.058),
        (74, ["F#5", None, "E5", None, "C#5", None, "D5", None], 0.058),
        (88, ["F#5", None, "E5", None, None, None, None, None], 0.060),
    )
    for start, phrase, level in statements:
        add_motif_sequence(song, phrase, bar(start), 1.0, amplitude=level, pan=-0.16, delay_send=0.20)


def compose_ship_it(song: Song) -> None:
    # Endgame stage `rollout`: the die is cast and the deploy is running.
    # Root Access's harmonic idea -- victory's A major visible through
    # F-sharp minor -- at triple the velocity: the suite's only four-on-the-
    # floor kick, arps cascading downward like a progress bar filling, and
    # Lab Motif fragments accelerating toward a completion that always stops
    # one note short at the loop boundary.
    lattice = [
        (["F#3", "A3", "C#4", "E4"], "F#2"),
        (["A3", "C#4", "E4", "G#4"], "A2"),
        (["E3", "G#3", "B3", "D#4"], "E2"),
        (["D3", "F#3", "A3", "C#4"], "D2"),
    ]
    bright = [
        (["A3", "C#4", "E4", "G#4"], "A2"),
        (["D4", "F#4", "A4", "C#5"], "D2"),
        (["E4", "G#4", "B4", "D#5"], "E2"),
        (["A3", "C#4", "E4", "G#4"], "A2"),
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_bright = 40 <= measure < 56
        is_breath = 56 <= measure < 64
        is_landing = measure >= 96
        chord, root = (bright if is_bright else lattice)[(measure // 2) % 4]
        song.chord(chord, origin, 3.95, amplitude=0.052 if is_breath or is_landing else 0.044)

        if is_breath:
            # The held breath before full deployment: pulse and pad only.
            add_frontier_pulse(song, "F#2", measure, amplitude=0.024)
            continue

        if measure >= 2:
            add_frontier_pulse(song, root, measure, amplitude=0.017 if is_intro or is_landing else 0.022, pan=-0.08)
        if not (is_intro or is_landing):
            for beat in range(4):
                song.kick(origin + beat, 0.170 if beat == 0 else 0.140)
            song.snare(origin + 1.0, 0.050, pan=-0.06)
            song.snare(origin + 3.0, 0.055, pan=0.06)
            song.note(root, origin, 0.72, waveform="triangle", amplitude=0.120, pan=-0.05)
            song.note(root, origin + 2.0, 0.72, waveform="triangle", amplitude=0.105, pan=-0.05)
        else:
            add_bass_bar(song, root, measure, amp=0.110)

        # The progress bar: an eighth-note cascade stepping down two octaves.
        if not is_intro:
            top = [chord[3], chord[2], chord[1], chord[0]]
            cascade = [pitch for pitch in top] + [
                pitch[:-1] + str(int(pitch[-1]) - 1) for pitch in top
            ]
            add_sequence(
                song, cascade, origin, 0.5, waveform="rounded-pluck",
                amplitude=0.026 if is_landing else 0.031,
                pan=0.22 if measure % 2 else -0.22,
                delay_send=0.08, attack=0.013, decay=0.065, sustain=0.46, release=0.08,
            )

    # Lab Motif in A major, accelerating entries, never the final note.
    for start, phrase, step in (
        (12, ["A4", "C#5", "E5", "G#5", None, None, None, None], 0.5),
        (28, ["A4", "C#5", "E5", "G#5", "F#5", "E5", None, None], 0.5),
        (44, ["A5", "C#6", "E6", None, None, None, None, None], 0.5),
        (48, ["A5", "G#5", "F#5", "E5", None, None, None, None], 0.5),
        (68, ["A4", "C#5", "E5", "G#5", "F#5", "E5", "C#5", None], 0.25),
        (72, ["A4", "C#5", "E5", "G#5", "F#5", "E5", "C#5", None], 0.25),
        (84, ["A5", "C#6", "E6", "G#6", "F#6", "E6", "C#6", None], 0.5),
    ):
        add_motif_sequence(song, phrase, bar(start), step, amplitude=0.060, pan=-0.18, delay_send=0.15)
    for measure in (39, 55, 87, 95):
        add_sequence(
            song,
            ["E6", "C#6", "A5", "E5", None, "A5", "C#6", "E6"],
            bar(measure), 0.5, waveform="bell", amplitude=0.044, pan=0.30, delay_send=0.22,
        )


def compose_adrenaline_half_life(song: Song) -> None:
    # Endgame stage `resolved`: the candidate is archived and the run goes on.
    # Gradients' key and tempo exactly, so the handoff to the lab pools lands
    # seamlessly -- but the Frontier Pulse still tremors under the bright
    # chords, and the completed Lab Motif arrives syncopated, off the beat it
    # always used to land on. The lab is fine. Its hands are still shaking.
    chords = [
        (["D4", "F#4", "A4", "C#5"], "D2"),
        (["A3", "C#4", "E4", "B4"], "A1"),
        (["B3", "D4", "F#4", "A4"], "B1"),
        (["G3", "B3", "D4", "F#4"], "G1"),
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_warm = 24 <= measure < 40
        is_tremor = 40 <= measure < 48
        is_winddown = measure >= 64
        chord, root = chords[measure % 4]
        song.chord(chord, origin, 3.95, amplitude=0.056 if is_warm or is_winddown else 0.048)

        # The tremor: quieter than the thriller tracks, but it never fully stops
        # until the final bars hand the room back to the album.
        if measure < 76:
            tremor_root = "D3" if is_tremor else root.replace("1", "2")
            add_frontier_pulse(
                song, tremor_root, measure,
                amplitude=0.020 if is_tremor else 0.014, pan=-0.08,
            )
        if not (is_intro or is_tremor):
            add_bass_bar(song, root, measure, active=not is_winddown, amp=0.120)
            # Percussion thins bar by bar on the way out.
            intensity = 0.55 if not is_winddown else max(0.12, 0.55 - 0.028 * (measure - 64))
            add_gentle_rhythm(song, measure, intensity)
        if is_warm and measure % 8 == 7:
            add_rounded_arp(song, chord, measure, amplitude=0.024, sparse=True)

    # The Lab Motif, complete at last -- but every phrase starts half a beat
    # late, landing off the pulse it used to own.
    motif = ["D5", "F#5", "A5", "C#6", "B5", "A5", "F#5", "E5"]
    quiet_close = ["D5", "F#5", "A5", None, "B5", "A5", "F#5", "D5"]
    for start, phrase in (
        (10, motif), (16, motif), (26, quiet_close), (34, motif),
        (50, motif), (56, quiet_close), (66, motif), (74, quiet_close),
    ):
        add_motif_sequence(song, phrase, bar(start) + 0.5, 0.5, amplitude=0.062, pan=-0.18, delay_send=0.16)
    for measure in (23, 39, 62):
        add_sequence(
            song,
            ["A5", "B5", "D6", "F#6", None, "D6", "B5", "A5"],
            bar(measure), 0.5, waveform="bell", amplitude=0.046, pan=0.30, delay_send=0.24,
        )



def compose_ghost_in_the_cluster(song: Song) -> None:
    # Machine-flavoured crises: something with agency is loose in the lab's
    # own hardware. Science fiction inside the comfort rules: whole-tone
    # planing that removes tonal gravity, a bass oscillating across the
    # tritone, and the score's one deliberately INHUMAN pulse -- sixteenths
    # with no accent at all, perfectly metronomic where every other track
    # breathes. The bells answer themselves across the stereo field.
    wholetone = [
        ["C4", "E4", "F#4", "Bb4"],
        ["D4", "F#4", "G#4", "C5"],
        ["E4", "G#4", "Bb4", "D5"],
        ["D4", "F#4", "G#4", "C5"],
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_answer = 32 <= measure < 56
        is_pressure = 56 <= measure < 80
        is_landing = measure >= 88
        chord = wholetone[(measure // 2) % 4]
        song.chord(chord, origin, 3.95, amplitude=0.052 if is_intro or is_landing else 0.044)

        # The tritone pendulum: the floor never decides where it is.
        root = "C2" if measure % 4 < 2 else "F#2"
        song.note(root, origin, 3.2, waveform="triangle", amplitude=0.108, pan=-0.05)

        # The machine's pulse: dead even, no accents, no gaps. Uncanny by
        # regularity alone, and quiet enough to sit behind the harmony.
        if not is_intro:
            level = 0.021 if is_pressure else 0.017
            for sixteenth in range(16):
                song.note(
                    "C4" if measure % 4 < 2 else "F#4",
                    origin + sixteenth * 0.25,
                    0.18,
                    waveform="rounded-pluck",
                    amplitude=level,
                    pan=0.12,
                    attack=0.012,
                    decay=0.045,
                    sustain=0.40,
                    release=0.055,
                )
        if is_pressure:
            song.kick(origin, 0.115)
            if measure % 2 == 1:
                song.snare(origin + 2.0, 0.046, pan=0.04)
        if is_intro or is_landing:
            # Telemetry: sparse ticks while the anomaly is still a rumour.
            song.tick(origin + 1.0, "C6", 0.026)
            song.tick(origin + 3.5, "F#5", 0.024)

    # The ghost speaks almost-lab-language: the Lab Motif bent onto the
    # whole-tone scale, so every interval is subtly wrong.
    bent_motif = ["C5", "E5", "F#5", "Bb5", "G#5", "F#5", "E5", "D5"]
    for start in (12, 20, 60, 68, 76):
        add_motif_sequence(song, bent_motif, bar(start), 0.5, amplitude=0.058, pan=-0.18, delay_send=0.18)
    # Call and answer: the same bell phrase from opposite sides of the room,
    # the answer a tritone away.
    call = ["E6", "D6", "Bb5", None]
    answer = ["Bb5", "G#5", "E5", None]
    for start in (34, 38, 42, 46, 50, 54):
        phrase, side = (call, -0.36) if (start // 4) % 2 == 0 else (answer, 0.36)
        add_sequence(song, phrase, bar(start), 0.75, waveform="bell", amplitude=0.042, pan=side, delay_send=0.24)


def compose_the_machine_moves_first(song: Song) -> None:
    # Endgame stage `containment-failure`: the model acts before the lab
    # does. The deus ex machina track -- a Shepard-style ascent that rises
    # forever without arriving, major triads planing in whole steps, deep
    # tritone tolls, and the Lab Motif answered by its own inversion: the
    # machine speaking the lab's language upside down.
    planing = [
        (["F3", "A3", "C4"], "F2"),
        (["G3", "B3", "D4"], "G2"),
        (["A3", "C#4", "E4"], "A2"),
        (["B3", "D#4", "F#4"], "B2"),
    ]
    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 8
        is_toll = 24 <= measure < 40 or 64 <= measure < 80
        is_landing = measure >= 88
        chord, root = planing[(measure // 2) % 4]
        song.chord(chord, origin, 3.95, amplitude=0.050 if is_intro or is_landing else 0.043)
        song.note(root, origin, 2.8, waveform="triangle", amplitude=0.106, pan=-0.05)
        if not (is_intro or is_landing):
            # One deep toll every two bars; F against B -- the tritone bell.
            if measure % 2 == 0:
                song.note("F2" if measure % 4 == 0 else "B2", origin, 3.5,
                          waveform="bell", amplitude=0.052, pan=0.0, attack=0.020,
                          decay=0.30, sustain=0.30, release=0.60, delay_send=0.20)
            song.snare(origin + 2.0, 0.044, pan=0.03)
        if is_toll and measure % 2 == 1:
            song.tick(origin + 1.5, "C6", 0.028)
            song.tick(origin + 3.5, "G5", 0.028)

    # The Shepard engine: three evenly phased voices climb a semitone every
    # half bar through a two-octave window; each fades in at the bottom and
    # out at the top, so the ascent never arrives anywhere. The 24-step cycle
    # divides the 192 half-bars exactly, so the illusion is seamless across
    # the loop boundary. Quiet by construction.
    total_steps = song.bars * 2
    for voice in range(3):
        for step in range(total_steps):
            position = (voice * 8 + step) % 24
            pitch = 41 + position  # F2 upward across two octaves
            window = math.sin(math.pi * (position + 0.5) / 24.0) ** 2
            song.note(
                pitch,
                step * 2.0,
                1.6,
                waveform="rounded-pluck",
                amplitude=0.020 * window,
                pan=-0.24 + 0.24 * voice,
                attack=0.030,
                decay=0.10,
                sustain=0.55,
                release=0.20,
                delay_send=0.08,
            )

    # The lab asks; the machine answers with the mirror image.
    motif_up = ["F4", "A4", "C5", "E5", None, None, None, None]
    motif_mirror = ["F5", "Db5", "Bb4", "Gb4", None, None, None, None]
    for start in (16, 32, 48, 72):
        add_motif_sequence(song, motif_up, bar(start), 0.5, amplitude=0.058, pan=-0.20, delay_send=0.16)
        add_motif_sequence(song, motif_mirror, bar(start + 2), 0.5, amplitude=0.058, pan=0.20, delay_send=0.16)


def compose_the_window_is_closing(song: Song) -> None:
    # Endgame stage `evidence-sprint`: every test is running, every institution
    # is waiting, and the remaining uncertainty is now a clock. D minor keeps
    # colliding with its Neapolitan E-flat; an A dominant promises resolution
    # but never receives it. The seven-step sixteenth pulse migrates through
    # the 4/4 bar, producing urgency without abrasive timbres or loudness.
    progression = [
        (["D3", "F3", "A3", "C4"], "D2"),
        (["Eb3", "G3", "Bb3", "D4"], "Eb2"),
        (["Bb2", "D3", "F3", "A3"], "Bb1"),
        (["A2", "C#3", "E3", "G3"], "A1"),
    ]
    pulse = ["D4", "A4", "F4", "C5", "Eb4", "Bb4", "C#5"]

    for measure in range(song.bars):
        origin = bar(measure)
        is_intro = measure < 6
        is_breath = 62 <= measure < 68
        is_final = measure >= 90
        chord, root = progression[(measure // 2) % len(progression)]

        song.chord(
            chord,
            origin,
            3.95,
            amplitude=0.054 if is_intro or is_breath else 0.044,
            attack=0.08,
            release=0.20,
        )
        song.note(
            root,
            origin,
            3.2 if is_intro or is_breath else 1.85,
            waveform="triangle",
            amplitude=0.092 if is_intro or is_breath else 0.106,
            pan=-0.05,
            attack=0.035,
            decay=0.10,
            sustain=0.66,
            release=0.18,
        )

        if not (is_intro or is_breath):
            # 98 bars * 16 subdivisions is divisible by seven, so the migrating
            # accent returns to its first step exactly at the loop boundary.
            for sixteenth in range(16):
                step = measure * 16 + sixteenth
                accent = 1.0 if step % 7 == 0 else 0.56
                song.note(
                    pulse[step % len(pulse)],
                    origin + sixteenth * 0.25,
                    0.15,
                    waveform="rounded-pluck",
                    amplitude=(0.025 if is_final else 0.021) * accent,
                    pan=-0.24 if step % 2 == 0 else 0.24,
                    attack=0.008,
                    decay=0.045,
                    sustain=0.38,
                    release=0.070,
                    delay_send=0.045,
                )
            song.kick(origin, 0.20 if is_final else 0.17)
            song.kick(origin + 2.5, 0.13)
            if measure % 2 == 1:
                song.snare(origin + 2.0, 0.050, pan=0.04)
        else:
            # Sparse telemetry in the intake and the single held-breath gap.
            song.tick(origin + 1.0, "A5", 0.022)
            song.tick(origin + 3.25, "Eb6", 0.020)

        if 30 <= measure < 62 or 68 <= measure < 90:
            # A second clock advances on awkward offbeats, creating pressure
            # without introducing bright hats or noise percussion.
            song.tick(origin + 0.75, "D6", 0.020)
            song.tick(origin + 2.25, "A5", 0.019)
            song.tick(origin + 3.50, "Eb6", 0.018)

    # The lab's question is repeatedly answered a semitone too high. Later
    # entries overlap so the investigation feels as if it is accelerating.
    question = ["D5", "F5", "A5", "C6", None, "A5", "F5", None]
    answer = ["Eb5", "G5", "Bb5", "Db6", None, "Bb5", "G5", None]
    for start in (10, 24, 38, 52, 70, 82, 90):
        add_motif_sequence(
            song,
            question,
            bar(start),
            0.5,
            amplitude=0.052,
            pan=-0.22,
            delay_send=0.14,
        )
        add_motif_sequence(
            song,
            answer,
            bar(start + 1),
            0.5,
            amplitude=0.046,
            pan=0.22,
            delay_send=0.18,
        )


TRACKS = [
    TrackSpec("hello-world-model", 1, "Hello, World Model", 108, 72, compose_hello_world_model),
    TrackSpec("gradients-flowing", 2, "The Gradients Are Flowing", 126, 80, compose_gradients_flowing),
    TrackSpec("safety-case-draft-47", 3, "Safety Case (Draft 47)", 92, 72, compose_safety_case),
    TrackSpec("red-team-found-something", 4, "Red Team Found Something", 138, 80, compose_red_team),
    TrackSpec("last-evaluation", 5, "The Last Evaluation", 104, 80, compose_last_evaluation),
    TrackSpec("broadly-shared-future", 6, "A Broadly Shared Future", 116, 80, compose_broadly_shared_future),
    TrackSpec("cashflow-positive", 7, "Cashflow Positive*", 122, 72, compose_cashflow_positive),
    TrackSpec("peer-reviewer-two", 8, "Reviewer Two Requires AGI", 114, 72, compose_reviewer_two),
    TrackSpec(
        "nothing-left-to-read", 9, "There Is No One Left to Read This", 60, 32,
        compose_nothing_left_to_read, loop=False, target_peak=0.62,
    ),
    TrackSpec("overnight-run", 10, "The Overnight Run", 100, 72, compose_overnight_run),
    TrackSpec(
        "gpus-arrive-tuesday", 11, "The GPUs Arrive on a Tuesday", 132, 80,
        compose_gpus_arrive_tuesday,
    ),
    TrackSpec(
        "tests-pass-first-try", 12, "All Tests Pass on the First Try", 128, 80,
        compose_tests_pass_first_try,
    ),
    TrackSpec(
        "new-hire-orientation", 13, "New Hire Orientation", 124, 80,
        compose_new_hire_orientation,
    ),
    TrackSpec(
        "demo-worked-twice", 14, "The Demo Worked Twice", 134, 80,
        compose_demo_worked_twice,
    ),
    TrackSpec(
        "budget-approved", 15, "Compute Budget Approved", 120, 72,
        compose_budget_approved,
    ),
    TrackSpec(
        "converged-before-lunch", 16, "Converged Before Lunch", 130, 76,
        compose_converged_before_lunch,
    ),
    TrackSpec(
        "the-number-appears", 17, "The Number Appears", 72, 54,
        compose_the_number_appears, target_peak=0.70,
    ),
    TrackSpec(
        "containment-posture", 18, "Containment Posture", 86, 68,
        compose_containment_posture, target_peak=0.72,
    ),
    TrackSpec(
        "everyone-is-calling", 19, "Everyone Is Calling", 90, 64,
        compose_everyone_is_calling, target_peak=0.72,
    ),
    TrackSpec(
        "the-final-review", 20, "The Final Review", 63, 52,
        compose_the_final_review, target_peak=0.66,
    ),
    TrackSpec(
        "root-access", 21, "Root Access", 76, 66,
        compose_root_access, target_peak=0.70,
    ),
    TrackSpec(
        "false-dawn", 22, "False Dawn", 96, 64,
        compose_false_dawn, target_peak=0.74,
    ),
    TrackSpec(
        "a-qualified-success", 23, "A Qualified Success", 104, 64,
        compose_a_qualified_success, target_peak=0.74,
    ),
    TrackSpec(
        "exit-interview", 24, "Exit Interview", 84, 60,
        compose_exit_interview, target_peak=0.68,
    ),
    TrackSpec(
        "loss-of-signal", 25, "Loss of Signal", 66, 48,
        compose_loss_of_signal, target_peak=0.62,
    ),
    TrackSpec(
        "the-graph-goes-vertical", 26, "The Graph Goes Vertical", 140, 96,
        compose_the_graph_goes_vertical,
    ),
    TrackSpec(
        # 98 bars, not 96: the seven-sixteenth ostinato needs a bar count whose
        # sixteenth total divides by seven (98 * 16 = 224 cycles exactly), so
        # the migrating accent lands where the loop restart expects it.
        "hands-off-the-weights", 27, "Hands Off The Weights", 132, 98,
        compose_hands_off_the_weights,
    ),
    TrackSpec(
        "every-phone-at-once", 28, "Every Phone At Once", 144, 96,
        compose_every_phone_at_once,
    ),
    TrackSpec("go-no-go", 29, "Go / No-Go", 152, 96, compose_go_no_go, target_peak=0.64),
    TrackSpec("ship-it", 30, "Ship It", 148, 104, compose_ship_it),
    TrackSpec(
        "adrenaline-half-life", 31, "Adrenaline Half-Life", 126, 80,
        compose_adrenaline_half_life, target_peak=0.75,
    ),
    TrackSpec(
        "ghost-in-the-cluster", 32, "Ghost in the Cluster", 136, 96,
        compose_ghost_in_the_cluster, target_peak=0.70,
    ),
    TrackSpec(
        "the-machine-moves-first", 33, "The Machine Moves First", 146, 96,
        compose_the_machine_moves_first, target_peak=0.70,
    ),
    TrackSpec(
        "the-window-is-closing", 34, "The Window Is Closing", 146, 98,
        compose_the_window_is_closing, target_peak=0.70,
    ),
]


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(CHANNELS)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm.tobytes())


def convert_with_afconvert(wav_path: Path, m4a_path: Path) -> bool:
    executable = shutil.which("afconvert")
    if not executable:
        return False
    if m4a_path.exists():
        m4a_path.unlink()
    subprocess.run(
        [executable, "-f", "m4af", "-d", "aac", "-b", "128000", str(wav_path), str(m4a_path)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return True


def convert_production_codecs(wav_path: Path, m4a_path: Path, opus_path: Path) -> None:
    """Create the browser release pair from the same PCM master.

    Opus is preferred by the game; AAC is retained for Safari/platform fallback. ffmpeg is an
    explicit release-tool dependency rather than a Python package so its encoder/version can be
    recorded alongside a release artifact.
    """
    executable = shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError("--production-codecs requires ffmpeg on PATH")
    for target in (m4a_path, opus_path):
        if target.exists():
            target.unlink()
    common = [executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path)]
    subprocess.run(
        [*common, "-map_metadata", "-1", "-c:a", "aac", "-b:a", "128k", str(m4a_path)],
        check=True,
    )
    subprocess.run(
        [
            *common,
            "-map_metadata",
            "-1",
            "-c:a",
            "libopus",
            "-b:a",
            "96k",
            "-vbr",
            "on",
            "-application",
            "audio",
            str(opus_path),
        ],
        check=True,
    )


def render(
    track: TrackSpec, output_dir: Path, keep_wav: bool, production_codecs: bool
) -> tuple[Path, Path | None]:
    song = Song(track.bpm, track.bars, seed=0x4E454F + track.number * 997)
    track.composer(song)
    audio = song.finish(loop=track.loop, target_peak=track.target_peak)
    wav_path = output_dir / f"{track.filename}.wav"
    m4a_path = output_dir / f"{track.filename}.m4a"
    write_wav(wav_path, audio)
    if production_codecs:
        convert_production_codecs(wav_path, m4a_path, output_dir / f"{track.filename}.opus")
        converted = True
    else:
        converted = convert_with_afconvert(wav_path, m4a_path)
    if converted and not keep_wav:
        wav_path.unlink()
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(np.square(audio))))
    discontinuity = float(np.max(np.abs(audio[0] - audio[-1])))
    print(
        f"{track.number:02d}  {track.title:<30} "
        f"{song.duration_seconds:5.1f}s  peak={peak:.3f}  rms={rms:.3f}  "
        f"{'loop-edge' if track.loop else 'end-edge'}={discontinuity:.4f}"
    )
    return wav_path, m4a_path if converted else None


def render_event(
    event: EventSpec, output_dir: Path, keep_wav: bool, production_codecs: bool
) -> tuple[Path, Path | None]:
    song = Song(event.bpm, event.bars, seed=0x455654 + event.number * 613)
    compose_event_cue(song, event)
    audio = song.finish(loop=False, target_peak=event.target_peak)
    wav_path = output_dir / f"{event.filename}.wav"
    m4a_path = output_dir / f"{event.filename}.m4a"
    write_wav(wav_path, audio)
    if production_codecs:
        convert_production_codecs(wav_path, m4a_path, output_dir / f"{event.filename}.opus")
        converted = True
    else:
        converted = convert_with_afconvert(wav_path, m4a_path)
    if converted and not keep_wav:
        wav_path.unlink()
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(np.square(audio))))
    end_edge = float(np.max(np.abs(audio[-1])))
    print(
        f"E{event.number:02d} {event.title:<30} "
        f"{song.duration_seconds:5.1f}s  peak={peak:.3f}  rms={rms:.3f}  "
        f"end={end_edge:.4f}"
    )
    return wav_path, m4a_path if converted else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--track", choices=[track.id for track in TRACKS])
    selection.add_argument("--event", choices=[event.id for event in EVENTS])
    selection.add_argument("--events", action="store_true", help="Render the complete event-cue library")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--keep-wav", action="store_true")
    parser.add_argument(
        "--production-codecs",
        action="store_true",
        help="Require ffmpeg and emit content-ready Opus plus AAC from each PCM master",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.event is not None or args.events:
        output = args.output or DEFAULT_EVENT_OUTPUT
        output.mkdir(parents=True, exist_ok=True)
        selected_events = [event for event in EVENTS if args.event in (None, event.id)]
        print(f"Rendering {len(selected_events)} Neolab.ai event cue(s) at {SAMPLE_RATE} Hz stereo")
        for event in selected_events:
            render_event(event, output, args.keep_wav, args.production_codecs)
    else:
        output = args.output or DEFAULT_OUTPUT
        output.mkdir(parents=True, exist_ok=True)
        selected_tracks = [track for track in TRACKS if args.track in (None, track.id)]
        print(f"Rendering {len(selected_tracks)} Neolab.ai soundtrack track(s) at {SAMPLE_RATE} Hz stereo")
        for track in selected_tracks:
            render(track, output, args.keep_wav, args.production_codecs)


if __name__ == "__main__":
    main()
