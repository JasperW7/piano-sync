import logging
from difflib import SequenceMatcher

import stable_whisper

from text_utils import normalize_whisper

log = logging.getLogger(__name__)

MODEL_NAME = "base"
_model = None


def get_whisper_model():
    global _model
    if _model is None:
        log.info("Loading Whisper model '%s'...", MODEL_NAME)
        _model = stable_whisper.load_model(MODEL_NAME)
    return _model


def transcribe(audio_path, language="ja"):
    model = get_whisper_model()
    log.info("Transcribing: %s", audio_path)
    return model.transcribe(audio_path, language=language, word_timestamps=True)


def build_word_stream(result):
    words = []
    for segment in result.segments:
        for word in segment.words:
            text = word.word.strip()
            if not text:
                continue
            words.append({
                "text": text,
                "start": word.start,
                "end": word.end,
            })
    return words


def build_character_timeline(result):
    words = build_word_stream(result)
    chars = []
    for word in words:
        cleaned = normalize_whisper(word["text"])
        if "音楽" in cleaned:
            continue
        for char in cleaned:
            chars.append({
                "char": char,
                "start": word["start"],
                "end": word["end"],
            })
    return chars


def fuzzy_align_lyrics(lyric_lines, character_timeline):
    cursor = 0
    results = []

    for lyric_index, lyric in enumerate(lyric_lines):
        target = list(normalize_whisper(lyric))
        if not target:
            continue

        best_start = None
        best_end = None
        best_score = -1

        max_window = len(target) + 15
        search_end = min(len(character_timeline), cursor + max_window + 80)

        for start in range(cursor, search_end):
            if start >= len(character_timeline):
                break

            for extra in range(-3, 16):
                length = len(target) + extra
                if length <= 0:
                    continue

                end = start + length
                if end > len(character_timeline):
                    continue

                candidate = "".join(
                    x["char"] for x in character_timeline[start:end]
                )
                score = SequenceMatcher(
                    None, "".join(target), candidate
                ).ratio()

                if score > best_score:
                    best_score = score
                    best_start = start
                    best_end = end

        if best_start is None:
            log.warning(
                "Could not match lyric line %d: %s", lyric_index, lyric
            )
            results.append({
                "lyric_index": lyric_index,
                "lyric": lyric,
                "start": None,
                "end": None,
                "score": 0.0,
                "source": "whisper",
            })
            continue

        start_time = character_timeline[best_start]["start"]
        end_time = character_timeline[best_end - 1]["end"]

        results.append({
            "lyric_index": lyric_index,
            "lyric": lyric,
            "start": start_time,
            "end": end_time,
            "score": best_score,
            "source": "whisper",
        })

        cursor = best_end

        log.info(
            "Line %02d: %.2f -> %.2f (score %.3f) %s",
            lyric_index, start_time, end_time, best_score, lyric,
        )

    return results


def align_with_whisper(lyrics_text, audio_path):
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

    result = transcribe(audio_path)
    timeline = build_character_timeline(result)

    if not timeline:
        raise RuntimeError("Whisper produced no usable characters")

    return fuzzy_align_lyrics(lyric_lines, timeline)
