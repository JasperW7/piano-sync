import { useEffect, useRef, useState, useCallback } from "react";

import PianoRollCanvas from "./PianoRollCanvas";
import TransportBar from "./TransportBar";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";
const MAX_UNDO = 50;

function Editor({
  midiData,
  setMidiData,
  tempo,
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

  const [showNoteLabels, setShowNoteLabels] = useState(true);
  const [selectedNoteIds, setSelectedNoteIds] = useState(new Set());
  const [showLeftHand, setShowLeftHand] = useState(true);
  const [showRightHand, setShowRightHand] = useState(true);

  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  const pushUndo = useCallback((prevData) => {
    undoStackRef.current.push(prevData);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNoteIds.size === 0) return;
    pushUndo(midiData);
    setMidiData(prev => prev.filter(n => !selectedNoteIds.has(n.id)));
    setSelectedNoteIds(new Set());
  }, [selectedNoteIds, setMidiData, pushUndo, midiData]);

  const handleEditNote = useCallback((id, changes) => {
    pushUndo(midiData);
    setMidiData(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, ...changes } : n);
      updated.sort((a, b) => a.start - b.start);
      return updated;
    });
  }, [setMidiData, pushUndo, midiData]);

  const handleAddNote = useCallback((newNote) => {
    pushUndo(midiData);
    const maxId = midiData.reduce((max, n) => Math.max(max, n.id), -1);
    const note = { ...newNote, id: maxId + 1 };
    setMidiData(prev => {
      const updated = [...prev, note];
      updated.sort((a, b) => a.start - b.start);
      return updated;
    });
  }, [setMidiData, pushUndo, midiData]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    redoStackRef.current.push(midiData);
    const prev = undoStackRef.current.pop();
    setMidiData(prev);
    setSelectedNoteIds(new Set());
  }, [midiData, setMidiData]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    undoStackRef.current.push(midiData);
    const next = redoStackRef.current.pop();
    setMidiData(next);
    setSelectedNoteIds(new Set());
  }, [midiData, setMidiData]);

  const handleSave = useCallback(async () => {
    try {
      const response = await fetch(`${API}/export/midi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: midiData, tempo }),
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "edited.mid";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("MIDI export failed:", err);
    }
  }, [midiData, tempo]);

  useEffect(() => {
    const onKeyDown = (e) => {
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
            const result = audioRef.current.play();
            if (result && result.catch) result.catch(() => {});
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

        case "Delete":
          e.preventDefault();
          handleDeleteSelected();
          break;

        case "Escape":
          e.preventDefault();
          setSelectedNoteIds(new Set());
          break;

        case "KeyA":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const visibleIds = new Set(
              midiData
                .filter(n =>
                  (n.hand === "left" && showLeftHand) ||
                  (n.hand === "right" && showRightHand)
                )
                .map(n => n.id)
            );
            setSelectedNoteIds(visibleIds);
          }
          break;

        case "KeyZ":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              handleRedo();
            } else {
              handleUndo();
            }
          }
          break;

        case "KeyS":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSave();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioRef, loopA, handleDeleteSelected, handleUndo, handleRedo, handleSave, midiData, showLeftHand, showRightHand]);

  return (
    <div className="editor">

      <div className="piano-roll-container">
        <div className="canvas-toolbar-left">
          <button
            className={`hand-toggle ${showLeftHand ? "active" : ""}`}
            style={showLeftHand ? { borderColor: "#ffb74d", color: "#ffb74d" } : undefined}
            onClick={() => setShowLeftHand(v => !v)}
            title="Toggle left hand"
          >
            L
          </button>
          <button
            className={`hand-toggle ${showRightHand ? "active" : ""}`}
            style={showRightHand ? { borderColor: "#4dd0e1", color: "#4dd0e1" } : undefined}
            onClick={() => setShowRightHand(v => !v)}
            title="Toggle right hand"
          >
            R
          </button>
        </div>

        <div className="canvas-toolbar-right">
          <button
            className="note-label-toggle"
            onClick={() => setShowNoteLabels(v => !v)}
          >
            {showNoteLabels ? "Hide Notes" : "Show Notes"}
          </button>
          {midiData.length > 0 && (
            <button className="save-midi-btn" onClick={handleSave} title="Save MIDI (Ctrl+S)">
              Save MIDI
            </button>
          )}
        </div>

        <PianoRollCanvas
          midiData={midiData}
          audioRef={audioRef}
          offset={offset}
          showNoteLabels={showNoteLabels}
          tempo={tempo}
          showLeftHand={showLeftHand}
          showRightHand={showRightHand}
          selectedNoteIds={selectedNoteIds}
          onSelectNote={setSelectedNoteIds}
          onEditNote={handleEditNote}
          onAddNote={handleAddNote}
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
