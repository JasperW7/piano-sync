import os
import uuid
import time
import hmac
import hashlib
import base64

from flask import Flask, request, jsonify
from flask_cors import CORS
import pretty_midi
import requests
from lyrics import get_lyrics as fetch_lyrics
from dotenv import load_dotenv

load_dotenv()

# ── ACRCloud config ──
ACR_HOST = os.getenv("ACR_HOST")          # e.g. identify-us-west-2.acrcloud.com
ACR_ACCESS_KEY = os.getenv("ACR_ACCESS_KEY")
ACR_ACCESS_SECRET = os.getenv("ACR_ACCESS_SECRET")

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = "uploads"
MIDI_FOLDER = os.path.join(UPLOAD_FOLDER, "midi")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MIDI_FOLDER, exist_ok=True)


@app.route("/")
def home():
    return jsonify({"message": "Backend is online"})


# ── MP3 upload ──
@app.route("/upload/audio", methods=["POST"])
def upload_audio():
    file = request.files["file"]
    filename = f"audio_{uuid.uuid4().hex}.mp3"
    path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(path)
    return {"message": "audio saved", "file": filename}


# ── MIDI upload ──
@app.route("/upload/midi", methods=["POST"])
def upload_midi():
    file = request.files["file"]
    filename = f"midi_{uuid.uuid4().hex}.mid"
    path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(path)
    return {"message": "midi saved", "file": filename}


# ── MIDI parser (unchanged) ──
def parse_midi(file_path):
    midi = pretty_midi.PrettyMIDI(file_path)
    notes = []
    piano_instruments = [inst for inst in midi.instruments if not inst.is_drum]

    if len(piano_instruments) >= 2:
        avg_pitches = []
        for inst in piano_instruments:
            if inst.notes:
                avg_pitches.append(sum(n.pitch for n in inst.notes) / len(inst.notes))
            else:
                avg_pitches.append(60)

        right_idx = avg_pitches.index(max(avg_pitches))

        for i, instrument in enumerate(piano_instruments):
            hand = "right" if i == right_idx else "left"
            for note in instrument.notes:
                notes.append({
                    "note": note.pitch,
                    "start": note.start,
                    "duration": note.end - note.start,
                    "velocity": note.velocity,
                    "hand": hand,
                    "track": i
                })
    elif len(piano_instruments) == 1:
        for note in piano_instruments[0].notes:
            hand = "right" if note.pitch >= 60 else "left"
            notes.append({
                "note": note.pitch,
                "start": note.start,
                "duration": note.end - note.start,
                "velocity": note.velocity,
                "hand": hand,
                "track": 0
            })

    notes.sort(key=lambda n: n["start"])
    return notes


@app.route("/parse/midi", methods=["POST"])
def parse_midi_route():
    file = request.files["file"]
    filename = f"{uuid.uuid4().hex}.mid"
    path = os.path.join(MIDI_FOLDER, filename)
    file.save(path)
    notes = parse_midi(path)
    return jsonify({"notes": notes})


@app.route("/parse/pdf", methods=["POST"])
def parse_pdf():
    return jsonify({
        "error": "PDF parsing is temporarily unavailable in the online version."
    }), 501


# ── ACRCloud signature helper ──
def _acr_sign(method, endpoint, access_key, data_type, signature_version, timestamp, access_secret):
    string_to_sign = (
        f"{method}\n{endpoint}\n{access_key}\n{data_type}\n{signature_version}\n{timestamp}"
    )
    sign = hmac.new(
        access_secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha1
    ).digest()
    return base64.b64encode(sign).decode("utf-8")


# ── Song identification (ACRCloud) ──
@app.route("/identify-song", methods=["POST"])
def identify_song():
    if not all([ACR_HOST, ACR_ACCESS_KEY, ACR_ACCESS_SECRET]):
        return jsonify({"error": "ACRCloud credentials not configured"}), 500

    file = request.files["file"]
    file_bytes = file.read()

    method = "POST"
    endpoint = "/v1/identify"
    data_type = "audio"
    signature_version = "1"
    timestamp = str(int(time.time()))

    signature = _acr_sign(
        method, endpoint, ACR_ACCESS_KEY, data_type,
        signature_version, timestamp, ACR_ACCESS_SECRET
    )

    url = f"https://{ACR_HOST}{endpoint}"

    data = {
        "access_key": ACR_ACCESS_KEY,
        "sample_bytes": len(file_bytes),
        "timestamp": timestamp,
        "signature": signature,
        "data_type": data_type,
        "signature_version": signature_version,
    }

    files = {"sample": ("sample", file_bytes, file.mimetype or "audio/mpeg")}

    try:
        response = requests.post(url, data=data, files=files, timeout=30)
        result = response.json()
    except Exception as e:
        return jsonify({"error": f"ACRCloud request failed: {str(e)}"}), 500

    # Normalize response
    status = result.get("status", {})
    if status.get("code") != 0:
        return jsonify({
            "error": status.get("msg", "Recognition failed"),
            "raw": result
        }), 404

    metadata = result.get("metadata", {})
    music_list = metadata.get("music", [])
    if not music_list:
        return jsonify({"error": "No match found", "raw": result}), 404

    track = music_list[0]
    artists = track.get("artists", [])
    genres = track.get("genres", [])

    return jsonify({
        "title": track.get("title", ""),
        "artist": artists[0].get("name", "") if artists else "",
        "album": track.get("album", {}).get("name", ""),
        "release_date": track.get("release_date", ""),
        "label": track.get("label", ""),
        "genre": genres[0].get("name", "") if genres else "",
        "acrid": track.get("acrid", ""),
        "raw": result
    })


# ── Lyrics (unchanged) ──
@app.route("/lyrics", methods=["POST"])
def get_lyrics_route():
    data = request.json
    title = data["title"]
    artist = data["artist"]

    print(f"Searching lyrics for: {title} — {artist}")
    lyrics = fetch_lyrics(title, artist)

    if lyrics is None:
        return jsonify({"error": "Lyrics not found"}), 404

    return jsonify({
        "title": title,
        "artist": artist,
        "lyrics": lyrics
    })


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )