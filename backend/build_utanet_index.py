"""
One-time (re-runnable) builder for a local Uta-Net artist name -> artist ID
index.

Uta-Net has no live search API and its search box is JS-driven, but its
artist name index pages (https://www.uta-net.com/name_list/N/) are plain
server-rendered HTML listing every artist filed under a given kana
reading. This script walks all of them once and saves a local JSON index,
so runtime lyric lookups never need to hit a search engine (or Uta-Net's
own search) at all -- just this file, then a couple of direct page fetches.

Usage:
    python build_utanet_index.py

Re-run occasionally (e.g. every few months) to pick up newly added
artists. Takes a couple of minutes -- it's ~46 requests with a polite
delay between them.
"""
import json
import re
import time

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}

# Kana-row index IDs used by uta-net.com/name_list/{N}/
# (0-44 covers あ through を, 70 covers ん).
INDEX_IDS = list(range(0, 45)) + [70]

OUTPUT_FILE = "utanet_index.json"


def fetch_index_page(index_id):
    url = f"https://www.uta-net.com/name_list/{index_id}/"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.text


def parse_artists(html):
    soup = BeautifulSoup(html, "html.parser")
    artists = {}

    for a in soup.select('a[href^="/artist/"]'):
        href = a.get("href", "")
        match = re.match(r"^/artist/(\d+)/?$", href)
        if not match:
            continue

        name = a.get_text(strip=True)
        if not name:
            continue

        artists[name] = match.group(1)

    return artists


def build_index():
    full_index = {}

    for index_id in INDEX_IDS:
        print(f"Fetching name_list/{index_id}/ ...")
        try:
            html = fetch_index_page(index_id)
        except requests.RequestException as e:
            print(f"  failed: {e}")
            continue

        artists = parse_artists(html)
        print(f"  found {len(artists)} artists")
        full_index.update(artists)

        time.sleep(1)  # be polite to uta-net.com

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(full_index, f, ensure_ascii=False, indent=2)

    print(f"\nSaved {len(full_index)} total artists to {OUTPUT_FILE}")


if __name__ == "__main__":
    build_index()