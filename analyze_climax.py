#!/usr/bin/env python3
"""Analyse RMS energy per track, detect climax (peak sustained energy window)."""
import re, sys, statistics

def parse(path):
    pts = []
    rms = []
    cur_pts = None
    with open(path) as f:
        for line in f:
            m = re.match(r'frame:\d+\s+pts:\d+\s+pts_time:([\d.]+)', line)
            if m:
                cur_pts = float(m.group(1))
                continue
            m = re.match(r'lavfi\.astats\.Overall\.RMS_level=(-?[\d.inf]+)', line)
            if m and cur_pts is not None:
                v = m.group(1)
                if v in ('-inf', 'inf', 'nan'):
                    continue
                pts.append(cur_pts)
                rms.append(float(v))
    return pts, rms

def windowed_peak(pts, rms, window_s=8.0):
    """Find window_s-second window with highest mean RMS."""
    if not pts: return None
    best_mean = -999
    best_center = 0
    # step 0.5s
    t = 0.0
    tmax = pts[-1]
    while t + window_s <= tmax:
        vals = [r for p, r in zip(pts, rms) if t <= p <= t + window_s]
        if vals:
            mean = sum(vals) / len(vals)
            if mean > best_mean:
                best_mean = mean
                best_center = t + window_s / 2
        t += 0.5
    return best_center, best_mean

def find_peak_moment(pts, rms):
    """Return max, location, and a suggested 3s window around it."""
    if not pts: return None
    imax = max(range(len(rms)), key=lambda i: rms[i])
    peak_t = pts[imax]
    peak_v = rms[imax]
    # Mean energy overall
    mean = sum(rms) / len(rms)
    return peak_t, peak_v, mean

for i in (1, 2, 3):
    path = f"/tmp/music_analysis/track{i}_rms.txt"
    pts, rms = parse(path)
    if not pts:
        print(f"track{i}: no data")
        continue
    dur = pts[-1]
    mean = sum(rms) / len(rms)
    imax = max(range(len(rms)), key=lambda k: rms[k])
    peak_t = pts[imax]
    peak_v = rms[imax]
    # Sustained 8s peak
    w = windowed_peak(pts, rms, 8.0)
    # Quick 3s peak
    w3 = windowed_peak(pts, rms, 3.0)
    print(f"\n=== track{i}.mp3 — dur {dur:.1f}s ===")
    print(f"  mean RMS: {mean:.2f} dB")
    print(f"  absolute peak: {peak_v:.2f} dB @ {peak_t:.1f}s ({peak_t//60:.0f}:{peak_t%60:05.2f})")
    if w:
        print(f"  sustained 8s climax: center @ {w[0]:.1f}s  (mean {w[1]:.2f} dB)  → window [{max(0,w[0]-4):.1f}s — {min(dur,w[0]+4):.1f}s]")
    if w3:
        print(f"  sharp 3s peak:       center @ {w3[0]:.1f}s  (mean {w3[1]:.2f} dB)  → window [{max(0,w3[0]-1.5):.1f}s — {min(dur,w3[0]+1.5):.1f}s]")
