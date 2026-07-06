import { useEffect, useRef } from "react";

function PianoRollCanvas({ midiData, audioRef, offset }) {
  const canvasRef = useRef(null);

  // Persistent indices (IMPORTANT: must be outside render loop)
  const firstVisibleIndex = useRef(0);

  const BLACK_WIDTH_RATIO = 0.6;
  const BLACK_HEIGHT_RATIO = 0.6;

  function isBlackKey(midi) {
    const note = (midi - 21) % 12;
    return [1, 4, 6, 9, 11].includes(note);
  }

  function midiToKeyIndex(midi) {
    return midi - 21;
  }

  function getNoteColor(note) {
    const black = isBlackKey(note.note);

    if (note.hand === "left") {
      return black ? "#bf360c" : "#ffb74d";
    }

    return black ? "#006064" : "#4dd0e1";
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // Reset when new MIDI loads
  useEffect(() => {
    firstVisibleIndex.current = 0;
  }, [midiData]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = 500;
    };

    resize();
    window.addEventListener("resize", resize);

    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
        const whiteKeyMidi = [];
    for (let midi = 21; midi <= 108; midi++) {
      if (!isBlackKey(midi)) whiteKeyMidi.push(midi);
    }

    const whiteKeyWidth = canvasRef.current
      ? canvasRef.current.width / whiteKeyMidi.length
      : 0;

    const whiteKeyMap = new Map();
    whiteKeyMidi.forEach((midi, i) => {
      whiteKeyMap.set(midi, i);
    });

    const ctx = canvas.getContext("2d");
    let animationId;

    const pixelsPerSecond = 140;

    const render = () => {
      const audio = audioRef.current;

      if (!audio) {
        animationId = requestAnimationFrame(render);
        return;
      }

      const currentTime = audio.currentTime + Number(offset);
      const playLine = canvas.height * 0.75;

      const keyWidth = canvas.width / 88;
      const blackNoteWidth = keyWidth * BLACK_WIDTH_RATIO;
      const blackNoteXOffset = (keyWidth - blackNoteWidth) / 2;

      // Reset if seeking backwards
      // Reset visible index if we've seeked backwards OR reached the end
      if (
        firstVisibleIndex.current >= midiData.length ||
        (
          firstVisibleIndex.current > 0 &&
          midiData[firstVisibleIndex.current]?.start > currentTime
        )
      ) {
        firstVisibleIndex.current = 0;
      }

      // Advance invisible notes
      while (
        firstVisibleIndex.current < midiData.length &&
        midiData[firstVisibleIndex.current].start +
          midiData[firstVisibleIndex.current].duration <
          currentTime - 1
      ) {
        firstVisibleIndex.current++;
      }

      // Background
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // ===== DRAW NOTES =====
      for (
        let i = firstVisibleIndex.current;
        i < midiData.length;
        i++
      ) {
        const note = midiData[i];

        if (note.start > currentTime + 5) break;

        const black = isBlackKey(note.note);
        const colIndex = midiToKeyIndex(note.note);

        const width = black ? blackNoteWidth : keyWidth;
        const x =
          colIndex * keyWidth +
          (black ? blackNoteXOffset : 0);

        const height = note.duration * pixelsPerSecond;

        let y =
          playLine -
          (note.start - currentTime) * pixelsPerSecond -
          height;

        let drawHeight = height;

        if (y + drawHeight > playLine) {
          drawHeight = playLine - y;
        }

        if (drawHeight <= 0) continue;

        ctx.fillStyle = getNoteColor(note);
        drawRoundedRect(ctx, x, y, width, drawHeight, 3);

        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.strokeRect(x, y, width, drawHeight);
      }

      // Play line
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, playLine);
      ctx.lineTo(canvas.width, playLine);
      ctx.stroke();

      
      // ===== KEYBOARD =====
      const keyboardY = playLine;
      const keyboardHeight = canvas.height - keyboardY;

      const whiteKeyHeight = keyboardHeight;
      const blackKeyHeight = keyboardHeight * BLACK_HEIGHT_RATIO;

      // =====================================================
      // 1. BUILD WHITE KEY LAYOUT (52 keys)
      // =====================================================

      // MIDI note numbers for white keys starting at A0 (21)
      const whiteKeyMidi = [];
      for (let midi = 21; midi <= 108; midi++) {
        if (!isBlackKey(midi)) {
          whiteKeyMidi.push(midi);
        }
      }

      const whiteKeyWidth = canvas.width / whiteKeyMidi.length;

      // map MIDI -> white key index
      const whiteKeyMap = new Map();
      whiteKeyMidi.forEach((midi, i) => {
        whiteKeyMap.set(midi, i);
      });

      // =====================================================
      // 2. DRAW WHITE KEYS
      // =====================================================
      for (let i = 0; i < whiteKeyMidi.length; i++) {
        const x = i * whiteKeyWidth;

        ctx.fillStyle = "#eee";
        ctx.fillRect(x, keyboardY, whiteKeyWidth, whiteKeyHeight);

        ctx.strokeStyle = "#333";
        ctx.strokeRect(x, keyboardY, whiteKeyWidth, whiteKeyHeight);
      }

      // =====================================================
      // 2b. COLLECT CURRENTLY-SOUNDING NOTES
      // =====================================================
      const activeNotes = [];
      {
        let idx = firstVisibleIndex.current;
        while (idx < midiData.length && midiData[idx].start <= currentTime) {
          const note = midiData[idx];
          if (
            currentTime >= note.start &&
            currentTime <= note.start + note.duration
          ) {
            activeNotes.push(note);
          }
          idx++;
        }
      }

      // =====================================================
      // 2c. HIGHLIGHT ACTIVE WHITE KEYS (drawn under the black keys)
      // =====================================================
      for (const note of activeNotes) {
        const midi = note.note;
        if (isBlackKey(midi)) continue;

        const whiteIndex = whiteKeyMap.get(midi);
        const x = whiteIndex * whiteKeyWidth;

        ctx.fillStyle = note.hand === "left" ? "#ff8a65" : "#0b76b3";
        ctx.fillRect(x+whiteKeyWidth*0.05, keyboardY, whiteKeyWidth*0.9, keyboardHeight);
      }

      // =====================================================
      // 3. DRAW BLACK KEYS (positioned correctly)
      // =====================================================

      for (let midi = 21; midi <= 108; midi++) {
        if (!isBlackKey(midi)) continue;

        // black key sits between surrounding whites
        const prevWhite = midi - 1;
        const nextWhite = midi + 1;

        // find nearest white positions
        let baseWhiteIndex = whiteKeyMap.get(prevWhite);
        if (baseWhiteIndex === undefined) {
          baseWhiteIndex = whiteKeyMap.get(nextWhite) - 1;
        }

        const x =
          (baseWhiteIndex + 1) * whiteKeyWidth -
          blackNoteWidth / 2;

        ctx.fillStyle = "#111";
        ctx.fillRect(x, keyboardY, blackNoteWidth, blackKeyHeight);

        ctx.strokeStyle = "#000";
        ctx.strokeRect(x, keyboardY, blackNoteWidth, blackKeyHeight);
      }

      // =====================================================
      // 3b. HIGHLIGHT ACTIVE BLACK KEYS (drawn on top of everything)
      // =====================================================
      for (const note of activeNotes) {
        const midi = note.note;
        if (!isBlackKey(midi)) continue;

        const x = (midi - 21) * (canvas.width / 88) + blackNoteXOffset;

        ctx.fillStyle = note.hand === "left" ? "#ff8a65" : "#0b76b3";
        ctx.fillRect(x+blackNoteWidth*0.05, keyboardY, blackNoteWidth*0.9, blackKeyHeight);
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [midiData, audioRef, offset]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        flex:1,
        minHeight:0,
        border: "1px solid #333",
        marginTop: "20px",
      }}
    />
  );
}

export default PianoRollCanvas;