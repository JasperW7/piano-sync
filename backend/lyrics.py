import json
import os
import re
import unicodedata
from difflib import SequenceMatcher

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from romanize import romanize_japanese

load_dotenv()

GENIUS_TOKEN = os.getenv("GENIUS_TOKEN")
PREFER_ROMANIZED = True
BAD_TAGS = [
    "english translation", "translation", "русский",
    "español", "espanol", "translated", "remix",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}

VERBOSE = os.getenv("LYRICS_VERBOSE", "false").lower() == "true"

UTANET_INDEX_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "utanet_index.json"
)


def _v(msg):
    if VERBOSE:
        print(f"[lyrics] {msg}")


def _normalize(text):
    text = unicodedata.normalize("NFKC", text)
    text = text.casefold()
    return re.sub(r"[^\w]", "", text, flags=re.UNICODE)


def _clean_title_for_search(title: str) -> str:
    title = re.sub(r"\s*\(feat\..*?\)", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\(with\s+.*?\)", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\[.*?\]", "", title)
    title = re.sub(r"\s*-\s*.*?(remix|version|edit|mix)$", "", title, flags=re.IGNORECASE)
    return title.strip()


def _clean_web_text(text):
    text = text.replace("\u3000", " ").replace("\u200b", "")
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)


# ── Romanization safety net ──
# Matches hiragana, katakana, and CJK ideographs (kanji).
_CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def _is_mostly_romanized(text, threshold=0.15):
    if not text:
        return True
    cjk_chars = len(_CJK_RE.findall(text))
    return (cjk_chars / max(len(text), 1)) < threshold


def ensure_romanized(text):
    """Final safety net applied to whatever source matched: if the
    returned lyrics are still substantially in Japanese script,
    romanize them locally (pykakasi) line by line so structure is
    preserved. If a source already returned romaji (a Genius
    "Romanized" page, e.g.), this is a no-op."""
    if _is_mostly_romanized(text):
        return text

    lines = text.splitlines()
    romanized_lines = [
        romanize_japanese(line) if line.strip() else line
        for line in lines
    ]
    return "\n".join(romanized_lines)


# ═══════════════════════════════════════════════════════════════════
# 1. GENIUS — official API, preferring romanized ("romaji") pages
# ═══════════════════════════════════════════════════════════════════
def scrape_genius(url):
    html = requests.get(url, headers=HEADERS, timeout=10).text
    soup = BeautifulSoup(html, "html.parser")
    lyrics = []
    for container in soup.select('div[data-lyrics-container="true"]'):
        lyrics.append(container.get_text("\n"))
    return "\n".join(lyrics).strip()


def _search_genius_raw(title, artist, require_title_match=True):
    """Search Genius and return the best-matching result dict (or None).
    Separated from scraping so we can use Genius as a title-resolution
    step without committing to its lyrics. When require_title_match is
    False (used for title resolution), accept results with only artist
    match -- the caller is explicitly looking for what Genius thinks
    the real title is."""
    if not GENIUS_TOKEN:
        _v("No GENIUS_TOKEN, skipping Genius")
        return None

    query = f"{title} {artist}"
    url = "https://api.genius.com/search"
    headers = {"Authorization": f"Bearer {GENIUS_TOKEN}"}
    params = {"q": query}

    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        if response.status_code != 200:
            _v(f"Genius HTTP {response.status_code}")
            return None
        data = response.json()
    except Exception as e:
        _v(f"Genius error: {e}")
        return None

    hits = data.get("response", {}).get("hits", [])
    if not hits:
        _v("Genius: no hits")
        return None

    target_title = _normalize(title)
    target_artist = _normalize(artist)

    best = None
    best_score = float("-inf")
    best_has_title_match = False

    for hit in hits:
        result = hit["result"]
        raw_title = result["title"]
        raw_artist = result["primary_artist"]["name"]
        genius_title = _normalize(raw_title)
        genius_artist = _normalize(raw_artist)

        score = 0
        title_matched = False

        if genius_artist == target_artist:
            score += 100
        elif target_artist in genius_artist or genius_artist in target_artist:
            score += 75

        if "geniusromanizations" in genius_artist:
            if target_artist in _normalize(raw_title):
                score += 100

        genius_title_romanized = _normalize(romanize_japanese(raw_title))
        title_variants = [genius_title, genius_title_romanized]

        for variant in title_variants:
            if variant == target_title:
                score += 40
                title_matched = True
                break
            elif target_title in variant or variant in target_title:
                score += 30
                title_matched = True
                break
        else:
            best_sim = max(
                SequenceMatcher(None, target_title, v).ratio()
                for v in title_variants
            )
            if best_sim >= 0.6:
                score += int(best_sim * 40)
                title_matched = True

        combined = _normalize(raw_title + " " + raw_artist)
        if target_artist in combined:
            score += 20

        lower_title = raw_title.lower()
        if PREFER_ROMANIZED and "romanized" in lower_title:
            score += 40
        for tag in BAD_TAGS:
            if tag in lower_title:
                score -= 80

        if score > best_score:
            best_score = score
            best = result
            best_has_title_match = title_matched

    if best is None or best_score <= 0:
        _v("Genius: no good match")
        return None

    if require_title_match and not best_has_title_match:
        _v(f"Genius: best result '{best['title']}' has no title relevance, skipping")
        return None

    _v(f"Genius match: {best['title']} — {best['primary_artist']['name']}")
    return best


def search_genius(title, artist):
    best = _search_genius_raw(title, artist)
    if not best:
        return None
    lyrics = scrape_genius(best["url"])
    return lyrics or None


# ═══════════════════════════════════════════════════════════════════
# 2. VOCALOID LYRICS WIKI (Miraheze) — official MediaWiki search API,
#    no scraping/search-engine dependency at all
# ═══════════════════════════════════════════════════════════════════
MIRAHEZE_API = "https://vocaloidlyrics.miraheze.org/w/api.php"
MIRAHEZE_WIKI_BASE = "https://vocaloidlyrics.miraheze.org/wiki/"
MIRAHEZE_SEARCH_URL = "https://vocaloidlyrics.miraheze.org/index.php"

# A fuller, more browser-like header set for Miraheze specifically --
# its Cloudflare layer appears to block the official MediaWiki API
# (403 on /w/api.php) even with a normal User-Agent, which points to
# TLS/request-fingerprint-based bot protection rather than a missing
# header. These extra headers are a cheap thing to try first; the
# fallback below (scraping the human-facing search page instead of
# the API) is the real safety net if the API stays blocked.
_MIRAHEZE_HEADERS = {
    **HEADERS,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://vocaloidlyrics.miraheze.org/",
}


try:
    from curl_cffi import requests as cf_requests
    _HAS_CURL_CFFI = True
except ImportError:
    _HAS_CURL_CFFI = False


def _miraheze_get(url, params=None):
    """Miraheze's Cloudflare layer returns 403 on plain `requests`
    calls regardless of headers -- both /w/api.php and the
    human-facing search page are blocked identically, which points to
    TLS/request-fingerprint-based bot protection rather than anything
    fixable with headers alone. curl_cffi impersonates a real Chrome
    TLS handshake at the network level, which plain `requests` can't
    do. Falls back to plain requests (which will likely still 403) if
    curl_cffi isn't installed, so this doesn't hard-crash without it."""
    if _HAS_CURL_CFFI:
        return cf_requests.get(
            url, params=params, headers=_MIRAHEZE_HEADERS,
            impersonate="chrome124", timeout=10,
        )

    _v("curl_cffi not installed -- run `pip install curl_cffi` for Miraheze to work")
    return requests.get(url, params=params, headers=_MIRAHEZE_HEADERS, timeout=10)


def search_vocaloid_lyrics(title, artist):
    query = f"{title} {artist}"
    page_titles = _miraheze_api_search(query)

    if not page_titles:
        _v("Miraheze API unavailable/empty, falling back to Special:Search")
        page_titles = _miraheze_html_search(query)

    target_title = _normalize(title)
    target_artist = _normalize(artist)

    for page_title in page_titles:
        norm_page = _normalize(page_title)

        title_score = SequenceMatcher(None, target_title, norm_page).ratio()
        artist_in_page = target_artist in norm_page
        title_in_page = target_title in norm_page

        if title_in_page:
            title_score = max(title_score, 0.85)
        if artist_in_page:
            title_score += 0.15

        if title_score < 0.5:
            _v(f"Miraheze: skipping '{page_title}' (score {title_score:.2f})")
            continue

        page_url = MIRAHEZE_WIKI_BASE + page_title.replace(" ", "_")

        try:
            resp = _miraheze_get(page_url)
            if resp.status_code != 200:
                _v(f"Miraheze page HTTP {resp.status_code}: {page_url}")
                continue
        except Exception as e:
            _v(f"Miraheze page fetch error: {e}")
            continue

        lyrics = _extract_miraheze_lyrics(resp.text, prefer_romaji=True)
        if lyrics:
            _v(f"Miraheze match (score {title_score:.2f}): {page_url}")
            return lyrics

    return None


def _miraheze_api_search(query):
    """Official MediaWiki search API. Fast and precise when it isn't
    blocked, but Miraheze's Cloudflare layer has been observed
    returning 403 on /w/api.php regardless of headers."""
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": 5,
        "format": "json",
    }

    try:
        resp = _miraheze_get(MIRAHEZE_API, params=params)
        if resp.status_code != 200:
            _v(f"Miraheze API HTTP {resp.status_code}")
            return []
        data = resp.json()
    except Exception as e:
        _v(f"Miraheze API error: {e}")
        return []

    hits = data.get("query", {}).get("search", [])
    if not hits:
        _v("Miraheze API: no hits")
        return []

    return [hit["title"] for hit in hits]


def _miraheze_html_search(query):
    """Fallback for when the API itself is blocked: scrapes the
    normal, human-facing search results page instead. This goes
    through a different URL path than /w/api.php, so it may not be
    subject to the same WAF rule even if the API consistently is."""
    params = {"search": query, "fulltext": "1"}

    try:
        resp = _miraheze_get(MIRAHEZE_SEARCH_URL, params=params)
        if resp.status_code != 200:
            _v(f"Miraheze Special:Search HTTP {resp.status_code}")
            return []
    except Exception as e:
        _v(f"Miraheze Special:Search error: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    titles = []

    for link in soup.select(".mw-search-result-heading a[href^='/wiki/']"):
        href = link.get("href", "")
        page_title = href.split("/wiki/", 1)[-1].replace("_", " ")
        page_title = requests.utils.unquote(page_title)
        if page_title and page_title not in titles:
            titles.append(page_title)

    _v(f"Miraheze Special:Search found {len(titles)} results")
    return titles


def _extract_miraheze_lyrics(html, prefer_romaji=False):
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        if not rows:
            continue

        header_row = rows[0]
        header_cells = header_row.find_all(["th", "td"])
        if not header_cells:
            continue

        col_map = {}
        for idx, cell in enumerate(header_cells):
            txt = cell.get_text(strip=True).lower()
            if "romaji" in txt or "romanization" in txt:
                col_map["romaji"] = idx
            elif "japanese" in txt or "日本語" in txt:
                col_map["japanese"] = idx
            elif "english" in txt or "英語" in txt:
                col_map["english"] = idx

        if prefer_romaji and "romaji" in col_map:
            target_idx = col_map["romaji"]
        elif "japanese" in col_map:
            target_idx = col_map["japanese"]
        elif "english" in col_map:
            target_idx = col_map["english"]
        else:
            continue

        lines = []
        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) > target_idx:
                text = cells[target_idx].get_text("\n", strip=True)
                if text and text != "<br />":
                    lines.append(text)

        if lines and len(lines) >= 3:
            result = "\n".join(lines).strip()
            src = "romaji" if prefer_romaji and "romaji" in col_map else "lyrics"
            _v(f"Miraheze: extracted {src} from table")
            return result

    for h in soup.find_all(["h2", "h3", "h4"]):
        txt = h.get_text(strip=True).lower()
        if prefer_romaji and ("romaji" in txt or "romanization" in txt):
            lines = []
            current = h.find_next_sibling()
            heading_rank = int(h.name[1])
            while current:
                if current.name in ["h2", "h3", "h4"]:
                    if int(current.name[1]) <= heading_rank:
                        break
                text = current.get_text("\n", strip=True)
                if text:
                    lines.append(text)
                current = current.find_next_sibling()
            result = "\n".join(lines).strip()
            if len(result) > 30:
                _v("Miraheze: extracted romaji via heading")
                return result
        elif "lyrics" in txt:
            lines = []
            current = h.find_next_sibling()
            heading_rank = int(h.name[1])
            while current:
                if current.name in ["h2", "h3", "h4"]:
                    if int(current.name[1]) <= heading_rank:
                        break
                text = current.get_text("\n", strip=True)
                if text:
                    lines.append(text)
                current = current.find_next_sibling()
            result = "\n".join(lines).strip()
            if len(result) > 30:
                _v("Miraheze: extracted lyrics via heading")
                return result

    return None


# ═══════════════════════════════════════════════════════════════════
# 3. LYRICAL NONSENSE / UTATIME — direct artist+song URL guessing,
#    no search engine or account-gated API involved
# ═══════════════════════════════════════════════════════════════════
# Lyrical-nonsense.com rebranded to UtaTime in 2026; the old domain
# now redirects (301) to utatime.com, same team/site, same URL shape:
# /global/lyrics/{artist-slug}/{song-slug}/. Romaji, original-script,
# and translation are separate anchored panels on the same song page
# (#Romaji / #Original / #Translations), which in the rendered HTML
# correspond to element ids of the same names -- so those ids are
# used directly as CSS selectors rather than trying to fuzzy-match
# headings.
LN_BASE = "https://www.utatime.com"
LN_ARTIST_DIR = LN_BASE + "/global/lyrics/"


def _slugify_ln(text):
    """Best-effort mirror of UtaTime's own artist/song slugs, e.g.
    '&AUDITION' -> 'and-audition', 'GO GHOST' -> 'go-ghost'."""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("&", " and ")
    text = text.lower()
    text = re.sub(r"[’']", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _ln_get(url, params=None):
    try:
        return requests.get(url, headers=HEADERS, params=params, timeout=10)
    except Exception as e:
        _v(f"UtaTime fetch error: {e}")
        return None


def _find_ln_artist_page(artist):
    """No live search endpoint is used here -- just guess the slug
    directly (UtaTime's slugs are a predictable function of the
    artist name) and confirm the resulting page really is that
    artist's directory before trusting it."""
    candidates = [_slugify_ln(artist)]

    # A couple of cheap alternate guesses for common mismatches
    # (a leading "the", stray punctuation already stripped above).
    stripped = re.sub(r"^the-", "", candidates[0])
    if stripped != candidates[0]:
        candidates.append(stripped)

    target = _normalize(artist)

    for slug in candidates:
        if not slug:
            continue
        url = LN_ARTIST_DIR + slug + "/"
        resp = _ln_get(url)
        if resp is None or resp.status_code != 200:
            _v(f"UtaTime artist page miss ({resp.status_code if resp else 'error'}): {url}")
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        heading = soup.find("h2") or soup.find("h1")
        page_name = heading.get_text(strip=True) if heading else ""

        if _normalize(page_name) == target or SequenceMatcher(
            None, target, _normalize(page_name)
        ).ratio() >= 0.75:
            _v(f"UtaTime artist match: '{page_name}' -> {url}")
            return url, soup

        _v(f"UtaTime artist page didn't match ('{page_name}' vs '{artist}'): {url}")

    return None, None


def _find_ln_song(artist_page_url, artist_soup, title):
    target = _normalize(title)
    slug_prefix = artist_page_url.rstrip("/").rsplit("/global/lyrics/", 1)[-1]

    candidates = []
    for link in artist_soup.select(f"a[href*='/global/lyrics/{slug_prefix}/']"):
        href = link.get("href", "")
        if not re.search(rf"/global/lyrics/{re.escape(slug_prefix)}/[^/]+/?$", href):
            continue

        song_title = link.get_text(strip=True)
        norm_song = _normalize(song_title)
        score = SequenceMatcher(None, target, norm_song).ratio()

        if target and norm_song and (target in norm_song or norm_song in target):
            shorter = min(len(target), len(norm_song))
            longer = max(len(target), len(norm_song))
            if longer and shorter / longer >= 0.5:
                score = max(score, 0.9)

        # Also match against the URL slug, which is often the English
        # or romanized title (e.g. "fureteitai-dake" for 触れていたいだけ,
        # or "just-want-to-touch"). This bridges the gap when the user
        # searches by English translation but the link text is Japanese.
        song_slug = href.rstrip("/").rsplit("/", 1)[-1]
        norm_slug = _normalize(song_slug.replace("-", ""))
        slug_score = SequenceMatcher(None, target, norm_slug).ratio()
        if target and norm_slug and (target in norm_slug or norm_slug in target):
            shorter = min(len(target), len(norm_slug))
            longer = max(len(target), len(norm_slug))
            if longer and shorter / longer >= 0.4:
                slug_score = max(slug_score, 0.9)
        score = max(score, slug_score)

        # Check surrounding row context (adjacent text, tooltips) for
        # English translations that some pages include alongside the
        # Japanese title.
        row = link.find_parent("tr") or link.find_parent("li") or link.parent
        if row:
            row_text = _normalize(row.get_text(" ", strip=True))
            if target in row_text:
                score = max(score, 0.88)

        full_url = href if href.startswith("http") else LN_BASE + href
        candidates.append((score, song_title, full_url))

    if not candidates:
        _v("UtaTime: no song links found on artist page")
        return None

    candidates.sort(key=lambda c: c[0], reverse=True)
    best_score, best_title, best_url = candidates[0]
    _v(f"UtaTime best song candidate: '{best_title}' (score {best_score:.2f})")

    if best_score >= 0.75:
        return best_url

    return None


def _extract_ln_lyrics(html):
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer", "form"]):
        tag.decompose()

    # Romaji panel first (this is the whole point for this pipeline);
    # fall back to the original-script panel and let ensure_romanized()
    # handle it locally if a song has no romaji transcription yet.
    for selector in ["#Romaji", "#Original"]:
        el = soup.select_one(selector)
        if el:
            text = _clean_web_text(el.get_text("\n"))
            if len(text) > 30:
                _v(f"UtaTime: extracted lyrics via {selector}")
                return text

    return None


def search_lyrical_nonsense(title, artist):
    """Uses UtaTime's (formerly lyrical-nonsense.com) predictable
    artist/song URL slugs to go straight to a song's lyric page --
    no search box or search API involved. Good general-purpose JP/anime
    coverage with clean, community-transcribed romaji."""
    artist_url, artist_soup = _find_ln_artist_page(artist)
    if not artist_url:
        _v(f"UtaTime: no artist match for '{artist}'")
        return None

    song_url = _find_ln_song(artist_url, artist_soup, title)
    if not song_url:
        _v(f"UtaTime: no song match for '{title}' on {artist_url}")
        return None

    resp = _ln_get(song_url)
    if resp is None or resp.status_code != 200:
        _v(f"UtaTime song page fetch failed: {song_url}")
        return None

    text = _extract_ln_lyrics(resp.text)
    if not text:
        _v(f"UtaTime: no lyrics extracted from {song_url}")
        return None

    _v(f"UtaTime match: {song_url}")
    return text


# ═══════════════════════════════════════════════════════════════════
# 4. UTA-NET — local artist-name index (built by build_utanet_index.py)
#    + direct page scrapes. No search engine, no live Uta-Net search.
# ═══════════════════════════════════════════════════════════════════
_utanet_index_cache = None


def _load_utanet_index():
    global _utanet_index_cache

    if _utanet_index_cache is not None:
        return _utanet_index_cache

    if not os.path.exists(UTANET_INDEX_PATH):
        _v(
            "utanet_index.json not found — run "
            "`python build_utanet_index.py` once to enable Uta-Net."
        )
        _utanet_index_cache = {}
        return _utanet_index_cache

    with open(UTANET_INDEX_PATH, encoding="utf-8") as f:
        _utanet_index_cache = json.load(f)

    _v(f"Loaded Uta-Net index: {len(_utanet_index_cache)} artists")
    return _utanet_index_cache


def _match_utanet_artist(artist, index):
    if artist in index:
        return artist, index[artist]

    target = _normalize(artist)
    if not target:
        return None, None

    best_name = None
    best_id = None
    best_score = 0.0

    for name, artist_id in index.items():
        norm_name = _normalize(name)
        if norm_name == target:
            return name, artist_id

        similarity = SequenceMatcher(None, target, norm_name).ratio()

        # A substring match on a short name can be a coincidence, so
        # only let containment count as strong evidence when the
        # shorter string is a reasonably large fraction of the longer
        # one (avoids e.g. a 2-character reading matching everything).
        if target in norm_name or norm_name in target:
            shorter = min(len(target), len(norm_name))
            longer = max(len(target), len(norm_name))
            if longer and shorter / longer >= 0.6:
                similarity = max(similarity, 0.85)

        if similarity > best_score:
            best_score = similarity
            best_name = name
            best_id = artist_id

    if best_score >= 0.8:
        return best_name, best_id

    return None, None


def _find_utanet_song(artist_id, title, artist, max_pages=5):
    """Uses Uta-Net's English/romanized mirror (uta-net.com/global/en/)
    rather than the Japanese site. Its artist page lists songs as
    "OriginalTitle(romaji_slug)" -- e.g. "独祭民話(dokusaiminwa)" --
    linking to /global/en/lyric/{id}/, which is a much more reliable
    match target than fuzzy-matching Japanese titles, since incoming
    titles (e.g. from Shazam) are usually already romanized."""

    target = _normalize(title)

    for page in range(max_pages):
        url = (
            f"https://www.uta-net.com/global/en/artist/{artist_id}/"
            if page == 0
            else f"https://www.uta-net.com/global/en/artist/{artist_id}/{page * 20}/?sort=release-d"
        )

        try:
            resp = requests.get(url, headers=HEADERS, timeout=10)
            if resp.status_code != 200:
                break
        except Exception as e:
            _v(f"Uta-Net (global) artist page fetch error: {e}")
            break

        soup = BeautifulSoup(resp.text, "html.parser")

        rows = soup.select("table tr")
        candidates = []

        for row in rows:
            link = row.find("a", href=re.compile(r"^/global/en/lyric/\d+/?$"))
            if not link:
                continue

            match = re.match(r"^/global/en/lyric/(\d+)/?$", link["href"])
            if not match:
                continue

            raw_text = link.get_text(strip=True)
            slug_match = re.search(r"\(([^)]+)\)\s*$", raw_text)
            romaji_slug = slug_match.group(1) if slug_match else ""

            song_url = f"https://www.uta-net.com/global/en/lyric/{match.group(1)}/"

            norm_slug = _normalize(romaji_slug)
            norm_raw = _normalize(raw_text)

            slug_score = SequenceMatcher(None, target, norm_slug).ratio()
            raw_score = SequenceMatcher(None, target, norm_raw).ratio()
            score = max(slug_score, raw_score)

            for norm_candidate in (norm_slug, norm_raw):
                if target and norm_candidate and (
                    target in norm_candidate or norm_candidate in target
                ):
                    shorter = min(len(target), len(norm_candidate))
                    longer = max(len(target), len(norm_candidate))
                    if longer and shorter / longer >= 0.2:
                        score = max(score, 0.9)

            # Also check full row text for English translations that
            # may appear in adjacent cells (e.g. "触れていたいだけ /
            # Just want to touch").
            row_text = _normalize(row.get_text(" ", strip=True))
            if target and target in row_text and target not in norm_raw:
                score = max(score, 0.9)

            candidates.append((score, raw_text, song_url))

        if not candidates:
            # No song rows on this page at all -> past the end of the
            # artist's catalog.
            break

        candidates.sort(key=lambda c: c[0], reverse=True)
        best_score, best_title, best_url = candidates[0]

        _v(
            f"Uta-Net (global) best candidate p{page}: '{best_title}' "
            f"(score {best_score:.2f})"
        )

        if best_score >= 0.82:
            return best_url

        # If this page only had a handful of rows, later pages likely
        # have even less relevant / older material -- but still worth
        # trying since sort order may not be by relevance.

    return None


def _extract_utanet_global_lyrics(html):
    """The global/en lyric page renders both tab labels ('Romaji' then
    'Kanji') together, immediately followed by the romaji lyrics block
    and then the kanji block stacked right after it -- with no text
    marker between the two content blocks themselves. So: skip past
    both labels, then walk the remaining lines and stop at the first
    one containing Japanese script -- everything before that boundary
    is the romaji block."""
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer", "form"]):
        tag.decompose()

    full_text = soup.get_text("\n")

    if "Kanji" in full_text:
        after_labels = full_text.split("Kanji", 1)[1]

        romaji_lines = []
        for line in after_labels.splitlines():
            if _CJK_RE.search(line):
                break
            if line.strip():
                romaji_lines.append(line.strip())

        text = "\n".join(romaji_lines)
        if len(text) > 30:
            return text

    # Fallback: some songs may not have a romaji version at all, in
    # which case there's no clean Latin-only run to isolate -- try a
    # couple of common container selectors for whatever lyrics are
    # present, and let the ensure_romanized() safety net handle the
    # rest.
    for selector in ["#kashi_area", ".kashi", "[class*='lyric']"]:
        el = soup.select_one(selector)
        if el:
            text = _clean_web_text(el.get_text("\n"))
            if len(text) > 30:
                return text

    return None


def search_utanet(title, artist):
    """Uta-Net has no live search API and its search box is JS-driven,
    so this instead uses a locally-built artist-name index (see
    build_utanet_index.py) to jump straight to the artist's page on
    Uta-Net's English/romanized mirror (uta-net.com/global/en/), which
    lists songs by their already-romanized slug and links to lyric
    pages that include a plain-text romaji version. No search engine
    involved at any point."""

    index = _load_utanet_index()
    if not index:
        return None

    matched_name, artist_id = _match_utanet_artist(artist, index)
    if not artist_id:
        _v(f"Uta-Net: no artist match for '{artist}' in local index")
        return None

    _v(f"Uta-Net artist match: '{matched_name}' -> /global/en/artist/{artist_id}/")

    song_url = _find_utanet_song(artist_id, title, artist)
    if not song_url:
        _v(f"Uta-Net: no song match for '{title}' on artist page")
        return None

    try:
        resp = requests.get(song_url, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return None
    except Exception as e:
        _v(f"Uta-Net lyric page fetch error: {e}")
        return None

    text = _extract_utanet_global_lyrics(resp.text)
    if not text:
        _v(f"Uta-Net: no lyrics extracted from {song_url}")
        return None

    _v(f"Uta-Net match: {song_url}")
    return text


# ═══════════════════════════════════════════════════════════════════
# Main pipeline: Genius -> Miraheze -> Lyrical Nonsense/UtaTime ->
#                Uta-Net -> romanization safety net
# ═══════════════════════════════════════════════════════════════════
def _try_all_sources(clean_title, artist):
    """Try all lyric sources with the given title. Returns lyrics or None."""
    lyrics = search_genius(clean_title, artist)

    if not lyrics:
        lyrics = search_vocaloid_lyrics(clean_title, artist)

    if not lyrics:
        lyrics = search_lyrical_nonsense(clean_title, artist)

    if not lyrics:
        lyrics = search_utanet(clean_title, artist)

    return lyrics


def get_lyrics(title, artist):
    clean_title = _clean_title_for_search(title)
    _v(f"Clean title: '{clean_title}', artist: '{artist}'")

    lyrics = _try_all_sources(clean_title, artist)

    # If no source matched, use Genius as a title-resolution step:
    # the user may have searched by English translation (e.g. "Just
    # want to touch") while sources store it under the original or
    # romanized title (e.g. "Fureteitai Dake"). Genius often indexes
    # translated titles, so its best match may reveal the real title.
    if not lyrics:
        genius_result = _search_genius_raw(clean_title, artist, require_title_match=False)
        if genius_result:
            # Only trust the resolution if the artist actually matches
            result_artist = _normalize(genius_result["primary_artist"]["name"])
            target_artist = _normalize(artist)
            artist_ok = (
                result_artist == target_artist
                or target_artist in result_artist
                or result_artist in target_artist
            )
            if artist_ok:
                alt_title = genius_result["title"]
                alt_title = re.sub(r"\s*\((?:Romanized|English Translation|[^)]*translation)\)", "", alt_title, flags=re.IGNORECASE)
                alt_clean = _clean_title_for_search(alt_title)
                if _normalize(alt_clean) != _normalize(clean_title):
                    _v(f"Retrying with Genius-resolved title: '{alt_clean}'")
                    lyrics = search_vocaloid_lyrics(alt_clean, artist)
                    if not lyrics:
                        lyrics = search_lyrical_nonsense(alt_clean, artist)
                    if not lyrics:
                        lyrics = search_utanet(alt_clean, artist)

    if not lyrics:
        _v("No lyrics found from any source")
        return None

    return ensure_romanized(lyrics)