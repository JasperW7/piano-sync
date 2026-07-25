import os
import requests
import re
import unicodedata
from dotenv import load_dotenv
from bs4 import BeautifulSoup
load_dotenv()

GENIUS_TOKEN = os.getenv("GENIUS_TOKEN")
PREFER_ROMANIZED=True
PREFERRED_TAGS = [
    "romanized"
]
BAD_TAGS = [
    "english translation",
    "translation",
    "русский",
    "español",
    "espanol",
    "translated",
    "remix",
]

def scrape_genius(url):
    html = requests.get(url).text

    soup = BeautifulSoup(html, "html.parser")

    lyrics = []

    containers = soup.select('div[data-lyrics-container="true"]')

    for container in containers:
        lyrics.append(container.get_text("\n"))

    return "\n".join(lyrics).strip()

def search_genius(title, artist):
    query = f"{title} {artist}"

    url = "https://api.genius.com/search"

    headers = {
        "Authorization": f"Bearer {GENIUS_TOKEN}"
    }

    params = {
        "q": query
    }

    response = requests.get(url, headers=headers, params=params)

    if response.status_code != 200:
        print("Genius request failed.")
        return None

    data = response.json()


    hits = data["response"]["hits"]


    if not hits:
        return None

    def normalize(text):
        text = unicodedata.normalize("NFKC", text)
        text = text.casefold()

        # Remove spaces and punctuation but KEEP Japanese/Korean/etc.
        return re.sub(r"[^\w]", "", text, flags=re.UNICODE)


    target_title = normalize(title)
    target_artist = normalize(artist)

    best = None
    best_score = float("-inf")

    for i, hit in enumerate(hits):
        result = hit["result"]

        print(result["title"])
        print(result["primary_artist"]["name"])
    for hit in hits:
        result = hit["result"]
                

        raw_title = result["title"]
        raw_artist = result["primary_artist"]["name"]

        genius_title = normalize(raw_title)
        genius_artist = normalize(raw_artist)

        score = 0

        # Artist match
        if genius_artist == target_artist:
            score += 100

        elif target_artist in genius_artist:
            score += 75

        elif genius_artist in target_artist:
            score += 75

        # Genius Romanizations pages use "Genius Romanizations"
        # as the artist, but the real artist is in the title
        if "geniusromanizations" in genius_artist:
            combined_title = normalize(raw_title)

            if target_artist in combined_title:
                score += 100


        # Title match
        if genius_title == target_title:
            score += 40

        elif target_title in genius_title:
            score += 30

        elif genius_title in target_title:
            score += 30


        # General artist-in-title check
        combined = normalize(raw_title + " " + raw_artist)

        if target_artist in combined:
            score += 20


        lower_title = raw_title.lower()


        # Prefer romanized versions
        if PREFER_ROMANIZED and "romanized" in lower_title:
            score += 40


        # Penalize translations/remixes
        for tag in BAD_TAGS:
            if tag in lower_title:
                score -= 80


        print(f"{score:>4} | {raw_artist} | {raw_title}")


        if score > best_score:
            best_score = score
            best = result


    if best is None or best_score <= 0:
        return None


    print("\nSelected:")
    print(best["title"])
    print(best["primary_artist"]["name"])
    print(best["url"])

    return scrape_genius(best["url"])

def search_lrclib(title, artist):
    url = "https://lrclib.net/api/get"

    params = {
        "track_name": title,
        "artist_name": artist
    }

    response = requests.get(url, params=params)

    if response.status_code != 200:
        return None

    data = response.json()

    return (
        data.get("syncedLyrics")
        or data.get("plainLyrics")
    )
def get_lyrics(title, artist):
    lyrics = search_genius(title, artist)
    if lyrics:
        return lyrics

    lyrics = search_lrclib(title, artist)
    if lyrics:
        return lyrics

    return None