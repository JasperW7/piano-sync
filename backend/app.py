import os
import uuid
import time
import threading

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pretty_midi
import requests as http_requests
from lyrics import get_lyrics as fetch_lyrics, detect_lyrics_language, ensure_romanized
from aligner import align_lyrics_to_audio
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)
@app.before_request
def log_request():
    print(f"[REQUEST] {request.method} {request.path}", flush=True)
UPLOAD_FOLDER = "uploads"
MIDI_FOLDER = os.path.join(UPLOAD_FOLDER, "midi")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MIDI_FOLDER, exist_ok=True)


@app.route("/")
def home():
    return jsonify({"message": "Backend is online"})


@app.route("/uploads/<filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


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
    try:
        notes = parse_midi(path)
        return jsonify({"notes": notes})
    finally:
        os.remove(path)


@app.route("/parse/pdf", methods=["POST"])
def parse_pdf():
    return jsonify({
        "error": "PDF parsing is temporarily unavailable in the online version."
    }), 501


# ── Song identification (audd.io) ──
AUDD_API_TOKEN = os.getenv("AUDD_API_TOKEN")


@app.route("/identify-song", methods=["POST"])
def identify_song():
    if not AUDD_API_TOKEN:
        return jsonify({"error": "AUDD_API_TOKEN not configured"}), 500

    file = request.files["file"]
    filename = f"identify_{uuid.uuid4().hex}.mp3"
    path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(path)

    try:
        with open(path, "rb") as f:
            resp = http_requests.post(
                "https://api.audd.io/",
                data={"api_token": AUDD_API_TOKEN, "return": "apple_music,spotify"},
                files={"file": f},
                timeout=30,
            )

        data = resp.json()

        if data.get("status") == "error":
            return jsonify({"error": data.get("error", {}).get("error_message", "audd.io error")}), 500

        result = data.get("result")
        if not result:
            return jsonify({"error": "No match found"}), 404

        return jsonify({
            "title": result.get("title", ""),
            "artist": result.get("artist", ""),
        })

    except Exception as e:
        return jsonify({"error": f"Identification failed: {str(e)}"}), 500
    finally:
        os.remove(path)


# ── Lyrics ──
@app.route("/lyrics", methods=["POST"])
def get_lyrics_route():
    data = request.json
    lyrics_text = data.get("lyrics_text")

    if lyrics_text:
        detected = detect_lyrics_language(lyrics_text)
        romaji = lyrics_text if detected == "romaji" else ensure_romanized(lyrics_text)
        return jsonify({
            "title": data.get("title", ""),
            "artist": data.get("artist", ""),
            "lyrics": romaji,
            "lyrics_original": lyrics_text if detected == "japanese" else None,
            "detected_language": detected,
        })

    title = data.get("title")
    artist = data.get("artist")
    if not title or not artist:
        return jsonify({"error": "title and artist are required (or provide lyrics_text)"}), 400

    print(f"Searching lyrics for: {title} — {artist}")
    lyrics = fetch_lyrics(title, artist)

    if lyrics is None:
        return jsonify({"error": "Lyrics not found"}), 404

    return jsonify({
        "title": title,
        "artist": artist,
        "lyrics": lyrics,
        "lyrics_original": None,
        "detected_language": "romaji",
    })


# ── Synced lyrics (MFA alignment with Whisper fallback) ──
@app.route("/lyrics/synced", methods=["POST"])
def get_synced_lyrics():
    data = request.json
    audio_file = data.get("audio_file")

    if not audio_file:
        return jsonify({"error": "audio_file is required"}), 400

    audio_path = os.path.join(UPLOAD_FOLDER, audio_file)
    if not os.path.exists(audio_path):
        return jsonify({"error": "Audio file not found"}), 404

    lyrics_text = data.get("lyrics_text")

    if lyrics_text:
        lyrics_for_align = lyrics_text
    else:
        title = data.get("title")
        artist = data.get("artist")
        if not title or not artist:
            return jsonify({"error": "title and artist required (or provide lyrics_text)"}), 400

        print(f"Fetching lyrics for: {title} — {artist}")
        lyrics_for_align = fetch_lyrics(title, artist)
        if lyrics_for_align is None:
            return jsonify({"error": "Lyrics not found"}), 404

    print(f"Aligning lyrics to audio: {audio_file}")
    aligned = align_lyrics_to_audio(lyrics_for_align, audio_path)
    return jsonify({
        "title": data.get("title", ""),
        "artist": data.get("artist", ""),
        "lines": aligned,
        "alignment_method": "forced_align",
    })


def cleanup_uploads():
    max_age = 3600
    while True:
        now = time.time()
        for root, dirs, files in os.walk(UPLOAD_FOLDER):
            for fname in files:
                fpath = os.path.join(root, fname)
                try:
                    if now - os.path.getmtime(fpath) > max_age:
                        os.remove(fpath)
                except OSError:
                    pass
        time.sleep(1800)


threading.Thread(target=cleanup_uploads, daemon=True).start()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )