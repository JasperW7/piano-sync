import os
from flask import Flask, request, jsonify # type: ignore
from flask_cors import CORS # type: ignore
import uuid
import pretty_midi
import subprocess
import shutil
from music21 import converter

app = Flask(__name__)
CORS(app)
AUDIVERIS = r"C:\Users\jaspe\audiveris\Audiveris.exe"
UPLOAD_FOLDER = "uploads"
PDF_FOLDER = os.path.join(UPLOAD_FOLDER, "pdf")
MIDI_FOLDER = os.path.join(UPLOAD_FOLDER, "midi")
PROCESSED_FOLDER = "processed"

os.makedirs(PDF_FOLDER, exist_ok=True)
os.makedirs(MIDI_FOLDER, exist_ok=True)
os.makedirs(PROCESSED_FOLDER, exist_ok=True)

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

    file = request.files["file"]

    print("PDF RECEIVED:", file.filename)

    pdf_path = os.path.join(PDF_FOLDER, file.filename)
    file.save(pdf_path)

    print("SAVED PDF:", pdf_path)

    output_dir = os.path.join(PROCESSED_FOLDER, uuid.uuid4().hex)
    os.makedirs(output_dir, exist_ok=True)

    print("RUNNING AUDIVERIS...")

    result = subprocess.run(
        [
            AUDIVERIS,
            "-batch",
            "-transcribe",
            "-export",
            "-output",
            output_dir,
            pdf_path
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW
    )

    print("AUDIVERIS FINISHED")
    print("RETURN CODE:", result.returncode)
    print(result.stdout)
    print(result.stderr)


    print("SEARCHING OUTPUT:", output_dir)

    mxl_file = None

    for root, dirs, files in os.walk(output_dir):
        print("CHECKING:", root, files)

        for f in files:
            if f.lower().endswith(".mxl"):
                mxl_file = os.path.join(root, f)


    if mxl_file is None:
        print("NO MUSICXML FOUND")
        return jsonify({
            "error": "No MusicXML generated"
        }), 400


    print("FOUND MUSICXML:", mxl_file)


    print("CONVERTING MUSICXML TO MIDI")

    score = converter.parse(mxl_file)

    midi_path = os.path.join(
        output_dir,
        "converted.mid"
    )

    score.write(
        "midi",
        fp=midi_path
    )

    print("CREATED MIDI:", midi_path)


    notes = parse_midi(midi_path)

    print("NOTES GENERATED:", len(notes))
    print(notes[:5])

    return jsonify({
        "notes": notes
    })
if __name__ == "__main__":
    app.run(debug=True)