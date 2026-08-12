import re
from difflib import SequenceMatcher

from romanize import romanize_japanese

_model = None


def _get_model(model_size="base"):
    global _model
    if _model is None:
        import stable_whisper
        _model = stable_whisper.load_model(model_size)
    return _model


def _normalize_for_match(text):
    text = text.casefold()
    text = re.sub(r"[^\w]", "", text, flags=re.UNICODE)
    return text


def transcribe_audio(audio_path, language=None):
    model = _get_model()
    result = model.transcribe(audio_path, language=language)
    result.split_by_gap(0.5)
    return result


def _romanize_segment(text):
    cjk_re = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿]")
    if cjk_re.search(text):
        return romanize_japanese(text)
    return text


def align_lyrics_to_audio(lyrics_text, audio_path, language=None):
    """Align plain-text lyrics to audio timestamps using Whisper.

    Returns a list of {line, start, end} dicts.
    """
    result = transcribe_audio(audio_path, language=language)

    segments = []
    for seg in result.segments:
        romanized = _romanize_segment(seg.text.strip())
        segments.append({
            "text": seg.text.strip(),
            "romanized": romanized,
            "start": seg.start,
            "end": seg.end,
        })

    lyrics_lines = [line for line in lyrics_text.splitlines() if line.strip()]

    aligned = []
    seg_idx = 0

    for line in lyrics_lines:
        norm_line = _normalize_for_match(line)
        if not norm_line:
            continue

        best_score = 0.0
        best_seg_idx = seg_idx
        search_window = min(len(segments), seg_idx + 15)

        for i in range(seg_idx, search_window):
            norm_seg = _normalize_for_match(segments[i]["romanized"])
            if not norm_seg:
                continue

            score = SequenceMatcher(None, norm_line, norm_seg).ratio()

            if norm_line in norm_seg or norm_seg in norm_line:
                shorter = min(len(norm_line), len(norm_seg))
                longer = max(len(norm_line), len(norm_seg))
                if longer and shorter / longer >= 0.3:
                    score = max(score, 0.85)

            if score > best_score:
                best_score = score
                best_seg_idx = i

        if best_score >= 0.4:
            seg = segments[best_seg_idx]
            aligned.append({
                "line": line,
                "start": round(seg["start"], 2),
                "end": round(seg["end"], 2),
            })
            seg_idx = best_seg_idx + 1
        else:
            if aligned:
                prev_end = aligned[-1]["end"]
                aligned.append({
                    "line": line,
                    "start": round(prev_end, 2),
                    "end": round(prev_end + 3.0, 2),
                })
            else:
                aligned.append({
                    "line": line,
                    "start": 0.0,
                    "end": 3.0,
                })

    return aligned
