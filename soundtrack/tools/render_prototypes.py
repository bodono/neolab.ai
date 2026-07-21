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


def render(track: TrackSpec, output_dir: Path, keep_wav: bool) -> tuple[Path, Path | None]:
    song = Song(track.bpm, track.bars, seed=0x4E454F + track.number * 997)
    track.composer(song)
    audio = song.finish(loop=track.loop, target_peak=track.target_peak)
    wav_path = output_dir / f"{track.filename}.wav"
    m4a_path = output_dir / f"{track.filename}.m4a"
    write_wav(wav_path, audio)
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


def render_event(event: EventSpec, output_dir: Path, keep_wav: bool) -> tuple[Path, Path | None]:
    song = Song(event.bpm, event.bars, seed=0x455654 + event.number * 613)
    compose_event_cue(song, event)
    audio = song.finish(loop=False, target_peak=event.target_peak)
    wav_path = output_dir / f"{event.filename}.wav"
    m4a_path = output_dir / f"{event.filename}.m4a"
    write_wav(wav_path, audio)
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
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.event is not None or args.events:
        output = args.output or DEFAULT_EVENT_OUTPUT
        output.mkdir(parents=True, exist_ok=True)
        selected_events = [event for event in EVENTS if args.event in (None, event.id)]
        print(f"Rendering {len(selected_events)} Neolab.ai event cue(s) at {SAMPLE_RATE} Hz stereo")
        for event in selected_events:
            render_event(event, output, args.keep_wav)
    else:
        output = args.output or DEFAULT_OUTPUT
        output.mkdir(parents=True, exist_ok=True)
        selected_tracks = [track for track in TRACKS if args.track in (None, track.id)]
        print(f"Rendering {len(selected_tracks)} Neolab.ai soundtrack track(s) at {SAMPLE_RATE} Hz stereo")
        for track in selected_tracks:
            render(track, output, args.keep_wav)


if __name__ == "__main__":
    main()
