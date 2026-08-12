import os
import uuid

from flask import Flask, request, jsonify
from flask_cors import CORS
import pretty_midi
import acoustid
from lyrics import get_lyrics as fetch_lyrics
from align_lyrics import align_lyrics_to_audio
from dotenv import load_dotenv

load_dotenv()

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


# ── Song identification (AcoustID + MusicBrainz) ──
ACOUSTID_API_KEY = os.getenv("ACOUSTID_API_KEY")
FPCALC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fpcalc.exe")
os.environ["FPCALC"] = FPCALC_PATH


@app.route("/identify-song", methods=["POST"])
def identify_song():
    if not ACOUSTID_API_KEY:
        return jsonify({"error": "ACOUSTID_API_KEY not configured"}), 500

    file = request.files["file"]
    filename = f"identify_{uuid.uuid4().hex}.mp3"
    path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(path)

    try:
        results = acoustid.match(
            ACOUSTID_API_KEY, path,
            meta=["recordings", "releasegroups"],
            force_fpcalc=True,
        )

        for score, recording_id, title, artist in results:
            if score < 0.5:
                continue
            return jsonify({
                "title": title or "",
                "artist": artist or "",
                "score": round(score, 3),
                "recording_id": recording_id,
            })

        return jsonify({"error": "No match found"}), 404

    except acoustid.FingerprintGenerationError as e:
        return jsonify({"error": f"Fingerprint failed: {str(e)}"}), 500
    except acoustid.WebServiceError as e:
        return jsonify({"error": f"AcoustID lookup failed: {str(e)}"}), 500
    finally:
        os.remove(path)


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


# ── Synced lyrics (Whisper alignment) ──
@app.route("/lyrics/synced", methods=["POST"])
def get_synced_lyrics():
    data = request.json
    title = data.get("title")
    artist = data.get("artist")
    audio_file = data.get("audio_file")

    if not audio_file:
        return jsonify({"error": "audio_file is required"}), 400

    audio_path = os.path.join(UPLOAD_FOLDER, audio_file)
    if not os.path.exists(audio_path):
        return jsonify({"error": "Audio file not found"}), 404

    if not title or not artist:
        return jsonify({"error": "title and artist are required"}), 400

    print(f"Fetching synced lyrics for: {title} — {artist}")
    lyrics = fetch_lyrics(title, artist)

    if lyrics is None:
        return jsonify({"error": "Lyrics not found"}), 404

    print(f"Aligning lyrics to audio: {audio_file}")
    aligned = align_lyrics_to_audio(lyrics, audio_path)

    return jsonify({
        "title": title,
        "artist": artist,
        "lines": aligned,
    })


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )