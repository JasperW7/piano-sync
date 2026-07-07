import axios from "axios";
import { useState } from "react";

function UploadPanel({ setMidiData, setAudioUrl }) {
  const [status, setStatus] = useState("");
  const [mp3Name, setMp3Name] = useState("");
  const [midiName, setMidiName] = useState("");

  const uploadFile = async (file, type) => {
    try {
        const formData = new FormData();
        formData.append("file", file);

        let endpoint;

        if (type === "mp3") {
          endpoint = "http://127.0.0.1:5000/upload/audio";
        }
        else if (type === "midi") {
          endpoint = "http://127.0.0.1:5000/parse/midi";
        }
        else {
          endpoint = "http://127.0.0.1:5000/parse/pdf";
        }

        const res = await axios.post(endpoint, formData);

        if (type === "mp3") {
            setAudioUrl(URL.createObjectURL(file));
            setMp3Name(file.name);
        }
        // else {
        //     setMidiData(res.data.notes);
        //     setMidiName(file.name);
        // }
        else {
            console.log("PDF/MIDI response:", res.data);

            setMidiData(res.data.notes);
            setMidiName(file.name);
        }

    } catch (err) {
        console.error(err);
    }
  };

  return (
    <div className="upload-panel">

      {/* MP3 */}
      <div
        className={`upload-dropzone ${mp3Name ? "loaded" : ""}`}
        onClick={() => document.getElementById("mp3-input").click()}
      >
        <input
          id="mp3-input"
          type="file"
          accept=".mp3"
          hidden
          onChange={(e) => {
            const file = e.target.files[0];
            if (file) uploadFile(file, "mp3");
          }}
        />

        <div className="upload-title" title={mp3Name}>
        {mp3Name ? "🎵 " + mp3Name : "🎵 Audio Track"}
        </div>
        <div className="upload-sub">
        {mp3Name ? "Loaded" : "Click to load MP3"}
        </div>
      </div>

      {/* MIDI */}
      <div
        className={`upload-dropzone ${midiName ? "loaded" : ""}`}
        onClick={() => document.getElementById("midi-input").click()}
      >
        <input
          id="midi-input"
          type="file"
          accept=".mid,.midi,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files[0];

            if (!file) return;

            const isPdf = file.name.toLowerCase().endsWith(".pdf");

            uploadFile(file, isPdf ? "pdf" : "midi");
          }}
        />

        <div className="upload-title" title={midiName}>
        {midiName ? "🎹 " + midiName : "🎹 MIDI File"}
        </div>
        <div className="upload-sub">
        {midiName ? "Loaded" : "Click to load PDF (beta) or MIDI"}
        </div>
      </div>

    </div>
  );
}

export default UploadPanel;