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

        const endpoint =
        type === "mp3"
            ? "http://127.0.0.1:5000/upload/audio"
            : "http://127.0.0.1:5000/parse/midi";

        const res = await axios.post(endpoint, formData);

        if (type === "midi") {
        setMidiData(res.data.notes);
        setMidiName(file.name)
        } else {
        setAudioUrl(URL.createObjectURL(file));
        setMp3Name(file.name)
        }

    } catch (err) {
        console.error("Upload failed:", err);

        if (type === "midi") {
        setMidiStatus("Upload failed ❌");
        } else {
        setMp3Status("Upload failed ❌");
        }
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
            if (file) uploadFile(file, file.name.endsWith(".pdf") ? "pdf" : "midi");
          }}
        />

        <div className="upload-title" title={midiName}>
        {midiName ? "🎹 " + midiName : "🎹 MIDI File"}
        </div>
        <div className="upload-sub">
        {midiName ? "Loaded" : "Click to load MIDI"}
        </div>
      </div>

    </div>
  );
}

export default UploadPanel;