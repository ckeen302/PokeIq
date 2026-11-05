"""Original score for the two PokeIQ films, written as MIDI and rendered with
FluidSynth + MuseScore General (MIT; strings from VSCO 2 CE, CC0).

Each film has ONE theme (a leitmotif). Every stem is an arrangement of the
same 24-bar form (A theme, B bridge, A' theme) in the same key and tempo, so
any mix of stems is in tune and in time, and the per-chapter mix decides how
the theme sounds: quiet and curious, warm, or full orchestra.

Usage: python3 -I score.py <outdir>
"""
import random
import struct
import sys

OUT = sys.argv[1]

# ---------------------------------------------------------------------------
# MIDI writer
# ---------------------------------------------------------------------------
TPQ = 480


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


class Track:
    def __init__(self, ch, program=None, name="", vol=100, pan=64, rev=60, cho=0, bank=0):
        self.ch = ch
        self.ev = []  # (tick, order, bytes)
        self.name = name
        if program is not None:
            self.cc(0, 0, bank)
            self.ev.append((0, 1, bytes([0xC0 | ch, program])))
        self.cc(0, 7, vol)
        self.cc(0, 10, pan)
        self.cc(0, 91, rev)
        self.cc(0, 93, cho)
        self.cc(0, 11, 127)

    def cc(self, beat, num, val, order=0):
        self.ev.append((int(round(beat * TPQ)), order, bytes([0xB0 | self.ch, num, max(0, min(127, int(val)))])))

    def note(self, beat, dur, pitch, vel):
        if pitch is None:
            return
        t0 = max(0, int(round(beat * TPQ)))
        t1 = max(t0 + 1, int(round((beat + dur) * TPQ)))
        v = max(1, min(127, int(vel)))
        self.ev.append((t0, 3, bytes([0x90 | self.ch, pitch, v])))
        self.ev.append((t1, 2, bytes([0x80 | self.ch, pitch, 0])))

    def ramp(self, b0, b1, num, v0, v1, steps=16):
        for i in range(steps + 1):
            k = i / steps
            self.cc(b0 + (b1 - b0) * k, num, v0 + (v1 - v0) * k)

    def bytes(self):
        ev = sorted(self.ev, key=lambda e: (e[0], e[1]))
        out = b""
        if self.name:
            nm = self.name.encode()
            out += vlq(0) + b"\xff\x03" + vlq(len(nm)) + nm
        last = 0
        for t, _, b in ev:
            out += vlq(t - last) + b
            last = t
        out += vlq(0) + b"\xff\x2f\x00"
        return b"MTrk" + struct.pack(">I", len(out)) + out


def write_midi(path, tracks, bpm):
    tempo = int(60_000_000 / bpm)
    t0 = vlq(0) + b"\xff\x51\x03" + struct.pack(">I", tempo)[1:] + vlq(0) + b"\xff\x58\x04\x04\x02\x18\x08" + vlq(0) + b"\xff\x2f\x00"
    data = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks) + 1, TPQ) + b"MTrk" + struct.pack(">I", len(t0)) + t0
    for tr in tracks:
        data += tr.bytes()
    with open(path, "wb") as f:
        f.write(data)


# ---------------------------------------------------------------------------
# Music helpers
# ---------------------------------------------------------------------------
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DUR = {"w": 4, "h": 2, "q": 1, "e": 0.5, "s": 0.25}


def pitch(name):
    if name == "r":
        return None
    n = NOTE[name[0]]
    i = 1
    while i < len(name) and name[i] in "#b":
        n += 1 if name[i] == "#" else -1
        i += 1
    return n + 12 * (int(name[i:]) + 1)


def melody(src):
    """'F#4:e A4:q.' -> [(beat, dur, pitch)] (beats from the phrase start)."""
    out, t = [], 0.0
    for tok in src.split():
        nm, d = tok.split(":")
        dur = DUR[d.rstrip(".")] * (1.5 if d.endswith(".") else 1)
        out.append((t, dur, pitch(nm)))
        t += dur
    return out, t


CHORD = {
    "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "sus4": [0, 5, 7], "sus2": [0, 2, 7], "add9": [0, 4, 7, 14], "m6": [0, 3, 7, 9], "madd9": [0, 3, 7, 14],
}


def chord(sym):
    root = sym[0]
    i = 1
    if len(sym) > 1 and sym[1] in "#b":
        i = 2
    pc = NOTE[root] + (1 if "#" in sym[1:i] else -1 if "b" in sym[1:i] else 0)
    q = sym[i:]
    return pc % 12, CHORD[q]


def voice(pc, ivs, lo, hi):
    """All chord-tone pitches in [lo, hi]."""
    pcs = {(pc + iv) % 12 for iv in ivs}
    return [p for p in range(lo, hi + 1) if p % 12 in pcs]


def nearest(pc, around):
    best = None
    for p in range(around - 7, around + 7):
        if p % 12 == pc % 12 and (best is None or abs(p - around) < abs(best - around)):
            best = p
    return best


class Song:
    def __init__(self, key_name, bpm, prog, mel, seed):
        self.bpm = bpm
        self.prog = prog  # list of bars: list of (beats, chordsym)
        self.mel = mel  # list of (beat, dur, pitch), absolute beats in one pass
        self.bars = len(prog)
        self.beats = self.bars * 4
        self.rng = random.Random(seed)

    def chord_at(self, beat):
        bar = int(beat // 4) % self.bars
        b = beat - 4 * int(beat // 4)
        acc = 0
        for d, sym in self.prog[bar]:
            if b < acc + d - 1e-6:
                return sym
            acc += d
        return self.prog[bar][-1][1]

    def chords_in_bar(self, bar):
        acc = 0
        out = []
        for d, sym in self.prog[bar % self.bars]:
            out.append((bar * 4 + acc, d, sym))
            acc += d
        return out

    def h(self, amt=0.012):
        """Timing humanisation, in beats."""
        return self.rng.uniform(-amt, amt) * self.bpm / 60

    def v(self, base, spread=6):
        return base + self.rng.randint(-spread, spread)


def section_of(bar):
    b = bar % 24
    return "A" if b < 8 else "B" if b < 16 else "A2"


# ---------------------------------------------------------------------------
# THE STORY OF POKÉMON: D major, 84 bpm. Theme: a rising sixth that asks
# ("what's under the rock?"), a sequence a step higher, then the answer that
# climbs past it and comes home.
# ---------------------------------------------------------------------------
S_A = (
    "F#4:e A4:e D5:q. C#5:e B4:q "  # 1 D
    "A4:h. r:q "                     # 2 Gmaj7
    "G4:e B4:e E5:q. D5:e C#5:q "    # 3 Em7
    "B4:q. A4:e A4:h "               # 4 Asus4 A
    "F#4:e A4:e D5:q. E5:e F#5:q "   # 5 D
    "E5:q. D5:e B4:h "               # 6 G
    "G4:e B4:e D5:q C#5:q E5:q "     # 7 Em7 A7
    "D5:w "                          # 8 D
)
S_B = (
    "B4:q. C#5:e D5:q F#5:q "        # 9 Bm
    "E5:h. D5:q "                    # 10 G
    "D5:q. C#5:e B4:q A4:q "         # 11 D
    "A4:h. r:q "                     # 12 A
    "B4:q. C#5:e D5:q F#5:q "        # 13 Bm
    "G5:h. F#5:e E5:e "              # 14 G
    "E5:q. D5:e B4:q G4:q "          # 15 Em7
    "A4:h C#5:q E5:q "               # 16 Asus4 A
)
S_A2 = S_A.replace("G4:e B4:e D5:q C#5:q E5:q D5:w", "G4:e B4:e D5:q E5:q C#5:q D5:w")
S_PROG = (
    [[(4, "D")], [(4, "Gmaj7")], [(4, "Em7")], [(2, "Asus4"), (2, "A")], [(4, "D")], [(4, "G")], [(2, "Em7"), (2, "A7")], [(4, "D")]]
    + [[(4, "Bm")], [(4, "G")], [(4, "D")], [(4, "A")], [(4, "Bm")], [(4, "G")], [(4, "Em7")], [(2, "Asus4"), (2, "A")]]
    + [[(4, "D")], [(4, "Gmaj7")], [(4, "Em7")], [(2, "Asus4"), (2, "A")], [(4, "D")], [(4, "G")], [(2, "Em7"), (2, "A7")], [(4, "D")]]
)

# ---------------------------------------------------------------------------
# THE HISTORY OF THE POKÉMON WORLD: D minor, 70 bpm. Theme: an open fifth
# (the world before anything), a falling line, then the same idea an octave
# higher; the bridge turns heroic in the relative major.
# ---------------------------------------------------------------------------
W_A = (
    "D4:q. A4:e A4:h "               # 1 Dm
    "Bb4:q A4:q G4:q F4:q "          # 2 Bb
    "E4:q. F4:e G4:h "               # 3 C
    "A4:w "                          # 4 Asus4 A
    "D5:q. C5:e A4:h "               # 5 Dm
    "Bb4:q A4:q G4:q E4:q "          # 6 Gm6
    "F4:q. G4:e E4:q. C#4:e "        # 7 Bb A7
    "D4:w "                          # 8 Dm
)
W_B = (
    "C5:q. F5:e F5:h "               # 9 F
    "E5:q D5:q C5:q G4:q "           # 10 C
    "A4:q. D5:e D5:h "               # 11 Dm
    "F5:q E5:q D5:q Bb4:q "          # 12 Bb
    "G4:q. Bb4:e D5:h "              # 13 Gm
    "F5:q E5:q D5:q A4:q "           # 14 Dm
    "Bb4:q. C5:e D5:q E5:q "         # 15 Bb C
    "D5:h C#5:h "                    # 16 Asus4 A
)
W_A2 = W_A
W_PROG = (
    [[(4, "Dm")], [(4, "Bb")], [(4, "C")], [(2, "Asus4"), (2, "A")], [(4, "Dm")], [(4, "Gm6")], [(2, "Bb"), (2, "A7")], [(4, "Dm")]]
    + [[(4, "F")], [(4, "C")], [(4, "Dm")], [(4, "Bb")], [(4, "Gm")], [(4, "Dm")], [(2, "Bb"), (2, "C")], [(2, "Asus4"), (2, "A")]]
    + [[(4, "Dm")], [(4, "Bb")], [(4, "C")], [(2, "Asus4"), (2, "A")], [(4, "Dm")], [(4, "Gm6")], [(2, "Bb"), (2, "A7")], [(4, "Dm")]]
)


def build_song(a, b, a2, prog, bpm, seed):
    ma, la = melody(a)
    mb, lb = melody(b)
    m2, l2 = melody(a2)
    assert la == 32 and lb == 32 and l2 == 32, (la, lb, l2)
    mel = ma + [(t + 32, d, p) for t, d, p in mb] + [(t + 64, d, p) for t, d, p in m2]
    return Song("", bpm, prog, mel, seed)


PASSES = 3  # rendered three times; the middle pass, crossfaded into the third at its start, is the loop


def each_pass(song, fn):
    for k in range(PASSES):
        fn(k * song.beats)


def melody_part(song, tr, off, transpose=0, vel=72, legato=0.95, sections=("A", "B", "A2"), swell=False, hum=0.01, vel_curve=None):
    for t, d, p in song.mel:
        if p is None:
            continue
        sec = section_of(int(t // 4))
        if sec not in sections:
            continue
        v = vel + (8 if d >= 1.5 else 0) - (6 if d <= 0.5 else 0)
        if vel_curve:
            v += vel_curve(t)
        tr.note(off + t + song.h(hum), d * legato, p + transpose, song.v(v, 4))


# ---------------------------------------------------------------------------
# Story stems
# ---------------------------------------------------------------------------

def story_bed(song):
    """Piano: the theme in the right hand over flowing broken chords."""
    rh = Track(0, 0, "piano rh", vol=100, pan=58, rev=70)
    lh = Track(1, 0, "piano lh", vol=92, pan=70, rev=70)
    def go(off):
        melody_part(song, rh, off, 0, vel=64, legato=1.0, sections=("A", "B"))
        melody_part(song, rh, off, 12, vel=56, legato=1.0, sections=("A2",))
        for bar in range(song.bars):
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                root = nearest(pc, 38)
                fifth = root + 7
                tenth = nearest((pc + ivs[1]) % 12, 57)
                top = nearest((pc + ivs[-1 if len(ivs) < 4 else 3]) % 12, 62)
                pat = [root, fifth, tenth, fifth + 12 if fifth + 12 < 62 else tenth, top, tenth, fifth, tenth]
                steps = int(d / 0.5)
                for i in range(steps):
                    tr = lh
                    tr.note(off + b0 + i * 0.5 + song.h(0.008), 0.9, pat[i % 8], song.v(46 if i else 54, 4))
            # Sustain pedal per bar (and per chord change).
            for (b0, d, sym) in song.chords_in_bar(bar):
                lh.cc(off + b0 + 0.02, 64, 127)
                lh.cc(off + b0 + d - 0.04, 64, 0)
                rh.cc(off + b0 + 0.02, 64, 100)
                rh.cc(off + b0 + d - 0.04, 64, 0)
    each_pass(song, go)
    return [rh, lh]


def story_curious(song):
    """Celesta and music box carry the theme, pizzicato strings tiptoe under it, a flute answers in the bridge."""
    cel = Track(0, 8, "celesta", vol=104, pan=50, rev=80)
    box = Track(1, 10, "music box", vol=80, pan=84, rev=90)
    piz = Track(2, 45, "pizz", vol=96, pan=72, rev=55)
    flu = Track(3, 73, "flute", vol=86, pan=44, rev=75)
    harp = Track(4, 46, "harp", vol=84, pan=80, rev=80)
    def go(off):
        melody_part(song, cel, off, 12, vel=70, legato=0.7, sections=("A", "A2"))
        melody_part(song, flu, off, 0, vel=62, legato=0.98, sections=("B",))
        for bar in range(song.bars):
            sec = section_of(bar)
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                root = nearest(pc, 43)
                # Pizzicato: root on 1, fifth on 3, a pickup on 4&.
                for k in range(int(d)):
                    p = root if k % 2 == 0 else root + 7
                    piz.note(off + b0 + k + song.h(), 0.3, p, song.v(62 if k == 0 else 50))
                if d == 4:
                    piz.note(off + b0 + 3.5, 0.2, nearest((pc + ivs[1]) % 12, 52), song.v(44))
                # Music box: a twinkling broken chord, high and quiet.
                tones = voice(pc, ivs[:3], 74, 91)
                if sec == "B" or bar % 2 == 1:
                    for i in range(int(d * 2)):
                        box.note(off + b0 + i * 0.5 + 0.25 + song.h(0.006), 0.5, tones[(i * 2) % len(tones)], song.v(40, 5))
                # Harp: a soft roll at each chord.
                roll = voice(pc, ivs[:3], 50, 69)
                for i, p in enumerate(roll):
                    harp.note(off + b0 + i * 0.06, d, p, song.v(40))
    each_pass(song, go)
    return [cel, box, piz, flu, harp]


def story_bright(song):
    """Chiptune: the theme on a square lead, a fast arpeggio, a pulse bass and noise hats (the Game Boy years)."""
    lead = Track(0, 80, "square lead", vol=78, pan=60, rev=30)
    arp = Track(1, 80, "square arp", vol=52, pan=76, rev=25)
    bass = Track(2, 80, "pulse bass", vol=74, pan=64, rev=10)
    dr = Track(9, None, "noise", vol=62, pan=64, rev=15)
    def go(off):
        melody_part(song, lead, off, 0, vel=74, legato=0.82, sections=("A", "A2"), hum=0.0)
        # In the bridge the lead plays the theme's head in echo, an octave up.
        melody_part(song, lead, off, 12, vel=52, legato=0.5, sections=("B",), hum=0.0)
        for bar in range(song.bars):
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                tones = voice(pc, ivs[:3], 69, 86)[:4]
                for i in range(int(d * 4)):
                    arp.note(off + b0 + i * 0.25, 0.2, tones[i % len(tones)], 60 if i % 4 == 0 else 48)
                root = nearest(pc, 38)
                for i in range(int(d * 2)):
                    bass.note(off + b0 + i * 0.5, 0.4, root + (12 if i % 2 else 0), 70 if i % 2 == 0 else 60)
            for i in range(8):
                dr.note(off + bar * 4 + i * 0.5, 0.1, 42, 52 if i % 2 == 0 else 36)
            dr.note(off + bar * 4 + 1, 0.1, 40, 46)
            dr.note(off + bar * 4 + 3, 0.1, 40, 46)
    each_pass(song, go)
    return [lead, arp, bass, dr]


def story_drive(song):
    """A light band: kick, clap and hats, shaker, a fingered bass and a strummed acoustic guitar."""
    dr = Track(9, None, "kit", vol=100, pan=64, rev=35)
    bass = Track(0, 33, "bass", vol=96, pan=64, rev=15)
    gtr = Track(1, 25, "guitar", vol=82, pan=40, rev=45)
    uke = Track(2, 24, "nylon", vol=70, pan=90, rev=50)
    def go(off):
        for bar in range(song.bars):
            o = off + bar * 4
            sec = section_of(bar)
            for k, b in enumerate([0, 1.5, 2, 2.75]):
                if k == 3 and sec != "B":
                    continue
                dr.note(o + b, 0.2, 36, song.v(92 if b in (0, 2) else 70))
            for b in (1, 3):
                dr.note(o + b, 0.2, 39 if sec != "A" else 37, song.v(74))
                if sec == "B":
                    dr.note(o + b, 0.2, 54, song.v(58))
            for i in range(8):
                dr.note(o + i * 0.5 + song.h(0.004), 0.1, 42, song.v(58 if i % 2 == 0 else 42, 4))
            for i in range(16):
                dr.note(o + i * 0.25 + song.h(0.004), 0.1, 82, song.v(40 if i % 4 else 52, 4))
            if bar % 8 == 7:
                for i, b in enumerate([3, 3.25, 3.5, 3.75]):
                    dr.note(o + b, 0.2, [45, 45, 43, 41][i], song.v(70 + i * 4))
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                root = nearest(pc, 38)
                for b, p in [(0, root), (0.75, root), (1.5, root + 7), (2, root), (2.75, root + 12), (3.5, root + 7)]:
                    if b < d:
                        bass.note(off + b0 + b + song.h(0.005), 0.4, p, song.v(84))
                # Strum: down-down-up-up-down-up with a little spread across strings.
                g = voice(pc, ivs[:3], 52, 67)[:5]
                for b, up, vel in [(0, False, 78), (1, False, 66), (1.5, True, 54), (2.5, True, 54), (3, False, 66), (3.5, True, 54)]:
                    if b >= d:
                        continue
                    seq = list(reversed(g)) if up else g
                    for i, p in enumerate(seq):
                        gtr.note(off + b0 + b + i * 0.012, 0.42, p, song.v(vel - (8 if up else 0), 3))
                # High nylon: a little sparkle on the off-beats (the "ukulele").
                u = voice(pc, ivs[:3], 67, 79)[:3]
                for b in (0.5, 2.5):
                    if b < d:
                        for i, p in enumerate(u):
                            uke.note(off + b0 + b + i * 0.01, 0.3, p, song.v(52, 3))
    each_pass(song, go)
    return [dr, bass, gtr, uke]


def story_warm(song):
    """Strings and horn: the theme turns warm. Clarinet in A, horn in the bridge and A', a cello line below."""
    st = Track(0, 48, "strings", vol=96, pan=64, rev=75)
    vc = Track(1, 42, "cello", vol=92, pan=78, rev=70)
    cl = Track(2, 71, "clarinet", vol=92, pan=46, rev=72)
    hn = Track(3, 60, "horn", vol=96, pan=54, rev=78)
    def go(off):
        melody_part(song, cl, off, 0, vel=66, sections=("A",))
        melody_part(song, hn, off, -12, vel=72, sections=("B", "A2"))
        for bar in range(song.bars):
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                pad = voice(pc, ivs, 55, 72)
                for p in pad[:4]:
                    st.note(off + b0 + song.h(0.01), d, p, song.v(56, 3))
                st.ramp(off + b0, off + b0 + d * 0.5, 11, 80, 112, 6)
                st.ramp(off + b0 + d * 0.5, off + b0 + d, 11, 112, 88, 6)
                # Cello: root, then a stepwise walk to the next chord.
                root = nearest(pc, 45)
                vc.note(off + b0, d * 0.5, root, song.v(66))
                vc.note(off + b0 + d * 0.5, d * 0.5, nearest((pc + ivs[1]) % 12, 50), song.v(58))
    each_pass(song, go)
    return [st, vc, cl, hn]


def story_swell(song):
    """Full orchestra: violins and trumpet on the theme in octaves, horns and trombones on the harmony, choir, timpani and cymbals."""
    vn = Track(0, 48, "violins", vol=110, pan=48, rev=80)
    lo = Track(1, 48, "low strings", vol=104, pan=80, rev=78)
    tp = Track(2, 56, "trumpet", vol=84, pan=58, rev=80)
    hn = Track(3, 60, "horns", vol=100, pan=70, rev=82)
    tb = Track(4, 57, "trombones", vol=86, pan=76, rev=82)
    ch = Track(5, 52, "choir", vol=88, pan=64, rev=90)
    tim = Track(6, 47, "timpani", vol=104, pan=64, rev=70)
    gl = Track(7, 9, "glock", vol=70, pan=40, rev=85)
    cb = Track(8, 43, "contrabass", vol=100, pan=72, rev=70)
    dr = Track(9, None, "cymbals", vol=96, pan=64, rev=80)
    def go(off):
        melody_part(song, vn, off, 12, vel=86, legato=1.0)
        melody_part(song, vn, off, 0, vel=74, legato=1.0)
        melody_part(song, tp, off, 0, vel=80, sections=("A2",))
        melody_part(song, hn, off, -12, vel=84, sections=("A", "B"))
        melody_part(song, gl, off, 24, vel=60, legato=0.5, sections=("A2",))
        for bar in range(song.bars):
            o = off + bar * 4
            sec = section_of(bar)
            if bar % 8 == 0:
                dr.note(o, 3, 49, song.v(96 if sec != "B" else 80))
                tim.note(o, 1, nearest(2, 40), 110)
            if bar % 8 == 7:
                # A timpani roll and a suspended-cymbal swell into the next phrase.
                for i in range(16):
                    tim.note(o + 2 + i * 0.125, 0.12, nearest(9, 45), 40 + i * 4)
                for i in range(12):
                    dr.note(o + 2.5 + i * 0.125, 0.12, 51, 30 + i * 6)
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                for p in voice(pc, ivs[:3], 48, 64)[:4]:
                    lo.note(off + b0, d, p, song.v(70, 3))
                for p in voice(pc, ivs[:3], 55, 70)[:3]:
                    tb.note(off + b0, d * 0.95, p, song.v(64, 3))
                for p in voice(pc, ivs[:3], 60, 76)[:4]:
                    ch.note(off + b0, d, p, song.v(64, 3))
                root = nearest(pc, 33)
                cb.note(off + b0, d, root, song.v(80))
                # Timpani pulse on the root (or fifth) at each chord change.
                tp_p = nearest(pc, 43) if 40 <= nearest(pc, 43) <= 50 else nearest((pc + 7) % 12, 45)
                tim.note(off + b0, 0.5, tp_p, song.v(84))
                if d == 4:
                    tim.note(off + b0 + 2, 0.5, tp_p, song.v(64))
                lo.ramp(off + b0, off + b0 + d, 11, 100, 124, 6)
    each_pass(song, go)
    return [vn, lo, tp, hn, tb, ch, tim, gl, cb, dr]


# ---------------------------------------------------------------------------
# World History stems (layer names kept: bed, cave, ice, epic)
# ---------------------------------------------------------------------------

def world_bed(song):
    """A dark pad (slow strings, low choir) with the theme on a solo cello, then the oboe in the bridge."""
    pad = Track(0, 49, "slow strings", vol=96, pan=64, rev=95)
    choir = Track(1, 52, "choir", vol=70, pan=60, rev=100)
    vc = Track(2, 42, "solo cello", vol=104, pan=56, rev=85)
    ob = Track(3, 68, "oboe", vol=86, pan=46, rev=85)
    def go(off):
        melody_part(song, vc, off, -12, vel=72, legato=1.0, sections=("A",))
        melody_part(song, ob, off, 0, vel=62, legato=1.0, sections=("B",))
        melody_part(song, vc, off, 0, vel=64, legato=1.0, sections=("A2",))
        for bar in range(song.bars):
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                for p in voice(pc, ivs[:3], 45, 62)[:4]:
                    pad.note(off + b0, d, p, song.v(54, 3))
                pad.ramp(off + b0, off + b0 + d * 0.6, 11, 70, 110, 6)
                pad.ramp(off + b0 + d * 0.6, off + b0 + d, 11, 110, 80, 4)
                for p in voice(pc, ivs[:3], 57, 69)[:3]:
                    choir.note(off + b0, d, p, song.v(42, 3))
                pad.note(off + b0, d, nearest(pc, 33), song.v(58))
    each_pass(song, go)
    return [pad, choir, vc, ob]


def world_cave(song):
    """Deep: a low string ostinato, a slow drum heartbeat, a marimba figure and bowed drones (ruins and laboratories)."""
    ost = Track(0, 48, "low ostinato", vol=100, pan=70, rev=60)
    cb = Track(1, 43, "contrabass", vol=100, pan=64, rev=60)
    mar = Track(2, 12, "marimba", vol=80, pan=44, rev=80)
    dr = Track(9, None, "drums", vol=104, pan=64, rev=70)
    tim = Track(3, 47, "timpani", vol=96, pan=64, rev=75)
    def go(off):
        for bar in range(song.bars):
            o = off + bar * 4
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                root = nearest(pc, 38)
                for i in range(int(d * 2)):
                    p = root if i % 4 != 3 else root + 7
                    ost.note(off + b0 + i * 0.5 + song.h(0.005), 0.32, p, song.v(66 if i % 2 == 0 else 52))
                cb.note(off + b0, d, nearest(pc, 28), song.v(70))
                tones = voice(pc, ivs[:3], 57, 72)
                for i, b in enumerate([0.5, 1.25, 2.5, 3.25]):
                    if b < d:
                        mar.note(off + b0 + b, 0.4, tones[(i * 2 + bar) % len(tones)], song.v(48))
            # Heartbeat: low tom + kick, a floor-tom answer.
            dr.note(o, 0.3, 35, song.v(84))
            dr.note(o + 0.5, 0.3, 35, song.v(60))
            dr.note(o + 2, 0.3, 41, song.v(66))
            if bar % 2 == 1:
                dr.note(o + 3.5, 0.3, 43, song.v(56))
            if bar % 4 == 0:
                tim.note(o, 1, nearest(2, 40), song.v(80))
    each_pass(song, go)
    return [ost, cb, mar, dr, tim]


def world_ice(song):
    """High and cold: harp and celesta arpeggios, the theme in glockenspiel fragments, a glassy high pad (the cosmos, the snow)."""
    harp = Track(0, 46, "harp", vol=92, pan=40, rev=95)
    cel = Track(1, 8, "celesta", vol=92, pan=80, rev=100)
    gl = Track(2, 9, "glock", vol=66, pan=60, rev=100)
    pad = Track(3, 89, "warm pad", vol=70, pan=64, rev=100)
    vn = Track(4, 49, "high strings", vol=72, pan=56, rev=100)
    def go(off):
        melody_part(song, gl, off, 12, vel=52, legato=0.6, sections=("A",))
        melody_part(song, cel, off, 12, vel=58, legato=0.8, sections=("A2",))
        melody_part(song, vn, off, 12, vel=50, legato=1.0, sections=("B",))
        for bar in range(song.bars):
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                tones = voice(pc, ivs[:3] + [14], 62, 86)
                for i in range(int(d * 4)):
                    idx = i % (len(tones) * 2 - 2) if len(tones) > 1 else 0
                    if idx >= len(tones):
                        idx = len(tones) * 2 - 2 - idx
                    harp.note(off + b0 + i * 0.25 + song.h(0.004), 0.6, tones[idx], song.v(40 if i % 4 else 50, 4))
                for p in voice(pc, ivs[:3], 69, 81)[:3]:
                    pad.note(off + b0, d, p, song.v(38))
    each_pass(song, go)
    return [harp, cel, gl, pad, vn]


def world_epic(song):
    """Full orchestra and choir: the theme on horns and violins in octaves, trombones and trumpets, taiko-like drums, timpani, cymbals."""
    vn = Track(0, 48, "violins", vol=112, pan=48, rev=85)
    lo = Track(1, 48, "low strings", vol=108, pan=78, rev=80)
    hn = Track(2, 60, "horns", vol=108, pan=60, rev=85)
    tb = Track(3, 57, "trombones", vol=94, pan=76, rev=85)
    tp = Track(4, 56, "trumpets", vol=80, pan=52, rev=85)
    ch = Track(5, 52, "choir", vol=100, pan=64, rev=95)
    tim = Track(6, 47, "timpani", vol=110, pan=64, rev=78)
    cb = Track(7, 43, "contrabass", vol=104, pan=70, rev=75)
    tk = Track(8, 116, "taiko", vol=100, pan=64, rev=80)
    dr = Track(9, None, "cymbals", vol=96, pan=64, rev=85)
    def go(off):
        melody_part(song, vn, off, 12, vel=88, legato=1.0)
        melody_part(song, vn, off, 0, vel=78, legato=1.0)
        melody_part(song, hn, off, -12, vel=90, legato=1.0)
        melody_part(song, tp, off, 0, vel=76, sections=("B",))
        for bar in range(song.bars):
            o = off + bar * 4
            if bar % 8 == 0:
                dr.note(o, 3, 49, song.v(100))
                dr.note(o, 3, 57, song.v(80))
            if bar % 8 == 7:
                for i in range(16):
                    tim.note(o + 2 + i * 0.125, 0.12, nearest(9, 45), 44 + i * 4)
                for i in range(12):
                    dr.note(o + 2.5 + i * 0.125, 0.12, 51, 30 + i * 6)
            for b, v in [(0, 104), (1.5, 76), (2, 92), (3, 70), (3.5, 82)]:
                tk.note(o + b, 0.5, 36 if b in (0, 2) else 41, song.v(v))
            for (b0, d, sym) in song.chords_in_bar(bar):
                pc, ivs = chord(sym)
                for p in voice(pc, ivs[:3], 45, 62)[:4]:
                    lo.note(off + b0, d, p, song.v(74, 3))
                lo.ramp(off + b0, off + b0 + d, 11, 96, 124, 6)
                for p in voice(pc, ivs[:3], 50, 67)[:3]:
                    tb.note(off + b0, d * 0.95, p, song.v(72, 3))
                for p in voice(pc, ivs[:3], 57, 74)[:4]:
                    ch.note(off + b0, d, p, song.v(72, 3))
                cb.note(off + b0, d, nearest(pc, 33), song.v(86))
                tpp = nearest(pc, 43) if 40 <= nearest(pc, 43) <= 50 else nearest((pc + 7) % 12, 45)
                tim.note(off + b0, 0.5, tpp, song.v(92))
    each_pass(song, go)
    return [vn, lo, hn, tb, tp, ch, tim, cb, tk, dr]


# ---------------------------------------------------------------------------
# Held notes for the slow-motion moments (one-shots, not loops)
# ---------------------------------------------------------------------------

def hold(path, pcs_low, pcs_high, bpm, minor=False):
    """A held chord that rises and hangs: low strings and choir, high violins, a soft cymbal swell, ~10 s."""
    st = Track(0, 49, "slow strings", vol=110, pan=64, rev=100)
    ch = Track(1, 52, "choir", vol=96, pan=60, rev=110)
    vn = Track(2, 48, "high violins", vol=86, pan=48, rev=110)
    cel = Track(3, 8, "celesta", vol=70, pan=80, rev=110)
    dr = Track(9, None, "cymbal", vol=80, pan=64, rev=100)
    beats = 10 * bpm / 60
    for p in pcs_low:
        st.note(0, beats, p, 70)
    for p in pcs_low[1:]:
        ch.note(0.1, beats, p + 12, 62)
    for p in pcs_high:
        vn.note(0.3, beats - 0.3, p, 60)
    st.ramp(0, beats * 0.35, 11, 30, 124, 24)
    st.ramp(beats * 0.7, beats, 11, 124, 40, 12)
    ch.ramp(0, beats * 0.4, 11, 20, 120, 24)
    ch.ramp(beats * 0.7, beats, 11, 120, 30, 12)
    vn.ramp(0, beats * 0.5, 11, 10, 110, 24)
    vn.ramp(beats * 0.75, beats, 11, 110, 20, 12)
    for i, p in enumerate(pcs_high[::-1] + pcs_high):
        cel.note(beats * 0.32 + i * 0.25, 2, p + 12, 34)
    for i in range(16):
        dr.note(beats * 0.12 + i * 0.25, 0.2, 51, 16 + i * 3)
    write_midi(path, [st, ch, vn, cel, dr], bpm)


def main():
    story = build_song(S_A, S_B, S_A2, S_PROG, 84, 7)
    for name, fn in [("bed", story_bed), ("curious", story_curious), ("bright", story_bright), ("drive", story_drive), ("warm", story_warm), ("swell", story_swell)]:
        song = build_song(S_A, S_B, S_A2, S_PROG, 84, sum(map(ord, name)) * 31)
        write_midi(f"{OUT}/story-{name}.mid", fn(song), 84)
    world = build_song(W_A, W_B, W_A2, W_PROG, 70, 11)
    for name, fn in [("bed", world_bed), ("cave", world_cave), ("ice", world_ice), ("epic", world_epic)]:
        song = build_song(W_A, W_B, W_A2, W_PROG, 70, len(name) * 97)
        write_midi(f"{OUT}/world-{name}.mid", fn(song), 70)
    # D major add9, D minor add9.
    hold(f"{OUT}/story-hold.mid", [38, 45, 50, 54, 57], [74, 76, 78, 81], 84)
    hold(f"{OUT}/world-hold.mid", [38, 45, 50, 53, 57], [74, 76, 77, 81], 70)
    print("story loop", story.beats * 60 / 84, "s; world loop", world.beats * 60 / 70, "s")


main()
