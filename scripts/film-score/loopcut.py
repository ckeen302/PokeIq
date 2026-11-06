import sys, wave, numpy as np
src, dst, L, one = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4] == "1"
w = wave.open(src); sr = w.getframerate(); ch = w.getnchannels()
x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, ch).astype(np.float64)
if one:
    out = x[: int(sr * L)].copy()
    fo = int(sr * 1.5)
    out[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
else:
    n = int(round(sr * L))
    a = x[n:2 * n].copy()
    F = int(sr * 0.35)
    k = (np.arange(F) / F)[:, None]
    # Equal-power: from the natural continuation (third pass) into the middle pass.
    a[:F] = x[2 * n:2 * n + F] * np.cos(k * np.pi / 2) + x[n:n + F] * np.sin(k * np.pi / 2)
    out = a
o = wave.open(dst, "wb"); o.setnchannels(ch); o.setsampwidth(2); o.setframerate(sr)
o.writeframes(np.clip(out, -32768, 32767).astype(np.int16).tobytes()); o.close()
