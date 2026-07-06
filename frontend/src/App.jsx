import "./App.css";

import { useState, useRef, useEffect } from "react";

import Header from "./components/Header";
import UploadPanel from "./components/UploadPanel";
import Editor from "./components/Editor/Editor";

function App() {
  const audioRef = useRef(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [midiData, setMidiData] = useState([]);

  const [offset, setOffset] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, audioUrl]);

  const clamp = (val, min, max) =>
    Math.min(max, Math.max(min, val));

  const nudgeOffset = (delta) => {
    setOffset((prev) =>
      Math.round(clamp(Number(prev) + delta, -5, 5) * 10) / 10
    );
  };

  const nudgeSpeed = (delta) => {
    setSpeed((prev) =>
      Math.round(clamp(Number(prev) + delta, 0.25, 2) * 100) / 100
    );
  };

  return (
    <div className="app">

      <Header />

      <UploadPanel
        setMidiData={setMidiData}
        setAudioUrl={setAudioUrl}
      />

      <audio
        ref={audioRef}
        src={audioUrl || ""}
        style={{ display: "none" }}
      />

      <Editor
        midiData={midiData}
        audioRef={audioRef}
        offset={offset}
        speed={speed}
        setOffset={setOffset}
        setSpeed={setSpeed}
        nudgeOffset={nudgeOffset}
        nudgeSpeed={nudgeSpeed}
      />

    </div>
  );
}

export default App;