"""Offline audio alignment worker. Finds the time offset that syncs a per-person mic to a
reference already in sync with the video (a camera's embedded audio, or the timeline mix).
JSON line protocol; no network. Uses energy-envelope cross-correlation (robust to level and
timbre differences between a lav mic and a room/camera track)."""
import argparse
import json
import math
import sys
from pathlib import Path


def emit(kind, **kwargs):
    print(json.dumps({"type": kind, **kwargs}, ensure_ascii=True), flush=True)


def _load(path, sr=16000):
    import numpy as np
    import soundfile as sf
    with sf.SoundFile(path) as f:
        data = f.read(dtype="float32", always_2d=True)
        rate = f.samplerate
    mono = data.mean(axis=1)
    if not np.isfinite(mono).all():
        raise ValueError("Audio invalide (valeurs non finies) : " + Path(path).name)
    if rate != sr:
        from scipy.signal import resample_poly
        g = math.gcd(int(rate), sr)
        mono = resample_poly(mono, sr // g, int(rate) // g).astype("float32")
    return mono


def _envelope(x, sr=16000, win=0.05):
    import numpy as np
    w = max(1, int(sr * win))
    e = np.sqrt(np.convolve(x * x, np.ones(w, dtype="float32") / w, "same"))
    e = e - e.mean()
    s = e.std()
    return e / s if s > 1e-9 else e


def align(reference_path, mic_path, sr=16000):
    import numpy as np
    ref = _load(reference_path, sr)
    mic = _load(mic_path, sr)
    if len(ref) < sr or len(mic) < sr:
        raise ValueError("Audio trop court pour l'alignement (min 1 s).")
    r = _envelope(ref, sr)
    s = _envelope(mic, sr)
    n = 1
    while n < len(r) + len(s):
        n *= 2
    R = np.fft.rfft(r, n)
    S = np.fft.rfft(s, n)
    cc = np.fft.irfft(R * np.conj(S), n)
    # lags from -(len(s)-1) .. +(len(r)-1); mic starts at (offset) seconds after reference start
    cc = np.concatenate([cc[-(len(s) - 1):], cc[:len(r)]])
    lags = np.arange(-(len(s) - 1), len(r))
    idx = int(np.argmax(cc))
    denom = (np.linalg.norm(r) * np.linalg.norm(s)) + 1e-9
    peak = float(cc[idx] / denom)
    offset = float(lags[idx]) / sr
    # A clear, unambiguous match has a single sharp peak well above the runner-up.
    order = np.argsort(cc)[::-1]
    second = 0.0
    for j in order[1:]:
        if abs(int(j) - idx) > sr * 0.5:  # ignore the immediate neighbourhood of the peak
            second = float(cc[j] / denom)
            break
    return {"offset": round(offset, 4), "peak": round(peak, 4),
            "margin": round(peak - second, 4),
            "confident": bool(peak > 0.15 and (peak - second) > 0.03)}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--reference", required=True)
    p.add_argument("--mic", required=True)
    a = p.parse_args()
    try:
        result = align(a.reference, a.mic)
        emit("complete", **result)
    except Exception as error:
        emit("error", message=str(error))
        sys.exit(1)
