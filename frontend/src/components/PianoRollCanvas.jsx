import { useEffect, useRef } from "react";

function PianoRollCanvas({ midiData, audioRef, offset }) {
  const canvasRef = useRef(null);

  function isBlackKey(midi) {
    const note = (midi - 21) % 12;
    return [1, 4, 6, 9, 11].includes(note);
  }

  function midiToKeyIndex(midi) {
    return midi - 21;
  }

  // Right hand = blue family, left hand = orange family.
  // Black-key notes get a darker shade within the same family.
  function getNoteColor(note) {
    const black = isBlackKey(note.note);
    if (note.hand === "left") {
      return black ? "#bf360c" : "#ffb74d"; // dark orange / light orange
    }
    // default to right hand coloring if hand is missing
    return black ? "#006064" : "#4dd0e1"; // dark teal / light cyan
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationId;

    const BLACK_WIDTH_RATIO = 0.6;
    const BLACK_HEIGHT_RATIO = 0.6;

    const render = () => {
      const audio = audioRef.current;
      if (!audio) {
        animationId = requestAnimationFrame(render);
        return;
      }

      const playLine = canvas.height * 0.75;
      const pixelsPerSecond = 140;
      const currentTime = audio.currentTime + Number(offset);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const keyWidth = canvas.width / 88;
      const blackNoteWidth = keyWidth * BLACK_WIDTH_RATIO;
      const blackNoteXOffset = (keyWidth - blackNoteWidth) / 2;

      // ===== DRAW NOTES =====
      for (let i = 0; i < midiData.length; i++) {
        const note = midiData[i];
        const timeToNote = note.start - currentTime;
        if (timeToNote < -2 || timeToNote > 5) continue;

        const black = isBlackKey(note.note);
        const colIndex = midiToKeyIndex(note.note);
        const width = black ? blackNoteWidth : keyWidth;
        const x = colIndex * keyWidth + (black ? blackNoteXOffset : 0);

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
        ctx.fillRect(x, y, width, drawHeight);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(x, y, width, drawHeight);
      }

      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, playLine);
      ctx.lineTo(canvas.width, playLine);
      ctx.stroke();

      // ===== DRAW KEYBOARD =====
      const keyboardY = playLine;
      const keyboardHeight = canvas.height - keyboardY;
      const blackKeyHeight = keyboardHeight * BLACK_HEIGHT_RATIO;

      for (let i = 0; i < 88; i++) {
        const midi = i + 21;
        if (isBlackKey(midi)) continue;
        const x = i * keyWidth;
        ctx.fillStyle = "#eee";
        ctx.fillRect(x, keyboardY, keyWidth, keyboardHeight);
        ctx.strokeStyle = "#333";
        ctx.strokeRect(x, keyboardY, keyWidth, keyboardHeight);
      }

      for (let i = 0; i < 88; i++) {
        const midi = i + 21;
        if (!isBlackKey(midi)) continue;
        const x = i * keyWidth + blackNoteXOffset;
        ctx.fillStyle = "#111";
        ctx.fillRect(x, keyboardY, blackNoteWidth, blackKeyHeight);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(x, keyboardY, blackNoteWidth, blackKeyHeight);
      }

      // ===== ACTIVE KEYS =====
      const active = midiData.filter((n) => {
        return currentTime >= n.start && currentTime <= n.start + n.duration;
      });
      for (const note of active) {
        const black = isBlackKey(note.note);
        const colIndex = midiToKeyIndex(note.note);
        const w = black ? blackNoteWidth : keyWidth;
        const x = colIndex * keyWidth + (black ? blackNoteXOffset : 0);
        const h = black ? blackKeyHeight : keyboardHeight;
        ctx.fillStyle = note.hand === "left" ? "#ff8a65" : "#0b76b3";
        ctx.fillRect(x, keyboardY, w, h);
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [midiData, audioRef, offset]);

  return (
    <canvas
      ref={canvasRef}
      width={1000}
      height={400}
      style={{
        border: "1px solid #333",
        width: "100%",
        marginTop: "20px",
      }}
    />
  );
}

export default PianoRollCanvas;