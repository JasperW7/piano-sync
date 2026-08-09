import { useEffect } from "react";

import PianoRollCanvas from "./PianoRollCanvas";
import TransportBar from "./TransportBar";

function Editor({
  midiData,
  audioRef,
  offset,
  speed,
  setOffset,
  setSpeed,
}) {
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

        if (audioRef.current.paused) {
            audioRef.current.play();
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

        default:
        break;
    }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioRef]);

  return (
    <div className="editor">

      <div className="piano-roll-container">
        <PianoRollCanvas
          midiData={midiData}
          audioRef={audioRef}
          offset={offset}
        />
      </div>

      <TransportBar
        audioRef={audioRef}
        offset={offset}
        speed={speed}
        setOffset={setOffset}
        setSpeed={setSpeed}
      />

    </div>
  );
}

export default Editor;
