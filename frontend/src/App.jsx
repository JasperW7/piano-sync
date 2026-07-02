import { useState } from "react";
import axios from "axios";
import { useRef, useEffect } from "react";
import PianoRollCanvas from "./components/PianoRollCanvas";

function App() {
  const audioRef = useRef(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [midiData, setMidiData] = useState([]);
  const [activeNotes, setActiveNotes] = useState([]);
  const [status, setStatus] = useState("");
  const [mp3Status, setMp3Status] = useState("");
  const [midiStatus, setMidiStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [speed, setSpeed] = useState(1);

  const testBackend = async () => {
    try {
      const res = await axios.get("http://127.0.0.1:5000/");
      setStatus(res.data.message);
    } catch (err) {
      setStatus("Backend not reachable");
    }
  };

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
      }

      console.log(res.data);
      if (type === "mp3") {
        setAudioUrl(URL.createObjectURL(file));
        setMp3Status("Uploaded ✔");
      } else {
        setMidiStatus("Uploaded ✔");
      }
    } catch (err) {
      if (type === "mp3") setMp3Status("Upload failed ❌");
      else setMidiStatus("Upload failed ❌");
    }
  };

  const playAudio = () => {
    if (audioRef.current) {
      audioRef.current.play();
    }
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, audioUrl]);

  useEffect(() => {
    let animationId;

    const loop = () => {
      if (!audioRef.current) {
        animationId = requestAnimationFrame(loop);
        return;
      }

      const currentTime = audioRef.current.currentTime + Number(offset);

      const active = midiData.filter((note) => {
        return (
          currentTime >= note.start &&
          currentTime <= note.start + note.duration
        );
      });

      setActiveNotes(active);

      animationId = requestAnimationFrame(loop);
    };

    loop();

    return () => cancelAnimationFrame(animationId);
  }, [midiData]);

  // clamp + round helper so +/- buttons and typed values stay clean
  const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

  const nudgeOffset = (delta) => {
    setOffset((prev) => {
      const next = clamp(Number(prev) + delta, -5, 5);
      return Math.round(next * 10) / 10;
    });
  };

  const nudgeSpeed = (delta) => {
    setSpeed((prev) => {
      const next = clamp(Number(prev) + delta, 0.25, 2);
      return Math.round(next * 100) / 100;
    });
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <style>{`
        .nice-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: #ccc;
          outline: none;
          cursor: pointer;
        }
        .nice-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #333;
          border: 3px solid #fff;
          box-shadow: 0 0 0 1px #333;
          cursor: grab;
        }
        .nice-slider::-webkit-slider-thumb:active {
          cursor: grabbing;
          background: #555;
        }
        .nice-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #333;
          border: 3px solid #fff;
          box-shadow: 0 0 0 1px #333;
          cursor: grab;
        }
        .nice-slider::-moz-range-thumb:active {
          cursor: grabbing;
          background: #555;
        }
        .step-btn {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          border: 1px solid #333;
          background: #eee;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          line-height: 1;
        }
        .step-btn:hover {
          background: #ddd;
        }
        .step-btn:active {
          background: #ccc;
        }
      `}</style>

      <h1>Piano Sync MVP</h1>

      <button onClick={testBackend}>Test Backend</button>
      <p>{status}</p>

      <hr />

      <div>
        <h3>Upload Song (MP3)</h3>

        <input
          type="file"
          accept=".mp3"
          onChange={(e) => {
            const file = e.target.files[0];
            if (!file) return;
            uploadFile(file, "mp3");
          }}
        />

        <p>{mp3Status}</p>
      </div>

      <div>
        <h3>Upload MIDI</h3>

        <input
          type="file"
          accept=".mid,.midi"
          onChange={(e) => {
            const file = e.target.files[0];
            if (!file) return;
            uploadFile(file, "midi");
          }}
        />

        <p>{midiStatus}</p>
      </div>

      <hr />
      <audio
        ref={audioRef}
        controls
        src={audioUrl || ""}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            audioRef.current.playbackRate = speed;
          }
        }}
        style={{ width: "100%", marginBottom: "20px" }}
      />
      <PianoRollCanvas
        midiData={midiData}
        audioRef={audioRef}
        offset={offset}
      />
      <div>
        <h3>Controls</h3>
        
        <button onClick={playAudio}>Play</button>

        <div
          style={{
            display: "flex",
            gap: "40px",
            marginTop: "24px",
            flexWrap: "wrap",
          }}
        >
          {/* Offset control */}
          <div style={{ flex: "1", minWidth: "260px" }}>
            <label style={{ fontWeight: "bold" }}>
              Offset: {Number(offset).toFixed(1)}s
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginTop: "8px",
              }}
            >
              <button
                className="step-btn"
                onClick={() => nudgeOffset(-0.1)}
              >
                −
              </button>
              <input
                className="nice-slider"
                type="range"
                min="-5"
                max="5"
                step="0.1"
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
              <button
                className="step-btn"
                onClick={() => nudgeOffset(0.1)}
              >
                +
              </button>
            </div>
          </div>

          {/* Speed control */}
          <div style={{ flex: "1", minWidth: "260px" }}>
            <label style={{ fontWeight: "bold" }}>
              Speed: {speed.toFixed(2)}x
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginTop: "8px",
              }}
            >
              <button
                className="step-btn"
                onClick={() => nudgeSpeed(-0.05)}
              >
                −
              </button>
              <input
                className="nice-slider"
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
              <button
                className="step-btn"
                onClick={() => nudgeSpeed(0.05)}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;