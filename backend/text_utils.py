import re
import unicodedata
from difflib import SequenceMatcher

from pykakasi import kakasi

kks = kakasi()


def to_romaji(text):
    result = kks.convert(text)
    return "".join(item["hepburn"] for item in result).lower()


def normalize(text):
    return "".join(c for c in text.lower() if c.isalnum())


def normalize_japanese(text):
    return "".join(c for c in text if c.isalnum())


def normalize_whisper(text):
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[【】「」『』、。！？,.!?…・\s]", "", text)
    return text


def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()


def text_similarity(a, b):
    if not a or not b:
        return 0.0

    jp_a = normalize_japanese(a)
    jp_b = normalize_japanese(b)
    jp_score = similarity(jp_a, jp_b)

    romaji_a = normalize(to_romaji(a))
    romaji_b = normalize(to_romaji(b))
    romaji_score = similarity(romaji_a, romaji_b)

    return max(jp_score, romaji_score)
