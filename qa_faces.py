#!/usr/bin/env python3
"""
QA face verification for rendered 9:16 podcast reels.

Extracts keyframes at regular intervals and runs Haar-cascade face detection
to flag timestamps where NO face is visible. This catches "faceless" frames
caused by wrong face_cx assignments or host being off-camera.

Usage as CLI:
    python3 qa_faces.py /path/to/reel.mp4
    python3 qa_faces.py /path/to/reel.mp4 --interval 1.5 --min-face-pct 3.0

Usage as module:
    from qa_faces import verify_faces_in_reel
    problems = verify_faces_in_reel("reel.mp4", check_interval_sec=2.0)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import cv2


# ---------------------------------------------------------------------------
# Haar cascade setup
# ---------------------------------------------------------------------------

_CASCADE_PATH = os.path.join(
    os.path.dirname(cv2.__file__), "data", "haarcascade_frontalface_default.xml"
)

# Profile cascade as fallback (catches faces turned partly sideways)
_PROFILE_CASCADE_PATH = os.path.join(
    os.path.dirname(cv2.__file__), "data", "haarcascade_profileface.xml"
)


def _load_cascades() -> list[cv2.CascadeClassifier]:
    """Load frontal + profile Haar cascades."""
    cascades = []
    for path in (_CASCADE_PATH, _PROFILE_CASCADE_PATH):
        if os.path.isfile(path):
            cc = cv2.CascadeClassifier(path)
            if not cc.empty():
                cascades.append(cc)
    if not cascades:
        raise RuntimeError(
            f"No usable Haar cascade XMLs found. Checked:\n"
            f"  {_CASCADE_PATH}\n  {_PROFILE_CASCADE_PATH}"
        )
    return cascades


# ---------------------------------------------------------------------------
# Frame extraction via ffmpeg
# ---------------------------------------------------------------------------

def _get_duration(video_path: str) -> float:
    """Return video duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {video_path}: {result.stderr.strip()}")
    return float(result.stdout.strip())


def _extract_frames(
    video_path: str,
    interval_sec: float,
    tmpdir: str,
) -> list[tuple[float, str]]:
    """
    Extract one JPEG frame every `interval_sec` seconds.
    Returns list of (timestamp_sec, frame_path).
    """
    duration = _get_duration(video_path)
    timestamps: list[float] = []
    t = 0.0
    while t < duration:
        timestamps.append(t)
        t += interval_sec

    results = []
    for i, ts in enumerate(timestamps):
        out_path = os.path.join(tmpdir, f"frame_{i:04d}.jpg")
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{ts:.3f}",
            "-i", video_path,
            "-frames:v", "1",
            "-q:v", "2",
            out_path,
        ]
        subprocess.run(cmd, capture_output=True)
        if os.path.isfile(out_path):
            results.append((ts, out_path))
    return results


# ---------------------------------------------------------------------------
# Face detection on a single frame
# ---------------------------------------------------------------------------

def detect_faces_in_frame(
    frame_path: str,
    cascades: list[cv2.CascadeClassifier],
    min_face_pct: float = 3.0,
) -> list[tuple[int, int, int, int]]:
    """
    Detect faces in a frame image.

    Args:
        frame_path: Path to the JPEG frame.
        cascades: Pre-loaded Haar cascade classifiers.
        min_face_pct: Minimum face size as percentage of frame height.
            For 1080x1920 vertical reels a real face is typically >5% of height.
            Default 3% is conservative to avoid false negatives.

    Returns:
        List of (x, y, w, h) bounding boxes for detected faces.
    """
    img = cv2.imread(frame_path)
    if img is None:
        return []

    h, w = img.shape[:2]
    min_face_px = int(h * min_face_pct / 100.0)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Histogram equalization helps with poorly lit podcast setups
    gray = cv2.equalizeHist(gray)

    all_faces = []
    for cascade in cascades:
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(min_face_px, min_face_px),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )
        if len(faces) > 0:
            all_faces.extend(faces.tolist())

    return all_faces


# ---------------------------------------------------------------------------
# Main verification function
# ---------------------------------------------------------------------------

def verify_faces_in_reel(
    reel_path: str,
    check_interval_sec: float = 2.0,
    min_face_pct: float = 3.0,
    verbose: bool = False,
) -> list[dict]:
    """
    Extract frames from a rendered reel and check each for visible faces.

    Args:
        reel_path: Path to the rendered 9:16 reel MP4.
        check_interval_sec: Seconds between sampled frames.
        min_face_pct: Minimum face size as % of frame height (see detect_faces_in_frame).
        verbose: Print progress to stderr.

    Returns:
        List of dicts for frames where NO face was detected:
            {
                "timestamp_sec": float,
                "timestamp_fmt": "MM:SS.s",
                "frame_path": str | None,  # None after cleanup
                "faces_found": 0,
            }
        An empty list means every sampled frame has at least one face -- all good.
    """
    reel_path = str(reel_path)
    if not os.path.isfile(reel_path):
        raise FileNotFoundError(f"Reel not found: {reel_path}")

    cascades = _load_cascades()
    duration = _get_duration(reel_path)

    if verbose:
        print(f"[qa_faces] Reel: {reel_path}", file=sys.stderr)
        print(f"[qa_faces] Duration: {duration:.1f}s, interval: {check_interval_sec}s", file=sys.stderr)

    problems: list[dict] = []

    with tempfile.TemporaryDirectory(prefix="qa_faces_") as tmpdir:
        frames = _extract_frames(reel_path, check_interval_sec, tmpdir)

        if verbose:
            print(f"[qa_faces] Extracted {len(frames)} frames to check", file=sys.stderr)

        for ts, frame_path in frames:
            faces = detect_faces_in_frame(frame_path, cascades, min_face_pct)
            minutes = int(ts // 60)
            secs = ts - minutes * 60

            if verbose:
                status = "OK" if faces else "NO FACE"
                print(
                    f"  {minutes:02d}:{secs:05.2f}  faces={len(faces):2d}  {status}",
                    file=sys.stderr,
                )

            if not faces:
                problems.append({
                    "timestamp_sec": round(ts, 3),
                    "timestamp_fmt": f"{minutes:02d}:{secs:04.1f}",
                    "frame_path": None,  # temp dir will be cleaned up
                    "faces_found": 0,
                })

    return problems


def summarize(reel_path: str, problems: list[dict], duration: float) -> str:
    """Return a human-readable summary."""
    n_checked = int(duration // 2) + 1  # approximate
    if not problems:
        return f"PASS  {reel_path} -- all sampled frames contain a visible face."
    pct = len(problems) / max(n_checked, 1) * 100
    ts_list = ", ".join(p["timestamp_fmt"] for p in problems[:10])
    extra = f" (+{len(problems)-10} more)" if len(problems) > 10 else ""
    return (
        f"FAIL  {reel_path} -- {len(problems)} faceless frames ({pct:.0f}%)\n"
        f"      Timestamps: {ts_list}{extra}"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="QA check: verify faces are visible in rendered 9:16 reels."
    )
    parser.add_argument("reel", help="Path to the rendered reel MP4")
    parser.add_argument(
        "--interval", type=float, default=2.0,
        help="Seconds between sampled frames (default: 2.0)",
    )
    parser.add_argument(
        "--min-face-pct", type=float, default=3.0,
        help="Min face size as %% of frame height (default: 3.0)",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Output results as JSON instead of human-readable summary",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Print per-frame progress to stderr",
    )

    args = parser.parse_args()

    problems = verify_faces_in_reel(
        args.reel,
        check_interval_sec=args.interval,
        min_face_pct=args.min_face_pct,
        verbose=args.verbose,
    )

    if args.json:
        print(json.dumps(problems, indent=2))
    else:
        duration = _get_duration(args.reel)
        print(summarize(args.reel, problems, duration))

    # Exit 1 if problems found, 0 if clean
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
