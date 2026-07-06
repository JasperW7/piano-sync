import axios from "axios";
import { useState } from "react";

function UploadPanel({ setMidiData, setAudioUrl }) {
  const [status, setStatus] = useState("");
  const [mp3Status, setMp3Status] = useState("");
  const [midiStatus, setMidiStatus] = useState("");

  const testBackend = async () => {
    try {
      const res = await axios.get("http://127.0.0.1:5000/");
      setStatus(res.data.message);
    } catch {
      setStatus("Backend not reachable");
    }
  };

  const uploadFile = async (file, type) => {
    const formData = new FormData();
    formData.append("file", file);

    const endpoint =
      type === "mp3"
        ? "http://127.0.0.1:5000/upload/audio"
        : "http://127.0.0.1:5000/parse/midi";

    const res = await axios.post(endpoint, formData);

    if (type === "midi") {
      setMidiData(res.data.notes);
      setMidiStatus("Uploaded ✔");
    } else {
      setAudioUrl(URL.createObjectURL(file));
      setMp3Status("Uploaded ✔");
    }
  };

  return (
    <section className="section">
      <h2>Upload Files</h2>

      <button onClick={testBackend}>Test Backend</button>
      <p>{status}</p>

      <div className="upload-row">

        <div className="upload-card">
          <h3>MP3 Audio</h3>
          <input
            type="file"
            accept=".mp3"
            onChange={(e) =>
              uploadFile(e.target.files[0], "mp3")
            }
          />
          <p>{mp3Status}</p>
        </div>

        <div className="upload-card">
          <h3>MIDI File</h3>
          <input
            type="file"
            accept=".mid,.midi"
            onChange={(e) =>
              uploadFile(e.target.files[0], "midi")
            }
          />
          <p>{midiStatus}</p>
        </div>

      </div>
    </section>
  );
}

export default UploadPanel;