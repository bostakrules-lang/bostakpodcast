#!/usr/bin/env python3
"""
Per-frame shot classifier for the Biohack-it podcast source.

Classes (at source resolution 1920x1080):
  TIGHT_SINGLE   → one face, large, centered
  WIDE_2SHOT     → two faces, roughly same size, in a single wide shot (no seam)
  SIDE_BY_SIDE   → two faces in two composited halves (seam detectable at x≈960)
  BROLL          → no face (e.g. supermarket b-roll) → treat as WIDE fallback

Strategy
  • Sample frames at ~2 Hz within a [start, end] window.
  • For each frame: find largest-area faces via Haar cascade.
  • If 1 face → TIGHT_SINGLE, record its x-center and width.
  • If 2 faces → check if they straddle the x≈960 seam with similar size → SIDE_BY_SIDE;
                 otherwise → WIDE_2SHOT.
  • 0 faces   → BROLL.

For TIGHT_SINGLE, also classify host vs guest via color heuristic on the dress region
  (guest: burgundy dominant; host: reddish/rust + lighter hair).
"""
import cv2, sys, json, numpy as np, subprocess, os, tempfile

SOURCE = "/sessions/adoring-pensive-albattani/rf/episodes/maria-marlowe/source.mp4"
FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

def sample_frames(start_s: float, end_s: float, fps: float = 2.0, scale_w: int = 1280):
    """Yield (t, BGR frame) at `fps` samples per second, scaled to scale_w wide."""
    dur = end_s - start_s
    with tempfile.TemporaryDirectory() as td:
        pattern = os.path.join(td, "f%04d.jpg")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{start_s:.3f}", "-i", SOURCE, "-t", f"{dur:.3f}",
            "-vf", f"fps={fps},scale={scale_w}:-1",
            "-q:v", "3", pattern,
        ], check=True)
        files = sorted(os.listdir(td))
        for i, fn in enumerate(files):
            t = start_s + i / fps
            img = cv2.imread(os.path.join(td, fn))
            if img is not None:
                yield t, img

def detect_center_seam(img) -> bool:
    """
    Detect a vertical seam at x≈w/2, which is the signature of a SIDE_BY_SIDE composite.
    A real single-camera frame of a podcast set has smooth continuity through the middle column.
    We compute the mean absolute difference between the column just left of center and just right
    of center, over a vertical strip, and compare it against neighboring column pairs.
    """
    h, w = img.shape[:2]
    mid = w // 2
    # Two columns straddling the seam vs two columns 100px to the side
    def col_diff(x_left, x_right):
        a = img[:, x_left].astype("int32")
        b = img[:, x_right].astype("int32")
        return float(np.abs(a - b).mean())
    mid_diff = col_diff(mid - 1, mid + 1)
    # Baseline: mean of a few off-seam column pairs
    base = (col_diff(mid - 101, mid - 99) + col_diff(mid + 99, mid + 101)) / 2
    # Require the seam to be clearly sharper than its neighborhood.
    return mid_diff > base * 1.8 and mid_diff > 10

def classify_frame(img) -> dict:
    h, w = img.shape[:2]
    # Early seam check: if we see a clear seam, it's SIDE_BY_SIDE regardless of what faces we find.
    seam = detect_center_seam(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Strict pass only: require solid neighbors to avoid false positives in background/textures.
    faces = FACE_CASCADE.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(50, 50))
    # Filter out obviously bad faces (unusual aspect ratio)
    faces = [f for f in faces if 0.7 < (f[3] / f[2]) < 1.6]
    if seam:
        # Keep up to 2 faces (one per half if available)
        faces_out = [{"x": int(x), "y": int(y), "w": int(fw), "h": int(fh),
                      "cx": int(x + fw/2), "cy": int(y + fh/2)}
                     for (x, y, fw, fh) in sorted(faces, key=lambda f: -f[2]*f[3])[:2]]
        return {"shot": "SIDE_BY_SIDE", "faces": faces_out}
    if len(faces) == 0:
        return {"shot": "BROLL", "faces": []}
    # Keep top 2 by area
    faces = sorted(faces, key=lambda f: -f[2] * f[3])[:2]
    faces_out = [{"x": int(x), "y": int(y), "w": int(fw), "h": int(fh), "cx": int(x + fw/2), "cy": int(y + fh/2)} for (x, y, fw, fh) in faces]
    if len(faces_out) == 1:
        f = faces_out[0]
        # Determine guest vs host by hue of torso region below the face
        who = identify_person(img, f)
        return {"shot": "TIGHT_SINGLE", "who": who, "faces": faces_out}
    # 2 faces. Are they in separate halves? seam ~x=w/2
    f1, f2 = sorted(faces_out, key=lambda f: f["cx"])
    left_in_left_half = f1["cx"] < w * 0.5
    right_in_right_half = f2["cx"] > w * 0.5
    sizes_similar = min(f1["w"], f2["w"]) > 0.6 * max(f1["w"], f2["w"])
    # SIDE_BY_SIDE = two large similarly-sized faces, each fully in its half,
    # with a clear gap between their x-ranges.
    if left_in_left_half and right_in_right_half and sizes_similar:
        bigger = max(f1["w"], f2["w"])
        # Both faces must be meaningful (>0.05*w each) and at least one tight (>0.1*w)
        if min(f1["w"], f2["w"]) > w * 0.05 and bigger > w * 0.1:
            # Gap between them must be real (not overlapping): f1 ends before f2 starts
            if (f1["x"] + f1["w"]) < f2["x"]:
                # Tight in their own halves? → SIDE_BY_SIDE; otherwise WIDE_2SHOT
                if bigger > w * 0.14:
                    return {"shot": "SIDE_BY_SIDE", "faces": faces_out}
                return {"shot": "WIDE_2SHOT", "faces": faces_out}
    # Two faces that don't pass the 2-shot test → trust the largest one as a SINGLE
    biggest = max(faces_out, key=lambda f: f["w"] * f["h"])
    who = identify_person(img, biggest)
    return {"shot": "TIGHT_SINGLE", "who": who, "faces": [biggest]}

def identify_person(img, face) -> str:
    """Very rough: sample the dress region (below the face) and check dominant hue."""
    h, w = img.shape[:2]
    y0 = min(h - 1, face["y"] + face["h"] + 20)
    y1 = min(h, y0 + face["h"])
    x0 = max(0, face["x"] - face["w"] // 2)
    x1 = min(w, face["x"] + face["w"] + face["w"] // 2)
    if y1 <= y0 or x1 <= x0:
        return "unknown"
    patch = img[y0:y1, x0:x1]
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    # Mean hue/sat on skin-excluded region
    mask = (hsv[..., 1] > 40) & (hsv[..., 2] < 200)
    if mask.sum() < 100:
        return "unknown"
    h_mean = np.mean(hsv[..., 0][mask])
    s_mean = np.mean(hsv[..., 1][mask])
    # Guest Maria: burgundy sleeveless — deep red/burgundy, hue around 170-180 or 0-5, high sat, mid-low value
    # Host: rust/caramel — hue around 5-15, higher value (lighter)
    # Hue in OpenCV is 0..180. Red/burgundy wraps around 0/180.
    # We'll use a simple proxy: the mean of RED channel divided by GREEN in RGB
    rgb = cv2.cvtColor(patch, cv2.COLOR_BGR2RGB)
    r = rgb[..., 0][mask].mean()
    g = rgb[..., 1][mask].mean()
    b = rgb[..., 2][mask].mean()
    # Guest burgundy: R high, G low, B mid (R-G large, R-B moderate)
    # Host rust: R high, G mid, B low (R-B large, G also elevated)
    # Heuristic: if G < 50 and R > 80 → guest burgundy; if G > 40 and R-B > 30 → host rust
    guest_score = (r - g) + (r - b) * 0.5
    host_score = g + (r - b)
    if r - g > 40 and b < 80 and g < 60:
        return "guest"
    if g > 50 and r > g > b:
        return "host"
    # Fall back to x position (host on left half, guest on right half in WIDE frames)
    return "guest" if face["cx"] > img.shape[1] * 0.5 else "host"

def analyze_window(start_ms: int, end_ms: int, fps: float = 2.0) -> list:
    """Return per-frame classifications as list of dicts."""
    out = []
    # We scale to 1280w; the source is 1920x1080 → our scaled frame is 1280x720.
    SCALE_W = 1280
    for t, img in sample_frames(start_ms / 1000.0, end_ms / 1000.0, fps=fps, scale_w=SCALE_W):
        c = classify_frame(img)
        c["t"] = round(t, 3)
        out.append(c)
    return out

def segments_from_classifications(classes: list, min_seg_s: float = 0.6, fps: float = 2.0) -> list:
    """Group adjacent same-shot frames into segments; average face centers per segment."""
    if not classes:
        return []
    segs = []
    def new_seg(c):
        return {"start": c["t"], "end": c["t"], "shot": c["shot"], "who": c.get("who"),
                "faces_px": [c.get("faces", [])]}
    cur = new_seg(classes[0])
    for c in classes[1:]:
        same_shot = c["shot"] == cur["shot"] and c.get("who") == cur.get("who")
        if same_shot:
            cur["end"] = c["t"]
            cur["faces_px"].append(c.get("faces", []))
        else:
            segs.append(cur)
            cur = new_seg(c)
    segs.append(cur)
    # Merge segments shorter than min_seg_s into neighbors (same-shot absorbs out-of-place flickers)
    merged = []
    for s in segs:
        dur = s["end"] - s["start"]
        if merged and dur < min_seg_s:
            merged[-1]["end"] = s["end"]
            merged[-1]["faces_px"].extend(s["faces_px"])
        else:
            merged.append(s)
    # Compute normalized center-x for the face (0..1 across source width).
    # Our sampled frames are 1280w → normalize by 1280. These get mapped to source 1920w downstream.
    SCALE_W = 1280
    out = []
    for s in merged:
        # Flatten faces across all frames in the segment
        all_faces = [f for fl in s["faces_px"] for f in fl]
        if all_faces and s["shot"] == "TIGHT_SINGLE":
            cx = sum(f["cx"] for f in all_faces) / len(all_faces)
            cy = sum(f["cy"] for f in all_faces) / len(all_faces)
            s["face_cx_norm"] = round(cx / SCALE_W, 4)
            s["face_cy_norm"] = round(cy / (SCALE_W * 9 / 16), 4)  # height = w*9/16
        out.append({
            "start": round(s["start"], 3),
            "end": round(s["end"], 3),
            "shot": s["shot"],
            "who": s.get("who"),
            **({"face_cx_norm": s["face_cx_norm"], "face_cy_norm": s["face_cy_norm"]} if "face_cx_norm" in s else {}),
        })
    return out

def analyze_clips_to_json(clips_path: str, out_path: str):
    with open(clips_path) as f:
        clips = json.load(f)
    result = []
    for c in clips:
        print(f"Analyzing clip {c['index']:02d}  [{c['startMs']/1000:.1f}-{c['endMs']/1000:.1f}s]  {c['hook']}", flush=True)
        cls = analyze_window(c["startMs"], c["endMs"], fps=2.0)
        segs = segments_from_classifications(cls, min_seg_s=1.0)
        # Convert seg times (absolute source s) to relative-to-clip (seconds from clip start)
        clip_start_s = c["startMs"] / 1000.0
        clip_end_s = c["endMs"] / 1000.0
        for s in segs:
            s["start_rel"] = round(max(0.0, s["start"] - clip_start_s), 3)
            s["end_rel"] = round(min(clip_end_s - clip_start_s, s["end"] - clip_start_s), 3)
        # Drop degenerate segments
        segs = [s for s in segs if s["end_rel"] > s["start_rel"]]
        result.append({"index": c["index"], "hook": c["hook"],
                       "startMs": c["startMs"], "endMs": c["endMs"],
                       "segments": segs})
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\n→ Wrote {out_path}")

if __name__ == "__main__":
    clips_path = sys.argv[1] if len(sys.argv) > 1 else "/sessions/adoring-pensive-albattani/rf/episodes/maria-marlowe/clips.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "/sessions/adoring-pensive-albattani/rf/episodes/maria-marlowe/shots.json"
    analyze_clips_to_json(clips_path, out_path)
