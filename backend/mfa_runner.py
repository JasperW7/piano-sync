import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from whisper_aligner import align_with_whisper

log = logging.getLogger(__name__)

MFA_CONDA_ENV = os.getenv("MFA_CONDA_ENV", "mfa")
MFA_ACOUSTIC_MODEL = "japanese_mfa"
MFA_DICTIONARY = "japanese_mfa"
SEGMENT_PADDING = 0.15
MFA_TIMEOUT = 300


# ── Audio conversion ─────────────────────────────────────────

def convert_to_wav(mp3_path, wav_path):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(mp3_path),
            "-ar", "16000",
            "-ac", "1",
            str(wav_path),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


# ── Corpus preparation ───────────────────────────────────────

def prepare_corpus(lyric_lines, whisper_timings, wav_path, corpus_dir):
    segments_dir = Path(corpus_dir) / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)

    segment_metadata = []

    for timing in whisper_timings:
        if timing["start"] is None:
            continue

        lyric_index = timing["lyric_index"]
        lyric = timing["lyric"]
        start = float(timing["start"])
        end = float(timing["end"])

        padded_start = max(0.0, start - SEGMENT_PADDING)
        padded_end = end + SEGMENT_PADDING

        segment_name = f"segment_{lyric_index:03d}"
        seg_wav = segments_dir / f"{segment_name}.wav"
        seg_lab = segments_dir / f"{segment_name}.lab"

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(wav_path),
                "-ss", f"{padded_start:.3f}",
                "-to", f"{padded_end:.3f}",
                "-ar", "16000",
                "-ac", "1",
                str(seg_wav),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )

        seg_lab.write_text(lyric + "\n", encoding="utf-8")

        segment_metadata.append({
            "name": segment_name,
            "lyric_index": lyric_index,
            "lyric": lyric,
            "start": start,
            "end": end,
            "padded_start": padded_start,
            "padded_end": padded_end,
        })

    log.info("Prepared %d MFA segments", len(segment_metadata))
    return segment_metadata


# ── Run MFA ──────────────────────────────────────────────────

def run_mfa(corpus_dir, output_dir):
    segments_dir = Path(corpus_dir) / "segments"
    cmd = [
        "conda", "run", "-n", MFA_CONDA_ENV,
        "mfa", "align",
        str(segments_dir),
        MFA_DICTIONARY,
        MFA_ACOUSTIC_MODEL,
        str(output_dir),
        "--clean",
    ]

    log.info("Running MFA: %s", " ".join(cmd))

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=MFA_TIMEOUT,
    )

    if result.returncode != 0:
        log.error("MFA stderr: %s", result.stderr)
        raise RuntimeError(
            f"MFA exited with code {result.returncode}: {result.stderr[:500]}"
        )

    log.info("MFA alignment complete")


# ── TextGrid parsing ─────────────────────────────────────────

def parse_textgrid(path):
    text = Path(path).read_text(encoding="utf-8-sig")

    tier_pattern = re.compile(
        r'name\s*=\s*"([^"]+)"'
        r'(.*?)'
        r'(?=\n\s*item\s*\[\d+\]:|\Z)',
        re.DOTALL,
    )

    tiers = {}

    for match in tier_pattern.finditer(text):
        tier_name = match.group(1)
        tier_body = match.group(2)

        if tier_name not in ("words", "phones"):
            continue

        interval_pattern = re.compile(
            r'intervals\s*\[\d+\]:\s*'
            r'xmin\s*=\s*([0-9.eE+-]+)\s*'
            r'xmax\s*=\s*([0-9.eE+-]+)\s*'
            r'text\s*=\s*"(.*?)"',
            re.DOTALL,
        )

        intervals = []
        for interval in interval_pattern.finditer(tier_body):
            start = float(interval.group(1))
            end = float(interval.group(2))
            label = interval.group(3).strip()
            if not label:
                continue
            intervals.append({"start": start, "end": end, "text": label})

        tiers[tier_name] = intervals

    return tiers


# ── Timing extraction ────────────────────────────────────────

def extract_timings(mfa_output_dir, segment_metadata):
    results = []

    for seg in segment_metadata:
        segment_name = seg["name"]
        lyric_index = seg["lyric_index"]
        lyric = seg["lyric"]
        offset = float(seg["padded_start"])

        textgrid_path = Path(mfa_output_dir) / f"{segment_name}.TextGrid"

        if not textgrid_path.exists():
            log.warning("Missing TextGrid for %s", segment_name)
            results.append({
                "lyric_index": lyric_index,
                "lyric": lyric,
                "start": None,
                "end": None,
                "score": 0.0,
                "source": "none",
                "words": [],
                "phones": [],
            })
            continue

        tiers = parse_textgrid(textgrid_path)

        words = [
            {"start": round(i["start"] + offset, 4),
             "end": round(i["end"] + offset, 4),
             "text": i["text"]}
            for i in tiers.get("words", [])
        ]

        phones = [
            {"start": round(i["start"] + offset, 4),
             "end": round(i["end"] + offset, 4),
             "text": i["text"]}
            for i in tiers.get("phones", [])
        ]

        mfa_start = words[0]["start"] if words else float(seg["start"])
        mfa_end = words[-1]["end"] if words else float(seg["end"])

        results.append({
            "lyric_index": lyric_index,
            "lyric": lyric,
            "start": mfa_start,
            "end": mfa_end,
            "score": 1.0,
            "source": "mfa",
            "words": words,
            "phones": phones,
        })

        log.info(
            "Line %02d: %.2f -> %.2f  %s",
            lyric_index, mfa_start, mfa_end, lyric,
        )

    return results


# ── Public entry point ───────────────────────────────────────

def align_with_mfa(lyrics_text, audio_path):
    if isinstance(lyrics_text, str):
        lyric_lines = [
            line.strip()
            for line in lyrics_text.splitlines()
            if line.strip()
        ]
    else:
        lyric_lines = [str(l).strip() for l in lyrics_text if str(l).strip()]

    if not lyric_lines:
        raise ValueError("No lyrics provided")

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    tmp = tempfile.mkdtemp(prefix="mfa_")

    try:
        wav_path = os.path.join(tmp, "song.wav")
        convert_to_wav(audio_path, wav_path)
        log.info("Converted to WAV: %s", wav_path)

        log.info("Running Whisper for rough timestamps...")
        whisper_timings = align_with_whisper(lyric_lines, audio_path)

        matched = [t for t in whisper_timings if t["start"] is not None]
        if not matched:
            raise RuntimeError("Whisper could not match any lyric lines")

        log.info("Whisper matched %d/%d lines", len(matched), len(lyric_lines))

        segment_metadata = prepare_corpus(
            lyric_lines, whisper_timings, wav_path, tmp
        )

        if not segment_metadata:
            raise RuntimeError("No segments created for MFA")

        output_dir = os.path.join(tmp, "mfa_output")
        os.makedirs(output_dir, exist_ok=True)

        run_mfa(tmp, output_dir)

        results = extract_timings(output_dir, segment_metadata)

        unmatched_indices = {t["lyric_index"] for t in whisper_timings if t["start"] is None}
        for timing in whisper_timings:
            if timing["lyric_index"] in unmatched_indices:
                results.append({
                    "lyric_index": timing["lyric_index"],
                    "lyric": timing["lyric"],
                    "start": None,
                    "end": None,
                    "score": 0.0,
                    "source": "none",
                    "words": [],
                    "phones": [],
                })

        results.sort(key=lambda r: r["lyric_index"])
        return results

    finally:
        shutil.rmtree(tmp, ignore_errors=True)
