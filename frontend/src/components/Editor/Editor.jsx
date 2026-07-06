import { useEffect } from "react";

import Toolbar from "./Toolbar";
import PianoRollCanvas from "./PianoRollCanvas";
import Timeline from "./Timeline";

function Editor({
  midiData,
  audioRef,
  offset,
  speed,
  setOffset,
  setSpeed,
  nudgeOffset,
  nudgeSpeed,
}) {
  // Spacebar play/pause
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== "Space") return;

      // prevent space scrolling OR slider interference
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (!audioRef.current) return;

      e.preventDefault();

      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioRef]);

  return (
    <div className="editor">

      <Toolbar
        audioRef={audioRef}
        offset={offset}
        speed={speed}
        nudgeOffset={nudgeOffset}
        nudgeSpeed={nudgeSpeed}
      />

      <Timeline audioRef={audioRef} />

      <PianoRollCanvas
        midiData={midiData}
        audioRef={audioRef}
        offset={offset}
      />

    </div>
  );
}

export default Editor;