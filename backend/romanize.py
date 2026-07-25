from pykakasi import kakasi

kks = kakasi()


def romanize_japanese(text):
    result = kks.convert(text)

    words = []

    for item in result:
        words.append(item["hepburn"])

    return " ".join(words)