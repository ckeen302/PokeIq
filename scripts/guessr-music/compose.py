"""
PokéGuessr's background music: original, generative ambient pieces (soft
felt piano, music box, a Rhodes-style electric piano and slow pads in a large
room), written for PokéIQ and rendered here from nothing but numpy. No
samples, sound fonts or recordings, so there is nothing to license.

Each piece is composed from a seeded random generator (the same seed gives
the same piece): a slow chord progression, a left hand of broken chords, and
a sparse melody built from short motifs that repeat, vary and answer each
other, with long rests between. Every note's tail, and the reverb's, wraps
round to the start, so a file loops with no seam.

    python3 -I compose.py out          # writes out/<name>.f32 (stereo float, 44.1 kHz)
    ./render.sh                        # loudness-matches and encodes them

Only numpy is needed.
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, field

import numpy as np

SR = 44100

# ---------------------------------------------------------------------------
# Theory
# ---------------------------------------------------------------------------

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
}

# Chord qualities: intervals from the root. The first three are the "triad" used to find avoid notes.
QUALITIES = {
    "maj7": [0, 4, 7, 11],
    "maj9": [0, 4, 7, 11, 14],
    "add9": [0, 4, 7, 14],
    "6/9": [0, 4, 7, 9, 14],
    "m7": [0, 3, 7, 10],
    "m9": [0, 3, 7, 10, 14],
    "sus2": [0, 2, 7, 14],
    "sus4": [0, 5, 7, 10],
}


def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


@dataclass
class Chord:
    root: int  # semitones above the tonic
    quality: str

    def pcs(self, tonic: int) -> set[int]:
        return {(tonic + self.root + i) % 12 for i in QUALITIES[self.quality]}

    def rest_pcs(self, tonic: int) -> set[int]:
        """Pitch classes a melody may rest on: the chord's own tones (its 7th and 9th included)."""
        return self.pcs(tonic)

    def avoid_pcs(self, tonic: int) -> set[int]:
        """A semitone above a triad tone (the classic 'avoid note'), and the 3rd against a sus4."""
        triad = QUALITIES[self.quality][:3]
        out = {(tonic + self.root + i + 1) % 12 for i in triad}
        if self.quality == "sus4":
            out.add((tonic + self.root + 4) % 12)
        return out - self.pcs(tonic)


# ---------------------------------------------------------------------------
# Instruments (additive synthesis, one note at a time)
# ---------------------------------------------------------------------------


def lowpass_weight(f: np.ndarray | float, fc: float, order: int = 2):
    return 1.0 / np.sqrt(1.0 + (np.asarray(f) / fc) ** (2 * order))


def piano(rng, midi: int, vel: float, hold: float) -> np.ndarray:
    """A soft felt piano: inharmonic partials, two-stage decay, a little string beating, a dark felt hammer."""
    f0 = mtof(midi)
    tau1 = float(np.clip(7.5 * (f0 / 261.6) ** -0.65, 1.6, 14.0))  # aftersound decay of the fundamental
    length = min(hold + 1.2, 5.0 * tau1)
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    B = 0.00032 * (f0 / 261.6) ** 0.5
    fc = 700 + 2300 * vel**1.6  # felt: soft notes are dark
    for k in range(1, 17):
        fk = f0 * k * math.sqrt(1 + B * k * k)
        if fk > 7500:
            break
        amp = k**-1.05 * float(lowpass_weight(fk, fc, 2)) * (abs(math.sin(math.pi * k * 0.118)) + 0.12)
        if amp < 1e-4:
            continue
        tau = tau1 / (1 + 0.32 * (k - 1))
        env = 0.62 * np.exp(-t / (tau * 0.16)) + 0.38 * np.exp(-t / tau)
        strings = 2 if k <= 6 else 1
        for s in range(strings):
            detune = 0.0 if strings == 1 else (s - 0.5) * (0.9 + 0.6 * rng.random()) / 1200
            ph = rng.random() * 2 * math.pi
            out += (amp / strings) * env * np.sin(2 * math.pi * fk * (1 + detune) * t + ph)
    attack = 1 - np.exp(-t / 0.005)
    out *= attack
    # The felt hammer: a very soft, low thump.
    m = min(n, int(0.05 * SR))
    thump = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.008 * SR))
    thump = np.convolve(thump, np.ones(24) / 24, mode="same")
    out[:m] += 0.05 * vel * thump
    # Dampers after the pedal lifts.
    off = int(hold * SR)
    if off < n:
        out[off:] *= np.exp(-np.arange(n - off) / (0.28 * SR))
    return out * (vel**1.5) * 0.22


def music_box(rng, midi: int, vel: float, hold: float) -> np.ndarray:
    """A music-box tine: a pure fundamental, the cantilever's high partials (x6.27, x17.55) dying fast, a tiny pluck."""
    f0 = mtof(midi)
    tau = float(np.clip(3.2 * (f0 / 523.0) ** -0.5, 1.2, 4.5))
    length = min(max(hold, 2.5) + 0.8, 5 * tau)
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, tk in ((1.0, 1.0, tau), (2.0, 0.06, tau * 0.4), (6.27, 0.16, tau * 0.12), (17.55, 0.035, tau * 0.04)):
        fk = f0 * ratio
        if fk > 15000:
            continue
        ph = rng.random() * 2 * math.pi
        out += amp * np.exp(-t / tk) * np.sin(2 * math.pi * fk * t + ph)
    # A slow shimmer (the comb's teeth beat a little).
    out *= 1 + 0.04 * np.sin(2 * math.pi * (4.5 + rng.random()) * t)
    out *= 1 - np.exp(-t / 0.0015)
    m = min(n, int(0.006 * SR))
    click = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.0012 * SR))
    out[:m] += 0.05 * click
    return out * (vel**1.3) * 0.045


def epiano(rng, midi: int, vel: float, hold: float) -> np.ndarray:
    """A Rhodes-style tine piano: two-operator FM whose brightness falls away, a soft bell tine, a slow tremolo."""
    f0 = mtof(midi)
    tau = float(np.clip(5.0 * (f0 / 261.6) ** -0.5, 1.5, 8.0))
    length = min(hold + 0.9, 5 * tau)
    n = int(length * SR)
    t = np.arange(n) / SR
    index = (0.35 + 1.1 * vel) * np.exp(-t / 0.35) + 0.15
    mod = np.sin(2 * math.pi * f0 * t + rng.random() * 6.28)
    body = np.sin(2 * math.pi * f0 * t + index * mod)
    body += 0.25 * np.sin(2 * math.pi * 2 * f0 * t + 0.4 * index * mod)
    env = 0.55 * np.exp(-t / (tau * 0.25)) + 0.45 * np.exp(-t / tau)
    out = body * env
    if f0 * 14 < 16000:
        out += 0.05 * vel * np.exp(-t / 0.05) * np.sin(2 * math.pi * f0 * 14 * t)
    out *= 1 - np.exp(-t / 0.003)
    off = int(hold * SR)
    if off < n:
        out[off:] *= np.exp(-np.arange(n - off) / (0.2 * SR))
    return out * (vel**1.4) * 0.11


def pad(rng, midis: list[int], dur: float, level: float, bright: float) -> tuple[np.ndarray, np.ndarray]:
    """A slow, soft pad: each tone three gently detuned voices, swelling in and out, spread across the stereo field."""
    attack, release = min(3.0, dur * 0.4), 3.5
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    env = np.where(t < attack, 0.5 - 0.5 * np.cos(np.pi * np.clip(t / attack, 0, 1)), 1.0)
    rel = np.clip((t - dur) / release, 0, 1)
    env *= 0.5 + 0.5 * np.cos(np.pi * rel)
    left = np.zeros(n)
    right = np.zeros(n)
    harmonics = [(1, 1.0), (2, 0.22 * bright), (3, 0.08 * bright), (4, 0.03 * bright)]
    for m in midis:
        f0 = mtof(m)
        for v, cents in enumerate((-5.0, 0.0, 5.5)):
            f = f0 * 2 ** (cents / 1200)
            lfo = 1 + 0.22 * np.sin(2 * math.pi * (0.05 + 0.08 * rng.random()) * t + rng.random() * 6.28)
            sig = np.zeros(n)
            for h, a in harmonics:
                if f * h < 6000:
                    sig += a * np.sin(2 * math.pi * f * h * t + rng.random() * 6.28)
            sig *= lfo
            pan = (v - 1) * 0.6 + rng.uniform(-0.15, 0.15)
            left += sig * math.cos((pan + 1) * math.pi / 4)
            right += sig * math.sin((pan + 1) * math.pi / 4)
    scale = level / (len(midis) * 3) ** 0.5 * 0.05
    return left * env * scale, right * env * scale


INSTRUMENTS = {"piano": piano, "musicbox": music_box, "epiano": epiano}

# ---------------------------------------------------------------------------
# The room
# ---------------------------------------------------------------------------


def smooth_lowpass(x: np.ndarray, fc: float) -> np.ndarray:
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(spec * lowpass_weight(f, fc, 2), n=len(x))


def room_ir(rng, seconds: float, rt_low: float, rt_high: float) -> tuple[np.ndarray, np.ndarray]:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    irs = []
    for _ in range(2):
        noise = rng.standard_normal(n)
        low = smooth_lowpass(noise, 1400)
        high = noise - low
        ir = low * np.exp(-6.9 * t / rt_low) + 0.45 * high * np.exp(-6.9 * t / rt_high)
        pre = int(0.022 * SR)
        ir = np.concatenate([np.zeros(pre), ir[: n - pre]])
        ir[pre : pre + int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))
        for _ in range(7):  # a few early reflections
            d = pre + int(rng.uniform(0.004, 0.05) * SR)
            ir[d] += rng.uniform(-0.6, 0.6) * 12
        ir /= np.sqrt(np.sum(ir**2))
        irs.append(ir)
    return irs[0], irs[1]


def circular_convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    L = len(x)
    h = np.zeros(L)
    h[: len(ir)] = ir[:L]
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(h), n=L)


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------


@dataclass
class Note:
    at: float  # seconds
    inst: str
    midi: int
    vel: float
    hold: float  # seconds
    pan: float = 0.0
    gain: float = 1.0  # the part's level in the mix


@dataclass
class Track:
    name: str
    title: str
    seed: int
    tonic: int  # MIDI note of the key's tonic (around middle C)
    scale: str
    bpm: float
    beats: int  # per bar
    chords: list[Chord]
    form: list[tuple[str, int]]  # (section, progression cycles)
    melody: str  # instrument
    left: str  # instrument for the broken chords
    melody_range: tuple[int, int]
    pad_level: float = 1.0
    pad_bright: float = 0.6
    wet: float = 0.42
    sprinkle: str | None = None  # a second voice for high, sparse notes
    bars_per_chord: int = 2
    notes: list[Note] = field(default_factory=list)


RHYTHMS = {
    4: [
        [(0, 2), (2, 1), (3, 1), (4, 4)],
        [(0, 1.5), (1.5, 0.5), (2, 2), (4, 4)],
        [(1, 1), (2, 1), (3, 0.5), (3.5, 4.5)],
        [(0, 3), (3, 1), (4, 4)],
        [(0, 1), (1, 1), (2, 2), (5, 3)],
        [(2, 1), (3, 1), (4, 1), (5, 3)],
        [(0, 4), (4, 1), (5, 3)],
    ],
    3: [
        [(0, 2), (2, 1), (3, 3)],
        [(0, 1), (1, 1), (2, 1), (3, 3)],
        [(1, 1), (2, 1), (3, 3)],
        [(0, 3), (3, 1.5), (4.5, 1.5)],
        [(0, 1.5), (1.5, 1.5), (3, 3)],
        [(2, 1), (3, 2), (5, 1)],
    ],
}

# Scale steps between a motif's notes (the first is where it starts).
CONTOURS = [
    [0, 2, 1, -1, -2],
    [0, -1, -1, 3, -1],
    [0, 1, 2, 1, -3],
    [0, 3, -1, -1, -1],
    [0, -2, 1, 2, -1],
    [0, 1, 1, 1, -2],
    [0, 4, -1, -2, -1],
    [0, -1, 2, -1, -1],
]


# The mix: the melody sits on top, the broken chords under it, the pad a quiet bed under both.
MELODY_GAIN = 1.4
LEFT_GAIN = 0.5
PAD_GAIN = 0.4


class Composer:
    def __init__(self, track: Track):
        self.t = track
        self.rng = np.random.default_rng(track.seed)
        self.beat = 60.0 / track.bpm
        self.bar = self.beat * track.beats
        self.chord_s = self.bar * track.bars_per_chord
        lo, hi = track.melody_range
        pcs = {(track.tonic + i) % 12 for i in SCALES[track.scale]}
        self.scale_notes = [m for m in range(lo, hi + 1) if m % 12 in pcs]

    def add(self, at, inst, midi, vel, hold, pan=0.0, gain=None):
        jitter = float(self.rng.normal(0, 0.01))
        vel = float(np.clip(vel + self.rng.normal(0, 0.035), 0.08, 1.0))
        if gain is None:
            gain = MELODY_GAIN
        self.t.notes.append(Note(max(0.0, at + jitter), inst, int(midi), vel, hold, pan, gain))

    # -- left hand -----------------------------------------------------------

    def bass_root(self, chord: Chord) -> int:
        r = self.t.tonic + chord.root
        while r >= 50:
            r -= 12
        while r < 38:
            r += 12
        return r

    def left_hand(self, at: float, chord: Chord, vel: float, density: str):
        """Broken chords: the root low, then the fifth, the tenth and a colour tone above, held by the pedal."""
        q = QUALITIES[chord.quality]
        root = self.bass_root(chord)
        third = q[1]
        colour = 14 if 14 in q else (q[3] if len(q) > 3 else 12)
        tones = [root, root + 7, root + 12 + third, root + 12 + colour if colour > 12 else root + colour + 12]
        beats = self.t.beats * self.t.bars_per_chord
        if density == "sparse":
            pattern = [(0, 0), (self.t.beats, 1)] if beats > self.t.beats else [(0, 0)]
            pattern.append((beats - 1.0, 2))
        elif density == "drone":
            pattern = [(0, 0)]
        else:  # flowing: a broken chord each bar
            pattern = []
            for b in range(self.t.bars_per_chord):
                base = b * self.t.beats
                seq = [0, 1, 2, 3] if self.t.beats == 4 else [0, 1, 2]
                if b % 2 == 1:
                    seq = [1, 2, 3, 2] if self.t.beats == 4 else [1, 3, 2]
                for i, idx in enumerate(seq):
                    pattern.append((base + i, idx))
        for beat, idx in pattern:
            when = at + beat * self.beat
            hold = at + self.chord_s - when + 0.15
            v = vel * (1.0 if idx == 0 else 0.82)
            self.add(when, self.t.left, tones[idx], v, hold, pan=-0.25 + 0.1 * idx, gain=LEFT_GAIN)

    # -- melody ---------------------------------------------------------------

    def nearest(self, midi: int, allowed: set[int]) -> int:
        cands = [m for m in self.scale_notes if m % 12 in allowed]
        return min(cands, key=lambda m: (abs(m - midi), m)) if cands else midi

    def snap(self, m: int, prev: int | None, step: int, allowed: set[int]) -> int:
        """The nearest allowed note, moving the way the contour moves (so a step never collapses into a repeat)."""
        cands = [c for c in self.scale_notes if c % 12 in allowed]
        if not cands:
            return m
        if prev is not None and step > 0:
            up = [c for c in cands if c > prev]
            if up:
                return min(up, key=lambda c: abs(c - m))
        if prev is not None and step < 0:
            down = [c for c in cands if c < prev]
            if down:
                return min(down, key=lambda c: abs(c - m))
        return min(cands, key=lambda c: (abs(c - m), c))

    def phrase(self, at: float, chord: Chord, rhythm, contour, start: int, vel: float, inst: str) -> int:
        tonic = self.t.tonic
        rest = chord.rest_pcs(tonic)
        scale_pcs = {m % 12 for m in self.scale_notes}
        passing = scale_pcs - chord.avoid_pcs(tonic)
        prev: int | None = None
        idx = self.scale_notes.index(self.nearest(start, rest))
        for i, (beat, dur) in enumerate(rhythm):
            step = contour[i] if i < len(contour) else int(self.rng.choice([-1, 1]))
            if i == 0:
                step = 0
            idx = int(np.clip(idx + step, 0, len(self.scale_notes) - 1))
            m = self.scale_notes[idx]
            final = i == len(rhythm) - 1
            # Long notes, downbeats and the phrase's last note rest on chord tones; short ones may pass through the scale.
            m = self.snap(m, prev, step, rest if (dur >= 1.5 or final or beat == 0) else passing)
            idx = self.scale_notes.index(m)
            when = at + beat * self.beat
            hold = max(dur * self.beat + 0.3, at + self.chord_s - when + 0.1)
            accent = 1.0 if beat == 0 else 0.88
            self.add(when, inst, m, vel * accent, hold, pan=0.18)
            prev = m
        self.last_mel = prev if prev is not None else start
        return self.last_mel

    def vary(self, rhythm):
        r = [list(x) for x in rhythm]
        choice = self.rng.random()
        if choice < 0.35 and len(r) > 2:  # drop a note
            j = int(self.rng.integers(1, len(r) - 1))
            r[j - 1][1] += r[j][1]
            del r[j]
        elif choice < 0.65:  # split the first long note
            for j, (b, d) in enumerate(r):
                if d >= 2:
                    r[j] = [b, d / 2]
                    r.insert(j + 1, [b + d / 2, d / 2])
                    break
        return [tuple(x) for x in r]

    def sprinkle(self, at: float, chord: Chord, vel: float, prob: float):
        """A few high, soft notes, far apart (two octaves up, chord tones only)."""
        if not self.t.sprinkle:
            return
        tonic = self.t.tonic
        pcs = sorted(chord.pcs(tonic))
        beats = self.t.beats * self.t.bars_per_chord
        for b in range(0, beats, 2):
            if self.rng.random() < prob:
                pc = int(self.rng.choice(pcs))
                m = self.t.melody_range[1] - 12 + ((pc - (self.t.melody_range[1] - 12)) % 12)
                if self.t.sprinkle == "musicbox":
                    m += 12
                self.add(at + (b + float(self.rng.choice([0, 0.5]))) * self.beat, self.t.sprinkle, m, vel, 3.0, pan=0.45 * (1 if self.rng.random() < 0.5 else -1))

    # -- form ------------------------------------------------------------------

    def compose(self) -> float:
        t = self.t
        clock = 0.0
        cycle_index = 0
        motif_r = list(RHYTHMS[t.beats][int(self.rng.integers(len(RHYTHMS[t.beats])))])
        motif_c = CONTOURS[int(self.rng.integers(len(CONTOURS)))]
        answer_r = list(RHYTHMS[t.beats][int(self.rng.integers(len(RHYTHMS[t.beats])))])
        answer_c = CONTOURS[int(self.rng.integers(len(CONTOURS)))]
        mid = (t.melody_range[0] + t.melody_range[1]) // 2 - 2
        self.last_mel = mid
        self.pads: list[tuple[float, list[int], float, float]] = []
        total_cycles = sum(c for _, c in t.form)
        for section, cycles in t.form:
            if section == "B":
                # The B section gets its own motif, a little higher.
                motif_r = list(RHYTHMS[t.beats][int(self.rng.integers(len(RHYTHMS[t.beats])))])
                motif_c = CONTOURS[int(self.rng.integers(len(CONTOURS)))]
            for c in range(cycles):
                arc = 0.82 + 0.18 * math.sin(math.pi * (cycle_index + 0.5) / total_cycles)
                for i, chord in enumerate(t.chords):
                    at = clock
                    clock = at + self.chord_s
                    last_chord = section == "outro" and c == cycles - 1 and i == len(t.chords) - 1
                    # The pad: chord tones around middle C, every section but the busiest.
                    pad_notes = sorted({self.bass_root(chord) + 12 + q for q in QUALITIES[chord.quality][:4]})
                    pad_gain = {"intro": 0.8, "A": 0.75, "B": 0.6, "space": 1.0, "outro": 0.85}[section]
                    if t.pad_level > 0:
                        self.pads.append((at, pad_notes, self.chord_s + (2.5 if last_chord else 0.4), pad_gain * t.pad_level))
                    if last_chord:
                        # The end: the tonic held, the melody's last word, then quiet (it wraps into the start).
                        self.add(at, t.left, self.bass_root(chord), 0.4 * arc, self.chord_s, gain=LEFT_GAIN)
                        self.add(at + self.beat, t.left, self.bass_root(chord) + 7, 0.33 * arc, self.chord_s, gain=LEFT_GAIN)
                        self.add(at + 2 * self.beat, t.melody, self.nearest(mid, chord.rest_pcs(t.tonic)), 0.42 * arc, self.chord_s, pan=0.18)
                        continue
                    if section == "intro":
                        self.left_hand(at, chord, 0.38 * arc, "sparse")
                        self.sprinkle(at, chord, 0.32, 0.25)
                    elif section == "space":
                        self.left_hand(at, chord, 0.34 * arc, "drone")
                        self.sprinkle(at, chord, 0.3, 0.3)
                        if t.sprinkle is None and self.rng.random() < 0.5:
                            self.add(at + self.beat * 2, t.melody, self.nearest(mid + 5, chord.rest_pcs(t.tonic)), 0.3, self.chord_s)
                    elif section == "outro":
                        self.left_hand(at, chord, 0.36 * arc, "sparse")
                        if i % 2 == 0:
                            self.phrase(at, chord, motif_r[:3], motif_c, mid, 0.42 * arc, t.melody)
                    else:
                        busy = section == "B"
                        self.left_hand(at, chord, (0.42 if busy else 0.4) * arc, "flowing")
                        # Call, variation, answer, and a bar of rest (the A section rests more).
                        role = i % 4
                        start = mid + (4 if busy else 0)
                        vel = (0.5 if busy else 0.46) * arc
                        if role == 0:
                            self.phrase(at, chord, motif_r, motif_c, start, vel, t.melody)
                        elif role == 1:
                            # The motif again, a step higher (a sequence), lightly varied.
                            self.phrase(at, chord, self.vary(motif_r), motif_c, start + 3, vel * 0.95, t.melody)
                        elif role == 2:
                            self.phrase(at, chord, answer_r, answer_c, self.last_mel + 2, vel, t.melody)
                        elif busy or c % 2 == 1:
                            self.phrase(at, chord, self.vary(answer_r)[:2], [0, -1], self.last_mel - 1, vel * 0.85, t.melody)
                        self.sprinkle(at, chord, 0.28, 0.15 if busy else 0.1)
                cycle_index += 1
        return clock


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render(track: Track, out_dir: str) -> dict:
    comp = Composer(track)
    length_s = comp.compose()
    L = int(round(length_s * SR))
    tail = int(16 * SR)
    left = np.zeros(L + tail)
    right = np.zeros(L + tail)
    cache: dict[tuple, np.ndarray] = {}
    for note in track.notes:
        key = (note.inst, note.midi, round(note.vel * 20), round(note.hold * 4))
        sig = cache.get(key)
        if sig is None:
            sig = INSTRUMENTS[note.inst](comp.rng, note.midi, round(note.vel * 20) / 20, round(note.hold * 4) / 4)
            cache[key] = sig
        start = int(note.at * SR)
        end = min(start + len(sig), L + tail)
        pan = float(np.clip(note.pan + (note.midi - 64) / 120, -0.9, 0.9))
        gl, gr = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
        left[start:end] += sig[: end - start] * gl * note.gain
        right[start:end] += sig[: end - start] * gr * note.gain
    for at, midis, dur, level in comp.pads:
        pl, pr = pad(comp.rng, midis, dur, level * PAD_GAIN, track.pad_bright)
        start = int(at * SR)
        end = min(start + len(pl), L + tail)
        left[start:end] += pl[: end - start]
        right[start:end] += pr[: end - start]

    def fold(x: np.ndarray) -> np.ndarray:
        y = x[:L].copy()
        rest = x[L:]
        for i in range(0, len(rest), L):
            seg = rest[i : i + L]
            y[: len(seg)] += seg
        return y

    left, right = fold(left), fold(right)
    # The room: a large, soft hall (lows ring longer than highs), fed without the lowest lows.
    irl, irr = room_ir(comp.rng, 6.0, 4.6, 1.8)
    f = np.fft.rfftfreq(L, 1 / SR)
    send_shape = (1 - lowpass_weight(f, 180, 1)) * lowpass_weight(f, 6500, 1)
    mono = (left + right) * 0.5
    send = np.fft.irfft(np.fft.rfft(mono) * send_shape, n=L)
    wet_l = circular_convolve(send, irl)
    wet_r = circular_convolve(send, irr)
    mix_l = left + track.wet * wet_l
    mix_r = right + track.wet * wet_r
    # Master: a little warmth (high frequencies eased), no rumble.
    master = lowpass_weight(f, 9000, 1) * (1 - lowpass_weight(f, 32, 2))
    mix_l = np.fft.irfft(np.fft.rfft(mix_l) * master, n=L)
    mix_r = np.fft.irfft(np.fft.rfft(mix_r) * master, n=L)
    stereo = np.stack([mix_l, mix_r], axis=1)
    stereo /= np.max(np.abs(stereo)) / 0.5
    os.makedirs(out_dir, exist_ok=True)
    stereo.astype("<f4").tofile(os.path.join(out_dir, f"{track.name}.f32"))
    info = {"name": track.name, "title": track.title, "seconds": round(L / SR, 3), "notes": len(track.notes), "bpm": track.bpm, "key": track.scale}
    return info


I, ii, iii, IV, V, vi = 0, 2, 4, 5, 7, 9

TRACKS = [
    Track(
        name="first-light",
        title="First Light",
        seed=1101,
        tonic=62,  # D
        scale="major",
        bpm=64,
        beats=4,
        chords=[Chord(I, "maj9"), Chord(vi, "m9"), Chord(IV, "maj7"), Chord(V, "sus4")],
        form=[("intro", 1), ("A", 2), ("space", 1), ("B", 1), ("A", 1), ("outro", 1)],
        melody="piano",
        left="piano",
        melody_range=(69, 88),
        sprinkle=None,
        pad_level=0.7,
        pad_bright=0.5,
    ),
    Track(
        name="tide-pools",
        title="Tide Pools",
        seed=2207,
        tonic=57,  # A
        scale="major",
        bpm=76,
        beats=3,
        chords=[Chord(vi, "m9"), Chord(IV, "maj7"), Chord(I, "add9"), Chord(V, "sus4")],
        form=[("intro", 1), ("A", 2), ("B", 1), ("space", 1), ("A", 2), ("outro", 1)],
        melody="musicbox",
        left="piano",
        melody_range=(76, 93),
        sprinkle="musicbox",
        pad_level=1.0,
        pad_bright=0.7,
        wet=0.48,
    ),
    Track(
        name="long-grass",
        title="Long Grass",
        seed=3313,
        tonic=63,  # E-flat
        scale="lydian",
        bpm=58,
        beats=3,
        chords=[Chord(I, "maj9"), Chord(ii, "add9"), Chord(vi, "m7"), Chord(IV, "6/9")],
        form=[("intro", 1), ("A", 2), ("space", 1), ("B", 1), ("A", 1), ("outro", 1)],
        melody="piano",
        left="piano",
        melody_range=(70, 89),
        sprinkle="musicbox",
        pad_level=0.85,
        pad_bright=0.45,
    ),
    Track(
        name="harbour-lights",
        title="Harbour Lights",
        seed=4421,
        tonic=55,  # G
        scale="major",
        bpm=68,
        beats=4,
        chords=[Chord(I, "maj7"), Chord(iii, "m7"), Chord(IV, "maj9"), Chord(ii, "m9")],
        form=[("intro", 1), ("A", 2), ("B", 1), ("space", 1), ("A", 1), ("outro", 1)],
        melody="epiano",
        left="epiano",
        melody_range=(67, 86),
        sprinkle="musicbox",
        pad_level=0.9,
        pad_bright=0.6,
        wet=0.38,
    ),
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    only = set(sys.argv[2:])
    infos = []
    for track in TRACKS:
        if only and track.name not in only:
            continue
        info = render(track, out)
        infos.append(info)
        print(json.dumps(info))
    with open(os.path.join(out, "tracks.json"), "w") as fh:
        json.dump(infos, fh, indent=2)


if __name__ == "__main__":
    main()
