import json
import re
import unicodedata
from pathlib import Path
from difflib import SequenceMatcher

CORPUS = Path(r"C:\Users\jaspe\mfa-corpus")
WHISPER = CORPUS / "whisper.json"
LYRICS = Path(r"C:\Users\jaspe\Downloads\lyric.txt")


# ------------------------------------------------------------
# Text normalization
# ------------------------------------------------------------

def normalize(text):
    text = unicodedata.normalize("NFKC", text)

    # Remove Whisper's music markers / punctuation
    text = re.sub(r"[【】「」『』、。！？,.!?…・\s]", "", text)

    return text


def chars(text):
    return list(normalize(text))


# ------------------------------------------------------------
# Load Whisper word timestamps
# ------------------------------------------------------------

with open(WHISPER, "r", encoding="utf-8") as f:
    whisper_data = json.load(f)

words = []

for segment in whisper_data["segments"]:
    if "音楽" in segment["text"]:
        continue

    for word in segment.get("words", []):
        w = normalize(word["word"])

        if not w:
            continue

        words.append({
            "text": w,
            "start": float(word["start"]),
            "end": float(word["end"]),
        })


# ------------------------------------------------------------
# Load known lyrics
# ------------------------------------------------------------

lyrics = [
    line.strip()
    for line in LYRICS.read_text(encoding="utf-8").splitlines()
    if line.strip()
]


print("=" * 100)
print("WHISPER WORDS")
print("=" * 100)

for i, word in enumerate(words):
    print(
        f"{i:3d}: "
        f"{word['start']:7.2f} -> {word['end']:7.2f} "
        f"{word['text']}"
    )


# ------------------------------------------------------------
# Build a character-level Whisper timeline
#
# Each recognized character inherits the timing of its
# corresponding Whisper word.
# ------------------------------------------------------------

whisper_chars = []

for word_index, word in enumerate(words):
    for char in chars(word["text"]):
        whisper_chars.append({
            "char": char,
            "start": word["start"],
            "end": word["end"],
            "word_index": word_index,
        })


# ------------------------------------------------------------
# Fuzzy sequential matching
#
# We know the correct lyrics, but Whisper may have recognized
# slightly different Japanese characters.
# ------------------------------------------------------------

def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()


cursor = 0
results = []


for lyric_index, lyric in enumerate(lyrics):

    target = chars(lyric)

    if not target:
        continue

    best_start = None
    best_end = None
    best_score = -1

    # Search forward through a reasonable window.
    #
    # We use a sliding character window around the expected
    # lyric length.
    max_window = len(target) + 15
    search_end = min(
        len(whisper_chars),
        cursor + max_window + 80
    )

    for start in range(cursor, search_end):

        if start >= len(whisper_chars):
            break

        for extra in range(-3, 16):
            length = len(target) + extra

            if length <= 0:
                continue

            end = start + length

            if end > len(whisper_chars):
                continue

            candidate = "".join(
                x["char"]
                for x in whisper_chars[start:end]
            )

            score = similarity("".join(target), candidate)

            if score > best_score:
                best_score = score
                best_start = start
                best_end = end

    if best_start is None:
        raise RuntimeError(
            f"Could not match lyric line {lyric_index}: {lyric}"
        )

    start_time = whisper_chars[best_start]["start"]
    end_time = whisper_chars[best_end - 1]["end"]

    results.append({
        "lyric_index": lyric_index,
        "lyric": lyric,
        "start": start_time,
        "end": end_time,
        "score": best_score,
    })

    cursor = best_end

    print()
    print(f"LINE {lyric_index + 1:02d}")
    print(f"Timing: {start_time:7.2f} -> {end_time:7.2f}")
    print(f"Score:  {best_score:.3f}")
    print(f"Text:   {lyric}")


# ------------------------------------------------------------
# Check timing order
# ------------------------------------------------------------

print()
print("=" * 100)
print("SUMMARY")
print("=" * 100)

print(f"Whisper words: {len(words)}")
print(f"Lyric lines:   {len(lyrics)}")
print(f"Matched lines: {len(results)}")

for i in range(1, len(results)):
    if results[i]["start"] < results[i - 1]["end"]:
        print(
            f"WARNING: overlap between lines "
            f"{results[i - 1]['lyric_index'] + 1} and "
            f"{results[i]['lyric_index'] + 1}"
        )


# ------------------------------------------------------------
# Save preview
# ------------------------------------------------------------

output = CORPUS / "lyric_timings.json"

with open(output, "w", encoding="utf-8") as f:
    json.dump(
        results,
        f,
        ensure_ascii=False,
        indent=2
    )

print()
print(f"Saved timing data to:")
print(output)