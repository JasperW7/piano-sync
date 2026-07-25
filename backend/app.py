import os
from flask import Flask, request, jsonify # type: ignore
from flask_cors import CORS # type: ignore
import uuid
import pretty_midi
import requests
import lyricsgenius
# from music21 import converter
from dotenv import load_dotenv
load_dotenv()

AUDD_API_KEY = os.getenv("AUDD_API_KEY")
GENIUS_TOKEN = os.getenv("GENIUS_TOKEN")
app = Flask(__name__)
CORS(app)
UPLOAD_FOLDER = "uploads"
MIDI_FOLDER = os.path.join(UPLOAD_FOLDER, "midi")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MIDI_FOLDER, exist_ok=True)

genius = lyricsgenius.Genius(
    GENIUS_TOKEN,
    skip_non_songs=True,
    excluded_terms=["(Remix)", "(Live)"]
)

@app.route("/")
def home():
    return jsonify({"message": "Backend is online"})

# MP3 upload

@app.route("/upload/audio", methods=["POST"])
def upload_audio():
    file = request.files["file"]

    filename = f"audio_{uuid.uuid4().hex}.mp3"
    path = os.path.join("uploads", filename)

    file.save(path)

    return {"message": "audio saved", "file": filename}
# MIDI upload
@app.route("/upload/midi", methods=["POST"])
def upload_midi():
    file = request.files["file"]

    filename = f"midi_{uuid.uuid4().hex}.mid"
    path = os.path.join("uploads", filename)

    file.save(path)

    return {"message": "midi saved", "file": filename}

def parse_midi(file_path):
    midi = pretty_midi.PrettyMIDI(file_path)
    notes = []

    piano_instruments = [inst for inst in midi.instruments if not inst.is_drum]

    if len(piano_instruments) >= 2:
        # Multiple tracks present — assume they represent separate hands.
        # Figure out which track is "right hand" by comparing average pitch;
        # the higher-pitched track is treated as the right (treble) hand.
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
        # Single track — no explicit hand info, so split heuristically
        # by pitch around middle C (MIDI 60). Not perfect (hands can
        # cross), but a reasonable default.
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
        for i, inst in enumerate(midi.instruments):
            print(
                i,
                inst.name,
                len(inst.notes),
                sum(n.pitch for n in inst.notes)/len(inst.notes)
                if inst.notes else 0
            )

    notes.sort(key=lambda n: n["start"])
    return notes

@app.route("/parse/midi", methods=["POST"])
def parse_midi_route():
    
    file = request.files["file"]

    filename = f"{uuid.uuid4().hex}.mid"
    path = os.path.join(MIDI_FOLDER, filename)
    file.save(path)

    notes = parse_midi(path)

    return jsonify({
        "notes": notes
    })

@app.route("/parse/pdf", methods=["POST"])
def parse_pdf():
    return jsonify({
        "error": "PDF parsing is temporarily unavailable in the online version."
    }), 501

@app.route("/identify-song", methods=["POST"])
def identify_song():

    file = request.files["file"]

    response = requests.post(
        "https://api.audd.io/",
        data={
            "api_token": AUDD_API_KEY,
            "return": "apple_music,spotify"
        },
        files={
            "file": (
                file.filename,
                file.stream,
                file.mimetype
            )
        }
    )

    return jsonify(response.json())

@app.route("/lyrics", methods=["POST"])
def get_lyrics():

    data = request.json

    title = data["title"]
    artist = data["artist"]

    print("Searching Genius:")
    print(title)
    print(artist)

    song = genius.search_song(
        title,
        artist,
        get_full_info=True
    )

    if song is None:
        return jsonify({
            "error": "Lyrics not found"
        }), 404


    if artist.lower() not in song.artist.lower():
        return jsonify({
            "error": "Wrong artist match",
            "found": song.artist
        }), 404

    return jsonify({
        "title": song.title,
        "artist": song.artist,
        "lyrics": song.lyrics
    })
if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )