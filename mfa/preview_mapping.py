import json
from pathlib import Path

CORPUS = Path(r"C:\Users\jaspe\mfa-corpus")
WHISPER = CORPUS / "whisper.json"
LYRICS = Path(r"C:\Users\jaspe\Downloads\lyric.txt")

with open(WHISPER, "r", encoding="utf-8") as f:
    whisper = [
        s for s in json.load(f)["segments"]
        if "音楽" not in s["text"]
    ]

lyrics = [
    line.strip()
    for line in LYRICS.read_text(encoding="utf-8").splitlines()
    if line.strip()
]

mapping = [
    [0],
    [1],
    [2, 3],
    [4],
    [5, 6],
    [7],
    [8, 9],
    [10],
    [11, 12],
    [13],

    [14],
    [15],
    [16, 17],
    [18],
    [19],
    [20, 21],
    [22],
    [23],
    [24, 25],
    [26],
    [27, 28],
    [29],
    [30, 31],
    [32],
]

print("=" * 100)
print("PROPOSED MFA MAPPING")
print("=" * 100)

for i, (segment, lyric_indices) in enumerate(zip(whisper, mapping), 1):
    text = " ".join(lyrics[j] for j in lyric_indices)

    print()
    print(f"SEGMENT {i:02d}")
    print(f"Whisper timing: {segment['start']:.2f} -> {segment['end']:.2f}")
    print(f"Whisper text:   {segment['text']}")
    print(f"MFA text:       {text}")
    print(f"Lyric lines:    {lyric_indices}")

print()
print("=" * 100)
print(f"Whisper segments: {len(whisper)}")
print(f"Mapping groups:   {len(mapping)}")
print("=" * 100)