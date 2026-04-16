#!/usr/bin/env python3
"""
Reframe 16:9 podcast clips → 9:16 per-segment, based on shots.json.

Per segment:
  TIGHT_SINGLE  → face-centered 1080x1920 crop
  SIDE_BY_SIDE  → vertical split (left half → top, right half → bottom) stacked
  WIDE_2SHOT    → per-face crop (host left → top 1080x960, guest right → bottom 1080x960)
                  Fallback: split at x=960 if face boxes missing.
  BROLL         → same as WIDE_2SHOT

For each clip, produces an intermediate segment mp4 per shot then concatenates.
Output: public/clips/<slug>/clip-XX.mp4
"""
import json, os, subprocess, sys, pathlib, tempfile

ROOT = pathlib.Path("/sessions/adoring-pensive-albattani/rf")
EPISODE_DIR = ROOT / "episodes/maria-marlowe"
SOURCE = EPISODE_DIR / "source.mp4"
CLIPS_JSON = EPISODE_DIR / "clips.json"
SHOTS_JSON = EPISODE_DIR / "shots.json"
OUT_DIR = ROOT / "public/clips/maria-marlowe"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------- Segment post-processing ----------
#
# Rule from Albert:
#   El reel SIEMPRE empieza con plano individual de la persona que habla.
#   Nunca split/wide/broll en el primer segmento — el hook rojo del principio
#   tapa la cara de quien queda en la mitad inferior.
#
# We rewrite the first segment to TIGHT_SINGLE of the dominant speaker of
# the clip (the one with most TIGHT_SINGLE time in the rest of the clip).

def dominant_speaker(segs: list) -> str:
    """Return who ('guest'|'host') dominates the tight singles of this clip."""
    buckets = {}
    for s in segs:
        if s["shot"] != "TIGHT_SINGLE":
            continue
        who = s.get("who") or "guest"
        buckets[who] = buckets.get(who, 0) + (s["end_rel"] - s["start_rel"])
    if not buckets:
        return "guest"
    return max(buckets, key=buckets.get)


# Face-center-x in the ORIGINAL 1920x1080 source for each speaker,
# per source shot type. These are where the person's face sits in the
# source frame itself, which is what we need for the tight crop.
#   guest = Maria = right half
#   host  = María José = left half
SOURCE_CX_BY_SHOT = {
    # SIDE_BY_SIDE composite: each half is centered at x=480 (host) / 1440 (guest)
    ("SIDE_BY_SIDE", "guest"): 1440 / 1920,   # 0.75
    ("SIDE_BY_SIDE", "host"):  480 / 1920,    # 0.25
    # WIDE_2SHOT single camera: host sits around x=576, guest around x=1344
    ("WIDE_2SHOT", "guest"):   1344 / 1920,   # 0.70
    ("WIDE_2SHOT", "host"):    576 / 1920,    # 0.30
    # BROLL is typically a missed wide 2-shot
    ("BROLL", "guest"):        1344 / 1920,   # 0.70
    ("BROLL", "host"):         576 / 1920,    # 0.30
}


def enforce_intro_tight(segs: list) -> list:
    """Ensure the first segment is TIGHT_SINGLE of the dominant speaker.
    If it already is, leave it untouched. Otherwise rewrite it using a
    face center appropriate for the ORIGINAL source shot type.

    Important: SIDE_BY_SIDE / WIDE_2SHOT / BROLL sources have a different
    geometry than TIGHT_SINGLE, so we CANNOT borrow face_cx from a later
    tight single — the speaker sits at a different x in the composite.
    We use the fixed SOURCE_CX_BY_SHOT mapping in those cases. The
    boundary between the forced intro and the first real tight single
    will differ; the xfade duration at that transition is bumped up to
    soften the reframe (handled in build_filter_complex).
    """
    if not segs:
        return segs
    first = segs[0]
    if first["shot"] == "TIGHT_SINGLE" and "face_cx_norm" in first:
        return segs
    who = dominant_speaker(segs)
    # Use the fixed mapping for the ORIGINAL source shot geometry.
    cx = SOURCE_CX_BY_SHOT.get((first["shot"], who), 0.70)
    new_first = dict(first)
    new_first["shot"] = "TIGHT_SINGLE"
    new_first["who"] = who
    new_first["face_cx_norm"] = round(cx, 4)
    new_first["_forced"] = True
    new_first["_forced_from"] = first["shot"]
    return [new_first] + segs[1:]


def merge_redundant(segs: list, cx_tolerance: float = 0.020,
                    min_short_cut_sec: float = 1.8) -> list:
    """Collapse adjacent cuts that serve no narrative purpose.

    Rule 1 — imperceptible reframe:
        same shot + same speaker + |Δface_cx| ≤ cx_tolerance  → merge.
        (threshold ~0.02 ≈ 38px in a 1920px source; below perception.)

    Rule 2 — brief cutaway to the non-dominant speaker:
        a TIGHT_SINGLE of the non-dominant speaker shorter than
        min_short_cut_sec, sandwiched between two TIGHT_SINGLEs of the
        dominant speaker, gets rewritten to the dominant speaker's
        framing. Avoids distracting 1-2 s cuts to the host during a
        guest monologue (voice continues, the camera simply stays on
        the speaker).
    """
    if not segs:
        return segs
    dom = dominant_speaker(segs)

    # Rule 2 first — rewrite short opposite-speaker single cuts.
    rewritten = []
    for i, s in enumerate(segs):
        prev = segs[i - 1] if i > 0 else None
        nxt = segs[i + 1] if i + 1 < len(segs) else None
        dur = s["end_rel"] - s["start_rel"]
        if (
            s.get("shot") == "TIGHT_SINGLE"
            and s.get("who") and s["who"] != dom
            and dur <= min_short_cut_sec
            and prev and prev.get("shot") == "TIGHT_SINGLE" and prev.get("who") == dom
            and nxt and nxt.get("shot") == "TIGHT_SINGLE" and nxt.get("who") == dom
        ):
            s = dict(s)
            s["who"] = dom
            # Average surrounding face position to keep framing steady.
            s["face_cx_norm"] = round(
                ((prev.get("face_cx_norm") or 0.65) + (nxt.get("face_cx_norm") or 0.65)) / 2, 4
            )
            s["_rewritten_to_dominant"] = True
        rewritten.append(s)

    # Rule 1 — merge adjacent cuts with imperceptible reframing.
    merged = []
    for s in rewritten:
        if merged:
            last = merged[-1]
            same_shot = last.get("shot") == s.get("shot")
            same_who = last.get("who") == s.get("who")
            both_tight = last.get("shot") == "TIGHT_SINGLE"
            # Never merge across forced/bridge boundaries — different source geometry.
            same_source = (last.get("_forced") == s.get("_forced")
                           and last.get("_forced_from") == s.get("_forced_from")
                           and not last.get("_bridge") and not s.get("_bridge"))
            if both_tight and same_shot and same_who and same_source:
                a = last.get("face_cx_norm")
                b = s.get("face_cx_norm")
                if a is not None and b is not None and abs(a - b) <= cx_tolerance:
                    last["end_rel"] = s["end_rel"]
                    # Weighted face center by segment duration for a stable crop
                    dur_a = last["end_rel"] - last["start_rel"] - (s["end_rel"] - s["start_rel"])
                    dur_b = s["end_rel"] - s["start_rel"]
                    last["face_cx_norm"] = round((a * dur_a + b * dur_b) / (dur_a + dur_b), 4)
                    continue
        merged.append(dict(s))
    return merged


def fix_bad_cx(segs: list, threshold: float = 0.08) -> list:
    """Replace outlier face_cx_norm with the speaker's median.

    When the shot detector returns a cx that's clearly off (e.g. 0.43 for
    a guest who's normally at ~0.65), it means the crop will frame curtains
    or furniture instead of the face.  We compute the weighted-by-duration
    median cx per speaker across all TIGHT_SINGLE segments and override any
    segment whose cx deviates more than `threshold` (default 8 % of frame).
    """
    if not segs:
        return segs
    # Collect (cx, duration) per speaker
    per_speaker: dict[str, list[tuple[float, float]]] = {}
    for s in segs:
        if s.get("shot") == "TIGHT_SINGLE" and s.get("face_cx_norm") is not None:
            who = s.get("who", "guest")
            dur = s["end_rel"] - s["start_rel"]
            per_speaker.setdefault(who, []).append((s["face_cx_norm"], dur))
    # Weighted median (sort by cx, pick the one at 50 % cumulative weight)
    medians: dict[str, float] = {}
    for who, pairs in per_speaker.items():
        pairs.sort(key=lambda p: p[0])
        total_w = sum(d for _, d in pairs)
        cum = 0.0
        for cx, d in pairs:
            cum += d
            if cum >= total_w / 2:
                medians[who] = cx
                break
    if not medians:
        return segs
    out = []
    for s in segs:
        s = dict(s)
        # Skip forced-intro and bridge segments — their cx is intentional
        # for the source geometry (e.g. 0.75 for guest in SIDE_BY_SIDE).
        if s.get("_forced") or s.get("_bridge"):
            out.append(s)
            continue
        if s.get("shot") == "TIGHT_SINGLE" and s.get("face_cx_norm") is not None:
            who = s.get("who", "guest")
            med = medians.get(who)
            if med is not None and abs(s["face_cx_norm"] - med) > threshold:
                print(f"      ⚡ fix_bad_cx: seg cx={s['face_cx_norm']:.4f} → {med:.4f} ({who})")
                s["face_cx_norm"] = med
                s["_cx_fixed"] = True
        out.append(s)
    return out


def absorb_micro_segments(segs: list, min_dur: float = 2.0) -> list:
    """Merge segments shorter than min_dur into their best neighbor.

    Short segments (<2s) cause jarring rapid cuts. For each micro-segment:
    - If same shot type + speaker as neighbor → extend neighbor to cover it.
    - SIDE_BY_SIDE/BROLL <2s → convert to TIGHT_SINGLE of dominant speaker
      using the nearest TIGHT_SINGLE's cx.
    - Otherwise → absorb into the longer neighbor.

    Must run AFTER close_gaps (so segments are contiguous) and BEFORE
    merge_redundant (which can then collapse the absorbed segments).
    """
    if len(segs) <= 1:
        return segs
    dom = dominant_speaker(segs)

    out = list(segs)  # work on a copy
    changed = True
    while changed:
        changed = False
        new_out = []
        skip = set()
        for i, s in enumerate(out):
            if i in skip:
                continue
            dur = s["end_rel"] - s["start_rel"]
            if dur >= min_dur:
                new_out.append(dict(s))
                continue

            # Find best neighbor to absorb into
            prev = new_out[-1] if new_out else None
            nxt = out[i + 1] if i + 1 < len(out) and (i + 1) not in skip else None

            # For non-TIGHT_SINGLE micro-segments, convert to tight of dominant speaker
            if s.get("shot") != "TIGHT_SINGLE":
                # Find nearest TIGHT_SINGLE cx
                nearest_cx = None
                for offset in [1, -1, 2, -2, 3, -3]:
                    j = i + offset
                    if 0 <= j < len(out) and out[j].get("shot") == "TIGHT_SINGLE":
                        nearest_cx = out[j].get("face_cx_norm", 0.65)
                        break
                if nearest_cx is None:
                    nearest_cx = 0.65
                s = dict(s)
                print(f"      ⚡ absorb: convert {s['shot']} ({dur:.1f}s) → TIGHT_SINGLE cx={nearest_cx:.4f}")
                s["shot"] = "TIGHT_SINGLE"
                s["who"] = dom
                s["face_cx_norm"] = nearest_cx
                s["_absorbed"] = True
                new_out.append(s)
                changed = True
                continue

            # TIGHT_SINGLE micro-seg: absorb into neighbor with closest cx
            if prev and prev.get("shot") == "TIGHT_SINGLE" and prev.get("who") == s.get("who"):
                prev["end_rel"] = s["end_rel"]
                print(f"      ⚡ absorb: merge seg {i} ({dur:.1f}s) into previous")
                changed = True
                continue
            if nxt and nxt.get("shot") == "TIGHT_SINGLE" and nxt.get("who") == s.get("who"):
                merged = dict(nxt)
                merged["start_rel"] = s["start_rel"]
                new_out.append(merged)
                skip.add(i + 1)
                print(f"      ⚡ absorb: merge seg {i} ({dur:.1f}s) into next")
                changed = True
                continue

            # Last resort: just keep it (different speakers, both tight single)
            new_out.append(dict(s))
        out = new_out
    return out


BRIDGE_DUR = 1.3  # seconds — host reaction cutaway duration


# Host face position when cropping from a SIDE_BY_SIDE composite frame.
# She sits in the left half of the 1920-wide composite at ~0.24.
HOST_CX_IN_SBS = 0.24
HOST_CY_IN_SBS = 0.33


def find_host_reaction(all_shots: list, min_dur: float = 5.0) -> dict | None:
    """Find the best host LISTENING reaction across the whole episode.

    Strategy: prefer SIDE_BY_SIDE segments where the guest is speaking
    and the host is visible in the left half listening/nodding.  These
    produce natural "attentive host" frames — much better than TIGHT_SINGLE
    host segments which are usually Iman *talking*, not reacting.

    Falls back to TIGHT_SINGLE host shots only if no SIDE_BY_SIDE exists.
    """
    # 1) SIDE_BY_SIDE segments (host listening while guest speaks)
    sbs_candidates = []
    for clip in all_shots:
        for seg in clip["segments"]:
            if seg.get("shot") == "SIDE_BY_SIDE":
                dur = seg["end"] - seg["start"]
                if dur >= min_dur:
                    sbs_candidates.append({
                        "abs_start": seg["start"],
                        "abs_end": seg["end"],
                        "dur": dur,
                        "face_cx_norm": HOST_CX_IN_SBS,
                        "face_cy_norm": HOST_CY_IN_SBS,
                        "source_shot": "SIDE_BY_SIDE",
                        "clip_idx": clip["index"],
                    })
    if sbs_candidates:
        # Prefer longest — more room to pick a good slice from the middle
        sbs_candidates.sort(key=lambda c: -c["dur"])
        return sbs_candidates[0]

    # 2) Fallback: TIGHT_SINGLE host (may be talking, not ideal)
    tight_candidates = []
    for clip in all_shots:
        for seg in clip["segments"]:
            if seg.get("shot") == "TIGHT_SINGLE" and seg.get("who") == "host":
                dur = seg["end"] - seg["start"]
                if dur >= 1.5:
                    tight_candidates.append({
                        "abs_start": seg["start"],
                        "abs_end": seg["end"],
                        "dur": dur,
                        "face_cx_norm": seg.get("face_cx_norm", 0.40),
                        "face_cy_norm": seg.get("face_cy_norm"),
                        "source_shot": "TIGHT_SINGLE",
                        "clip_idx": clip["index"],
                    })
    if tight_candidates:
        tight_candidates.sort(key=lambda c: -c["dur"])
        return tight_candidates[0]
    return None


def insert_host_bridge(segs: list, all_shots: list) -> list:
    """When the first segment is a forced SIDE_BY_SIDE/WIDE_2SHOT intro,
    insert a brief (~0.7s) host-reaction cutaway between intro and guest.

    This is the classic podcast editorial trick: a cutaway to the interviewer
    nodding/listening masks any camera framing mismatch at the transition.
    The AUDIO stays continuous from the main timeline (guest keeps talking),
    only the VIDEO is sourced from a different point in the episode.

    The bridge segment carries `video_source_abs` so build_filter_complex
    knows to pull video from the host's abs time but audio from the normal
    clip timeline.
    """
    if not segs or len(segs) < 2:
        return segs
    first = segs[0]
    if not first.get("_forced") or first.get("_forced_from") not in (
        "SIDE_BY_SIDE", "WIDE_2SHOT", "BROLL"
    ):
        return segs

    host = find_host_reaction(all_shots)
    if host is None:
        return segs  # no host shot available — skip bridge

    # Carve BRIDGE_DUR from the start of seg[1]
    second = dict(segs[1])
    bridge_start_rel = second["start_rel"]
    bridge_end_rel = bridge_start_rel + BRIDGE_DUR
    if bridge_end_rel >= second["end_rel"] - 0.3:
        return segs  # seg[1] too short, don't squeeze it

    # Pick video slice from the middle of the host shot (safest)
    host_mid = (host["abs_start"] + host["abs_end"]) / 2
    vid_start = host_mid - BRIDGE_DUR / 2

    bridge_seg = {
        "shot": "TIGHT_SINGLE",
        "who": "host",
        "face_cx_norm": host["face_cx_norm"],
        "face_cy_norm": host.get("face_cy_norm"),
        "start_rel": bridge_start_rel,
        "end_rel": bridge_end_rel,
        "video_source_abs": vid_start,  # ← key field for filter_complex
        "_bridge": True,
    }
    second["start_rel"] = bridge_end_rel

    out = [dict(first), bridge_seg, second] + [dict(s) for s in segs[2:]]
    return out


def zoom_match_intro(segs: list, zoom: float = 1.18) -> list:
    """When seg[0] is a forced SIDE_BY_SIDE/WIDE_2SHOT intro, the guest's
    face is ~1.2x larger than in the dedicated TIGHT_SINGLE camera. Apply
    a zoom factor to all subsequent TIGHT_SINGLE segments so the face size
    matches at the cut — this is what keeps the transition from feeling
    like the camera suddenly pulled back.

    Only applies when the first seg carries `_forced_from` in the wide shot
    family. Untouched for reels that already start on TIGHT_SINGLE."""
    if not segs:
        return segs
    first = segs[0]
    if not first.get("_forced") or first.get("_forced_from") not in (
        "SIDE_BY_SIDE", "WIDE_2SHOT", "BROLL"
    ):
        return segs
    out = [dict(s) for s in segs]
    for s in out[1:]:
        if s.get("shot") == "TIGHT_SINGLE" and "zoom" not in s:
            s["zoom"] = zoom
    return out


def close_gaps(segs: list, clip_duration_s: float) -> list:
    """Remove tiny gaps between segments that cause black frames and audio
    cuts mid-word. The detector sometimes leaves 0.3-0.5s gaps between shots;
    we extend each segment up to the next segment's start, and the last
    segment up to the end of the clip. Shot type is preserved."""
    if not segs:
        return segs
    out = [dict(s) for s in segs]
    if out[0]["start_rel"] > 0:
        out[0]["start_rel"] = 0.0
    for i in range(len(out) - 1):
        out[i]["end_rel"] = out[i + 1]["start_rel"]
    out[-1]["end_rel"] = clip_duration_s
    return out


# ---------- Filter builders ----------

def filter_tight_single(face_cx_norm: float, face_cy_norm: float = None,
                        zoom: float = 1.0) -> str:
    """
    Face-centered vertical crop.

    Source: 1920x1080. We want a 9:16 output (1080x1920).
    Step 1: take a crop of the source with aspect 9:16 and height=1080.
            Base width = 608 (=1080*9/16). Divide by zoom to crop tighter.
            x_start = face_cx - crop_w/2, clamped to source bounds.
    Step 2: scale crop to 1080x1920.

    The `zoom` factor lets us enlarge the face when a source camera shot
    Maria wider than the SIDE_BY_SIDE intro. With zoom>1, we crop a smaller
    region and up-scale more, so the apparent face size matches the intro
    framing — key for making a SIDE_BY_SIDE → TIGHT_SINGLE cut feel like a
    standard edit instead of "de repente la cámara se aleja".
    """
    cx_px = face_cx_norm * 1920
    crop_w = int(round(608 / zoom))
    # Also crop vertically when zooming so aspect stays 9:16
    crop_h = int(round(1080 / zoom))
    x = max(0, min(1920 - crop_w, cx_px - crop_w / 2))
    x = int(round(x))
    # Vertical crop centered on face_cy if provided, else centered on 1080/2
    cy_px = (face_cy_norm if face_cy_norm is not None else 0.5) * 1080
    y = max(0, min(1080 - crop_h, cy_px - crop_h / 2))
    y = int(round(y))
    return f"crop={crop_w}:{crop_h}:{x}:{y},scale=1080:1920,setsar=1"


def filter_split_vertical(source_kind: str = "wide") -> str:
    """
    Horizontal split screen (top/bottom).

    source_kind:
      "wide"  → wide 2-shot of both speakers on couches (1920x1080 source).
                Host sits in left third, guest in right third.
                Crop each speaker's third (640x1080) and stack.
      "split" → source is already an edited side-by-side (left half host, right half guest).
                Crop each half (960x1080) and stack.
    """
    if source_kind == "wide":
        # Host: x=256..896 (the left person)
        # Guest: x=1024..1664 (the right person)
        host_x, half_w = 256, 640
        guest_x = 1024
    else:
        host_x, half_w = 0, 960
        guest_x = 960
    return (
        "split=2[a][b];"
        # left person → top
        f"[a]crop={half_w}:1080:{host_x}:0,scale=1080:-2,"
        f"crop=1080:960:(iw-1080)/2:(ih-960)/2[top];"
        # right person → bottom
        f"[b]crop={half_w}:1080:{guest_x}:0,scale=1080:-2,"
        f"crop=1080:960:(iw-1080)/2:(ih-960)/2[bot];"
        "[top][bot]vstack=inputs=2,setsar=1"
    )


def filter_broll_center() -> str:
    """Centered 9:16 crop of the source — safe fallback when no face is visible
    (e.g. true cutaway b-roll like product/supermarket shots)."""
    return "crop=608:1080:(iw-608)/2:0,scale=1080:1920,setsar=1"


def filter_for_segment(seg: dict) -> str:
    shot = seg["shot"]
    if shot == "TIGHT_SINGLE" and "face_cx_norm" in seg:
        return filter_tight_single(seg["face_cx_norm"], seg.get("face_cy_norm"))
    if shot == "SIDE_BY_SIDE":
        return filter_split_vertical("split")
    if shot == "WIDE_2SHOT":
        return filter_split_vertical("wide")
    if shot == "BROLL":
        # BROLL in practice is usually a wide 2-shot whose faces the detector missed.
        # Applying the wide split yields the correct host-top / guest-bottom framing.
        return filter_split_vertical("wide")
    # Fallback: safe center crop
    return filter_tight_single(0.5)


# ---------- Single-pass multi-segment render ----------
#
# We render the entire clip in ONE ffmpeg invocation using a single
# filter_complex graph that trims, reframes and concatenates every segment
# internally. This avoids the "tirón" / pop that the concat demuxer produces
# when stitching separately-encoded mp4 files.

def _tight_chain(crop_w: int, x: int) -> str:
    return f"crop={crop_w}:1080:{x}:0,scale=1080:1920,setsar=1"


def _video_segment_graph(i: int, seg: dict, in_label: str, out_label: str) -> str:
    """Return a filter chain that transforms [in_label] → [out_label] for this seg.
    Produces unique intermediate labels (suffixed with segment index)."""
    shot = seg["shot"]
    if shot == "TIGHT_SINGLE" and "face_cx_norm" in seg:
        # Use the filter_tight_single helper so zoom + vertical crop logic
        # stays in one place. Segment may carry `zoom` (float >= 1.0) from
        # the intro-size-matching pass.
        chain = filter_tight_single(
            seg["face_cx_norm"],
            seg.get("face_cy_norm"),
            zoom=seg.get("zoom", 1.0),
        )
        return f"[{in_label}]{chain}[{out_label}]"
    if shot in ("SIDE_BY_SIDE", "WIDE_2SHOT", "BROLL"):
        kind = "split" if shot == "SIDE_BY_SIDE" else "wide"
        if kind == "wide":
            host_x, half_w, guest_x = 256, 640, 1024
        else:
            host_x, half_w, guest_x = 0, 960, 960
        return (
            f"[{in_label}]split=2[sa{i}][sb{i}];"
            f"[sa{i}]crop={half_w}:1080:{host_x}:0,scale=1080:-2,"
            f"crop=1080:960:(iw-1080)/2:(ih-960)/2[top{i}];"
            f"[sb{i}]crop={half_w}:1080:{guest_x}:0,scale=1080:-2,"
            f"crop=1080:960:(iw-1080)/2:(ih-960)/2[bot{i}];"
            f"[top{i}][bot{i}]vstack=inputs=2,setsar=1[{out_label}]"
        )
    # Fallback: center tight crop
    return f"[{in_label}]{_tight_chain(608, 656)}[{out_label}]"


XFADE_DUR = 0.15  # 150ms — smooth reframe blend & soft audio crossfade at cuts
# When the intro was forced from a SIDE_BY_SIDE/WIDE_2SHOT source the face_cx
# delta with the next TIGHT_SINGLE is large (0.75 vs 0.65). Blending that with
# xfade produces a visible "slide" of the image during the dissolve. We use a
# HARD CUT instead (xfade=0 via a 1-frame dissolve) — style matches the
# reference Biohack-it reels and it's cleanly perceived as an edit, not a glitch.
XFADE_DUR_INTRO_HARDCUT = 1.0 / 30.0  # 1 frame at 30fps


def build_filter_complex(clip_start_s: float, segs: list,
                         bridge_inputs: dict = None) -> str:
    """
    Single filter_complex that:
      1. Trims the source once per segment → unique label per segment
      2. Applies the per-segment reframe chain (with label suffixes to avoid clashes)
      3. Joins segments: uses **concat** when bridge segments are present (hard cuts
         that don't freeze frames), or xfade/acrossfade otherwise (smooth reframes).

    When using concat, transitions are instant hard cuts — exactly what we want
    for bridge reaction cutaways. xfade has a bug where pre-extracted bridge
    clips get frozen to a single frame (dup/drop all frames).
    """
    has_bridge = any(s.get("_bridge") for s in segs)

    parts = []
    seg_durs: list[float] = []
    for i, seg in enumerate(segs):
        a = clip_start_s + seg["start_rel"]
        b = clip_start_s + seg["end_rel"]
        dur = b - a
        seg_durs.append(dur)

        # Video: bridge segments use a pre-extracted clip (separate input)
        if "video_source_abs" in seg and bridge_inputs and i in bridge_inputs:
            inp_idx = bridge_inputs[i]
            parts.append(
                f"[{inp_idx}:v]setpts=PTS-STARTPTS,"
                f"fps=30,format=yuv420p[trim{i}]"
            )
        else:
            parts.append(
                f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS,"
                f"fps=30,format=yuv420p[trim{i}]"
            )
        parts.append(_video_segment_graph(i, seg, f"trim{i}", f"v{i}"))
        # Audio: ALWAYS from the main clip timeline (continuous speech)
        parts.append(
            f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,"
            f"aresample=48000[a{i}]"
        )

    n = len(segs)
    if n == 1:
        parts.append("[v0]copy[outv]")
        parts.append("[a0]acopy[outa]")
        return ";".join(parts)

    if has_bridge:
        # ── CONCAT mode: hard cuts, no blending ──
        # The concat filter simply joins segments back-to-back. This avoids
        # the xfade bug that freezes bridge frames and gives us the clean
        # hard cuts Albert requested.
        concat_in = "".join(f"[v{i}][a{i}]" for i in range(n))
        parts.append(f"{concat_in}concat=n={n}:v=1:a=1[outv][outa]")
    else:
        # ── XFADE mode: smooth 150ms dissolves between reframes ──
        running_v = "v0"
        running_a = "a0"
        running_dur = seg_durs[0]
        for i in range(1, n):
            is_intro_hardcut = (
                i == 1
                and segs[0].get("_forced")
                and segs[0].get("_forced_from") in (
                    "SIDE_BY_SIDE", "WIDE_2SHOT", "BROLL")
            )
            xf_v = XFADE_DUR_INTRO_HARDCUT if is_intro_hardcut else XFADE_DUR
            xf_a = 0.06 if is_intro_hardcut else XFADE_DUR
            offset_v = running_dur - xf_v
            if offset_v < 0:
                offset_v = 0.0
            parts.append(
                f"[{running_v}][v{i}]xfade=transition=fade:"
                f"duration={xf_v}:offset={offset_v:.4f}[xv{i}]"
            )
            parts.append(
                f"[{running_a}][a{i}]acrossfade=d={xf_a}:c1=tri:c2=tri[xa{i}]"
            )
            running_v = f"xv{i}"
            running_a = f"xa{i}"
            running_dur = running_dur + seg_durs[i] - xf_v

        parts.append(f"[{running_v}]copy[outv]")
        parts.append(f"[{running_a}]acopy[outa]")

    return ";".join(parts)


def process_clip(clip: dict, shot_info: dict, all_shots: list = None) -> str:
    idx = clip["index"]
    print(f"\n✂️  Clip {idx:02d}  {clip['hook']}  [{clip['startMs']/1000:.1f}-{clip['endMs']/1000:.1f}s]")
    clip_start_s = clip["startMs"] / 1000.0
    out_file = OUT_DIR / f"clip-{idx:02d}.mp4"

    clip_duration_s = (clip["endMs"] - clip["startMs"]) / 1000.0
    segs = shot_info["segments"]
    if not segs:
        segs = [{"shot": "TIGHT_SINGLE", "face_cx_norm": 0.5, "start_rel": 0.0,
                 "end_rel": clip_duration_s}]

    # Regla: el reel siempre empieza con plano individual del que habla.
    segs = enforce_intro_tight(segs)
    # Cerrar gaps: cada segmento llega hasta el inicio del siguiente
    # (evita frames en negro y cortes de audio a mitad de palabra).
    segs = close_gaps(segs, clip_duration_s)
    # QA fixes: corregir cx outliers y absorber micro-segmentos (<2s)
    segs = fix_bad_cx(segs)
    segs = absorb_micro_segments(segs)
    # Colapsar cortes innecesarios (reframes imperceptibles + micro-cutaways al no dominante).
    segs = merge_redundant(segs, cx_tolerance=0.040)
    # Insert host reaction bridge at forced intro transitions — classic
    # podcast editing trick to mask camera framing mismatches. Audio stays
    # continuous (guest keeps talking), only video cuts to host nodding.
    # When a bridge is inserted, zoom_match_intro is SKIPPED — the bridge
    # already hides the framing change, and the zoom crop looked unnatural.
    if all_shots:
        segs_with_bridge = insert_host_bridge(segs, all_shots)
        has_bridge = any(s.get("_bridge") for s in segs_with_bridge)
        segs = segs_with_bridge
    else:
        has_bridge = False
    if not has_bridge:
        # Only zoom-match when there's no bridge to hide the cut
        segs = zoom_match_intro(segs)

    for i, seg in enumerate(segs):
        who = f" ({seg.get('who')})" if seg.get("who") else ""
        dur = seg["end_rel"] - seg["start_rel"]
        print(f"   → seg {i:02d}  {seg['start_rel']:6.2f}-{seg['end_rel']:6.2f}s  {dur:5.2f}s  {seg['shot']}{who}")

    # Bridge segments need video from a different position in the source.
    # We pre-extract each bridge as a small clip file, then pass it as an
    # extra ffmpeg input. The main filter uses CONCAT (not xfade) to join
    # segments — xfade has a bug that freezes bridge frames.
    bridge_inputs = {}  # seg_index → ffmpeg input index
    bridge_files = []
    extra_inputs = []
    for i, seg in enumerate(segs):
        if "video_source_abs" in seg:
            va = seg["video_source_abs"]
            dur_s = seg["end_rel"] - seg["start_rel"]
            tmp = str(OUT_DIR / f"_bridge_{idx:02d}_{i}.mp4")
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(SOURCE),
                "-ss", str(va), "-t", str(dur_s),
                "-r", "30",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12",
                "-an", "-pix_fmt", "yuv420p",
                tmp,
            ], check=True)
            inp_idx = 1 + len(bridge_files)
            bridge_inputs[i] = inp_idx
            bridge_files.append(tmp)
            extra_inputs.extend(["-i", tmp])

    fc = build_filter_complex(clip_start_s, segs, bridge_inputs=bridge_inputs)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(SOURCE),
    ] + extra_inputs + [
        "-filter_complex", fc,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        str(out_file),
    ]
    subprocess.run(cmd, check=True)
    for bf in bridge_files:
        try:
            os.remove(bf)
        except OSError:
            pass
    print(f"   ✅ {out_file}")
    return str(out_file.relative_to(ROOT / "public"))


def main():
    clips = json.load(open(CLIPS_JSON))
    shots = json.load(open(SHOTS_JSON))
    shots_by_idx = {s["index"]: s for s in shots}

    # Rebuild clips.json with new clipFile paths (same as before)
    updated = []
    music_dir = ROOT / "public/music"
    music_files = []
    if music_dir.exists():
        music_files = sorted([f for f in os.listdir(music_dir)
                              if f.lower().endswith(('.mp3', '.wav', '.m4a', '.aac', '.ogg'))])
    def pick_music(i):
        if not music_files: return None
        return f"music/{music_files[i % len(music_files)]}"

    only = sys.argv[1:]
    for c in clips:
        if only and str(c["index"]) not in only:
            pass
        else:
            process_clip(c, shots_by_idx[c["index"]], all_shots=shots)
        # Preserve manually set music & musicStartSec; only auto-fill if absent.
        preserved = {**c}
        if "music" not in preserved or not preserved["music"]:
            preserved["music"] = pick_music(c["index"] - 1)
        preserved["clipFile"] = f"clips/maria-marlowe/clip-{c['index']:02d}.mp4"
        updated.append(preserved)

    with open(CLIPS_JSON, "w") as f:
        json.dump(updated, f, indent=2)
    manifest_path = OUT_DIR / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(updated, f, indent=2)
    print(f"\n✅ Clips manifest → {manifest_path}")


if __name__ == "__main__":
    main()
