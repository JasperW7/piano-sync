import { useEffect, useRef, useState } from "react";

import PianoRollCanvas from "./PianoRollCanvas";
import TransportBar from "./TransportBar";

function Editor({
  midiData,
  audioRef,
  midiOnly,
  offset,
  speed,
  setOffset,
  setSpeed,
  loopA,
  loopB,
  setLoopA,
  setLoopB,
}) {
  const audioContextRef = useRef(null);

  // Spacebar play/pause
  useEffect(() => {
    const onKeyDown = (e) => {
    // Ignore keyboard shortcuts while typing in inputs
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (!audioRef.current) return;

    switch (e.code) {
        case "Space":
        e.preventDefault();

        if (audioContextRef.current?.state === "suspended") {
            audioContextRef.current.resume();
        }

        if (audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
        } else {
            audioRef.current.pause();
        }
        break;

        case "ArrowLeft":
        e.preventDefault();
        audioRef.current.currentTime = Math.max(
            0,
            audioRef.current.currentTime - 5
        );
        break;

        case "ArrowRight":
        e.preventDefault();
        audioRef.current.currentTime = Math.min(
            audioRef.current.duration || 0,
            audioRef.current.currentTime + 5
        );
        break;

        case "BracketLeft":
        e.preventDefault();
        setLoopA(audioRef.current.currentTime);
        break;

        case "BracketRight":
        e.preventDefault();
        setLoopB(audioRef.current.currentTime);
        break;

        case "Backspace":
        e.preventDefault();
        setLoopA(null);
        setLoopB(null);
        break;

        case "Digit0":
        case "Numpad0":
        e.preventDefault();
        if (loopA != null && !audioRef.current.paused) {
            audioRef.current.currentTime = loopA;
        } else {
            audioRef.current.currentTime = 0;
        }
        break;

        default:
        break;
    }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioRef, loopA]);

  const [showNoteLabels, setShowNoteLabels] = useState(true);

  return (
    <div className="editor">

      <div className="piano-roll-container">
        <button
          className="note-label-toggle"
          onClick={() => setShowNoteLabels(v => !v)}
        >
          {showNoteLabels ? "Hide Notes" : "Show Notes"}
        </button>
        <PianoRollCanvas
          midiData={midiData}
          audioRef={audioRef}
          offset={offset}
          showNoteLabels={showNoteLabels}
        />
      </div>

      <TransportBar
        audioRef={audioRef}
        audioContextRef={audioContextRef}
        midiOnly={midiOnly}
        offset={offset}
        speed={speed}
        setOffset={setOffset}
        setSpeed={setSpeed}
        loopA={loopA}
        loopB={loopB}
      />

    </div>
  );
}

export default Editor;
