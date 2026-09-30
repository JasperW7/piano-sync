import axios from "axios";
import { useState } from "react";
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

function UploadPanel({
  setMidiData,
  setTempo,
  setAudioUrl,
  setAudioFile,
  setSongInfo,
  setLyricsStep,
  showLyrics,
}) {
  const [mp3Name, setMp3Name] = useState("");
  const [midiName, setMidiName] = useState("");

  const uploadFile = async (file, type) => {
    try {
      const formData = new FormData();
      formData.append("file", file);

      let endpoint;
      if (type === "mp3") {
        endpoint = `${API}/upload/audio`;
      } else if (type === "midi") {
        endpoint = `${API}/parse/midi`;
      } else {
        endpoint = `${API}/parse/pdf`;
      }

      const res = await axios.post(endpoint, formData);

      if (type === "mp3") {
        return res.data.file;
      } else {
        const notes = res.data.notes.map((n, i) => ({ ...n, id: i }));
        setMidiData(notes);
        if (res.data.tempo) setTempo(res.data.tempo);
        setMidiName(file.name);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const identifySong = async (file) => {
    try {
      setLyricsStep("identifying");
      const formData = new FormData();
      formData.append("file", file);

      const res = await axios.post(`${API}/identify-song`, formData);
      setSongInfo({ title: res.data.title, artist: res.data.artist });
      setLyricsStep(null);
    } catch (err) {
      console.error("Song identification error:", err);
      setSongInfo(null);
      setLyricsStep(null);
    }
  };

  return (
    <div className="upload-panel-inline">
      <button
        type="button"
        className={`upload-chip ${mp3Name ? "loaded" : ""}`}
        onClick={() => document.getElementById("mp3-input").click()}
        title={mp3Name || "Load MP3"}
      >
        <input
          id="mp3-input"
          type="file"
          accept=".mp3"
          hidden
          onChange={async (e) => {
            const file = e.target.files[0];
            if (file) {
              setAudioUrl(URL.createObjectURL(file));
              setMp3Name(file.name);
              const serverFile = await uploadFile(file, "mp3");
              if (serverFile) setAudioFile(serverFile);
              if (showLyrics) {
                await identifySong(file);
              }
            }
          }}
        />
        <span className="upload-chip-icon">🎵</span>
        <span className="upload-chip-label">
          {mp3Name || "Audio Track"}
        </span>
      </button>

      <button
        type="button"
        className={`upload-chip ${midiName ? "loaded" : ""}`}
        onClick={() => document.getElementById("midi-input").click()}
        title={midiName || "Load MIDI or PDF (beta)"}
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
        <span className="upload-chip-icon">🎹</span>
        <span className="upload-chip-label">
          {midiName || "MIDI File"}
        </span>
      </button>
    </div>
  );
}

export default UploadPanel;
