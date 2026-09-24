import "./App.css";

import { useState, useRef, useEffect } from "react";

import Header from "./components/Header";
import Editor from "./components/Editor/Editor";
import LyricsPanel from "./components/LyricsPanel";
import useMidiSynth from "./hooks/useMidiSynth";

function App() {
  const audioRef = useRef(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [midiData, setMidiData] = useState([]);

  const [offset, setOffset] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loopA, setLoopA] = useState(null);
  const [loopB, setLoopB] = useState(null);

  const [showLyrics, setShowLyrics] = useState(false);
  const [songInfo, setSongInfo] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [lyricsText, setLyricsText] = useState(null);
  const [lyricsOriginal, setLyricsOriginal] = useState(null);
  const [syncedLyrics, setSyncedLyrics] = useState(null);
  const [lyricsStep, setLyricsStep] = useState(null);

  const { midiPlayerRef, midiOnly, synthReady, synthLoading } =
    useMidiSynth(midiData, audioUrl);

  const effectiveAudioRef = midiOnly ? midiPlayerRef : audioRef;

  // Explicitly load audio when src changes (some browsers don't auto-reload)
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.load();
    }
  }, [audioUrl]);

  useEffect(() => {
    const target = effectiveAudioRef.current;
    if (target) {
      target.playbackRate = speed;
    }
  }, [speed, audioUrl, midiOnly, synthReady]);

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

      <Header
        setMidiData={setMidiData}
        setAudioUrl={setAudioUrl}
        setAudioFile={setAudioFile}
        setSongInfo={setSongInfo}
        setLyricsStep={setLyricsStep}
        showLyrics={showLyrics}
        setShowLyrics={setShowLyrics}
      />

      <div className="workspace">
        <div className="hidden-audio">
          <audio
            ref={audioRef}
            src={audioUrl ?? undefined}
            preload="auto"
            onError={(e) => {
              if (audioUrl) {
                console.error("Audio load error:", e.target.error?.message);
              }
            }}
          />
        </div>

        {synthLoading && (
          <div className="synth-loading">Loading piano...</div>
        )}

        {showLyrics && (
          <LyricsPanel
            songInfo={songInfo}
            setSongInfo={setSongInfo}
            audioFile={audioFile}
            lyricsText={lyricsText}
            setLyricsText={setLyricsText}
            lyricsOriginal={lyricsOriginal}
            setLyricsOriginal={setLyricsOriginal}
            syncedLyrics={syncedLyrics}
            setSyncedLyrics={setSyncedLyrics}
            lyricsStep={lyricsStep}
            setLyricsStep={setLyricsStep}
          />
        )}

        <Editor
          midiData={midiData}
          audioRef={effectiveAudioRef}
          midiOnly={midiOnly}
          offset={offset}
          speed={speed}
          setOffset={setOffset}
          setSpeed={setSpeed}
          nudgeOffset={nudgeOffset}
          nudgeSpeed={nudgeSpeed}
          loopA={loopA}
          loopB={loopB}
          setLoopA={setLoopA}
          setLoopB={setLoopB}
      />
      </div>

    </div>
  );
}

export default App;
