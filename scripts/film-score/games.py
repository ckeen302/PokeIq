"""Original music for the PokeIQ Games: a short brass fanfare for each gold
medal and a ceremonial anthem for the medal ceremonies, written here as MIDI
and rendered with FluidSynth + MuseScore General (MIT) by games.sh.

Both pieces are new compositions in B-flat major (not music from, or a cover
of, any Pokemon game or any real ceremony):

- the fanfare: 2 bars at 112 bpm, a rising triplet call on trumpets in
  thirds over horns, trombones and tuba, a timpani roll into the last chord
  and a cymbal;
- the anthem: 4 bars at 84 bpm, a hymn-like tune on horns and strings over
  a brass choir, ending on a held chord, so it sits under the podium shot.

Usage: python3 -I games.py <outdir>
"""
import os
import struct
import sys

OUT = sys.argv[1]
TPQ = 480


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


class Track:
    def __init__(self, ch, program, name, vol=100, pan=64, rev=70):
        self.ch = ch
        self.ev = []
        self.name = name
        self.ev.append((0, 0, bytes([0xB0 | ch, 0, 0])))
        self.ev.append((0, 1, bytes([0xC0 | ch, program])))
        for num, val in ((7, vol), (10, pan), (91, rev), (93, 0), (11, 127)):
            self.ev.append((0, 0, bytes([0xB0 | ch, num, val])))

    def note(self, beat, dur, pitch, vel):
        t0 = int(round(beat * TPQ))
        t1 = max(t0 + 1, int(round((beat + dur) * TPQ)))
        self.ev.append((t0, 3, bytes([0x90 | self.ch, pitch, max(1, min(127, int(vel)))])))
        self.ev.append((t1, 2, bytes([0x80 | self.ch, pitch, 0])))

    def chord(self, beat, dur, pitches, vel):
        for p in pitches:
            self.note(beat, dur, p, vel)

    def expr(self, b0, b1, v0, v1, steps=12):
        for i in range(steps + 1):
            k = i / steps
            self.ev.append((int(round((b0 + (b1 - b0) * k) * TPQ)), 0, bytes([0xB0 | self.ch, 11, int(v0 + (v1 - v0) * k)])))

    def chunk(self):
        data = bytearray()
        name = self.name.encode()
        data += vlq(0) + bytes([0xFF, 0x03]) + vlq(len(name)) + name
        last = 0
        for t, _, b in sorted(self.ev, key=lambda e: (e[0], e[1])):
            data += vlq(t - last) + b
            last = t
        data += vlq(0) + bytes([0xFF, 0x2F, 0x00])
        return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def write(path, tracks, bpm):
    tempo = bytearray()
    tempo += vlq(0) + bytes([0xFF, 0x51, 0x03]) + struct.pack(">I", int(60_000_000 / bpm))[1:]
    tempo += vlq(0) + bytes([0xFF, 0x58, 0x04, 4, 2, 24, 8])
    tempo += vlq(0) + bytes([0xFF, 0x2F, 0x00])
    head = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks) + 1, TPQ)
    with open(path, "wb") as f:
        f.write(head + b"MTrk" + struct.pack(">I", len(tempo)) + bytes(tempo) + b"".join(t.chunk() for t in tracks))


# General MIDI programs (0-based) and the percussion channel.
TRUMPET, TROMBONE, TUBA, HORN, BRASS, STRINGS, CELLO, CONTRABASS, TIMPANI, CHOIR = 56, 57, 58, 60, 61, 48, 42, 43, 47, 52
PERC = 9

# Pitches: B-flat major.
Bb2, F2, Eb3, F3, G3, Bb3, C4, D4, Eb4, F4, G4, A4, Bb4, C5, D5, Eb5, F5, G5, A5, Bb5 = 46, 41, 51, 53, 55, 58, 60, 62, 63, 65, 67, 69, 70, 72, 74, 75, 77, 79, 81, 82


def fanfare():
    tp1 = Track(0, TRUMPET, "Trumpet 1", 112, 54)
    tp2 = Track(1, TRUMPET, "Trumpet 2", 104, 74)
    hn = Track(2, HORN, "Horns", 100, 40)
    tb = Track(3, TROMBONE, "Trombones", 100, 88)
    tu = Track(4, TUBA, "Tuba", 104, 64)
    ti = Track(5, TIMPANI, "Timpani", 110, 64)
    cy = Track(PERC, 0, "Cymbals", 100, 64)
    # Bar 1: a triplet pickup into a call that climbs (Bb-D-F, F-Bb), answered a third below.
    call = [(0, 1 / 3, Bb4), (1 / 3, 1 / 3, D5), (2 / 3, 1 / 3, F5), (1, 1.5, Bb5), (2.5, 0.5, A5), (3, 1 / 3, G5), (3 + 1 / 3, 1 / 3, A5), (3 + 2 / 3, 1 / 3, Bb5)]
    for b, d, p in call:
        tp1.note(b, d * 0.92, p, 112)
        tp2.note(b, d * 0.92, p - 4 if p in (D5, A5, Bb5) else p - 3, 100)
    # Bar 2: the last chord, held, with a swell.
    tp1.note(4, 3.5, Bb5, 118)
    tp2.note(4, 3.5, F5, 110)
    hn.chord(1, 1.5, [D4, F4], 92)
    hn.chord(2.5, 1.5, [Eb4, G4], 92)
    hn.chord(4, 3.5, [D4, F4, Bb4], 104)
    tb.chord(1, 1.5, [Bb3, D4], 92)
    tb.chord(2.5, 1.5, [C4, Eb4], 92)
    tb.chord(4, 3.5, [F3, Bb3, D4], 106)
    tu.note(1, 1.5, Bb2, 100)
    tu.note(2.5, 1.5, F2, 100)
    tu.note(4, 3.5, Bb2, 110)
    for i in range(12):
        ti.note(3 + i / 12, 1 / 12, F2 + 12, 60 + i * 4)
    ti.note(4, 1.5, Bb2 + 12, 120)
    cy.note(4, 2.5, 49, 110)
    for t in (hn, tb, tu, tp1, tp2):
        t.expr(4, 7.5, 110, 127, 8)
    write(os.path.join(OUT, "games-fanfare.mid"), [tp1, tp2, hn, tb, tu, ti, cy], 112)


def anthem():
    mel = Track(0, HORN, "Horn melody", 112, 56)
    tp = Track(1, TRUMPET, "Trumpet", 90, 70)
    st = Track(2, STRINGS, "Strings", 100, 64)
    vc = Track(3, CELLO, "Cellos", 100, 50)
    cb = Track(4, CONTRABASS, "Basses", 96, 78)
    br = Track(5, BRASS, "Brass choir", 92, 64)
    ch = Track(6, CHOIR, "Choir", 70, 64)
    ti = Track(7, TIMPANI, "Timpani", 96, 64)
    cy = Track(PERC, 0, "Cymbal", 90, 64)
    # The tune: four bars, the last held.
    tune = [
        (0, 1.5, Bb4), (1.5, 0.5, C5), (2, 1, D5), (3, 1, F5),
        (4, 1.5, Eb5), (5.5, 0.5, D5), (6, 1, C5), (7, 1, Bb4),
        (8, 1, C5), (9, 1, D5), (10, 1.5, Eb5), (11.5, 0.5, G5),
        (12, 4, F5),
    ]
    for b, d, p in tune:
        mel.note(b, d * 0.96, p, 104)
    # Trumpet joins for the climb and the last note.
    for b, d, p in [(8, 1, C5), (9, 1, D5), (10, 1.5, Eb5), (11.5, 0.5, G5), (12, 4, F5)]:
        tp.note(b, d * 0.95, p, 92)
    # Harmony, a chord per half bar: I, V/vi, IV, V | IV, I, ii, V | IV, V/V, IV, ii | V(sus) ... V-I
    prog = [
        (0, [Bb3, D4, F4], Bb2), (2, [D4, F4, Bb4], Bb2), (4, [Eb4, G4, Bb4], Eb3), (6, [F4, A4, C5], F2),
        (8, [Eb4, G4, C5], Eb3), (10, [Eb4, G4, Bb4], Eb3), (12, [F4, Bb4, D5], F2), (14, [F4, Bb4, D5], Bb2),
    ]
    for b, notes, bass in prog:
        st.chord(b, 2, notes, 80)
        br.chord(b, 2, [n - 12 for n in notes], 70)
        vc.note(b, 2, bass + 12, 86)
        cb.note(b, 2, bass, 86)
    ch.chord(12, 4, [D4, F4, Bb4], 72)
    st.expr(0, 12, 90, 120, 12)
    st.expr(12, 16, 120, 100, 6)
    for i in range(16):
        ti.note(11 + i / 16, 1 / 16, F2 + 12, 50 + i * 3)
    ti.note(12, 2, Bb2 + 12, 110)
    cy.note(12, 3, 57, 96)
    write(os.path.join(OUT, "games-anthem.mid"), [mel, tp, st, vc, cb, br, ch, ti, cy], 84)


os.makedirs(OUT, exist_ok=True)
fanfare()
anthem()
