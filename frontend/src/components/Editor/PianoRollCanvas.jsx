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

  function getNoteColor(note) {
    const black = isBlackKey(note.note);

    if (note.hand === "left") {
      return black ? "#bf360c" : "#ffb74d";
    }

    return black ? "#006064" : "#4dd0e1";
  }

  // Single source of truth for where a key (and therefore any note
  // falling onto it) actually sits, based on the real 52-white-key
  // layout — NOT a naive uniform 88-key grid, since black keys are
  // narrower and unevenly spaced. Both the notes and the keyboard
  // below use this so they always stay in sync.
  function getKeyGeometry(midi, whiteKeyWidth, whiteKeyMap, blackKeyWidthRatio) {
    const black = isBlackKey(midi);

    if (!black) {
      const whiteIndex = whiteKeyMap.get(midi);
      return { x: whiteIndex * whiteKeyWidth, width: whiteKeyWidth, black };
    }

    const prevWhite = midi - 1;
    const nextWhite = midi + 1;

    let baseWhiteIndex = whiteKeyMap.get(prevWhite);
    if (baseWhiteIndex === undefined) {
      baseWhiteIndex = whiteKeyMap.get(nextWhite) - 1;
    }

    const blackKeyWidth = whiteKeyWidth * blackKeyWidthRatio;
    const x = (baseWhiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2;

    return { x, width: blackKeyWidth, black };
  }

  // Generic rounded-rect path with an independent radius per corner.
  // Lets keys have a square top edge (where they meet the case) and a
  // rounded front/bottom edge, like a real piano key.
  function roundedRectPath(ctx, x, y, w, h, r) {
    const { tl = 0, tr = 0, br = 0, bl = 0 } =
      typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;

    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.arcTo(x + w, y, x + w, y + tr, tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
  }

  function fillRoundedRect(ctx, x, y, w, h, r) {
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function strokeRoundedRect(ctx, x, y, w, h, r) {
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
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
      canvas.height = canvas.clientHeight;
    };

    resize();
    window.addEventListener("resize", resize);

    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let animationId;

    const pixelsPerSecond = 140;

    const render = () => {
      const audio = audioRef.current;

      if (!audio || canvas.width === 0 || canvas.height === 0) {
        animationId = requestAnimationFrame(render);
        return;
      }

      const currentTime = audio.currentTime + Number(offset);
      const playLine = canvas.height * 0.75;

      // Real key geometry (52 white keys), computed once up front so
      // notes and the keyboard always agree on where each key is.
      const whiteKeyMidi = [];
      for (let midi = 21; midi <= 108; midi++) {
        if (!isBlackKey(midi)) whiteKeyMidi.push(midi);
      }

      const whiteKeyWidth = canvas.width / whiteKeyMidi.length;

      const whiteKeyMap = new Map();
      whiteKeyMidi.forEach((midi, i) => whiteKeyMap.set(midi, i));

      const blackNoteWidth = whiteKeyWidth * BLACK_WIDTH_RATIO;

      // Notes get a nice capsule-style rounding, capped so short/thin
      // notes never look pinched or self-intersecting.
      const noteRadius = Math.min(7, whiteKeyWidth * 0.35);

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
      const bgGradient = ctx.createLinearGradient(0, 0, 0, playLine);
      bgGradient.addColorStop(0, "#161616");
      bgGradient.addColorStop(1, "#0d0d0d");
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // ===== DRAW NOTES =====
      for (
        let i = firstVisibleIndex.current;
        i < midiData.length;
        i++
      ) {
        const note = midiData[i];

        if (note.start > currentTime + 5) break;

        const key = getKeyGeometry(
          note.note,
          whiteKeyWidth,
          whiteKeyMap,
          BLACK_WIDTH_RATIO
        );

        // Render at 95% of the key's actual width, centered on it,
        // so the note reads as sitting distinctly on that key rather
        // than spanning its full width edge-to-edge.
        const width = key.width * 0.95;
        const x = key.x + (key.width - width) / 2;

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

        const r = Math.min(noteRadius, width / 2, drawHeight / 2);

        ctx.fillStyle = getNoteColor(note);
        fillRoundedRect(
          ctx,
          x,
          y,
          width,
          drawHeight,
          r
        );

        // Soft glossy highlight along the top of the note.
        if (drawHeight > 6) {
          const glossHeight = Math.min(drawHeight * 0.4, 10);
          const gloss = ctx.createLinearGradient(0, y, 0, y + glossHeight);
          gloss.addColorStop(0, "rgba(255,255,255,0.35)");
          gloss.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gloss;
          fillRoundedRect(
            ctx,
            x,
            y,
            width,
            glossHeight,
            { tl: r, tr: r, br: 0, bl: 0 }
          );
        }

        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1;
        strokeRoundedRect(
          ctx,
          x,
          y,
          width,
          drawHeight,
          r
        );
      }

      // Play line
      ctx.strokeStyle = "rgba(255,60,60,0.9)";
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

      const whiteKeyRadius = Math.min(6, keyboardHeight * 0.12);
      const blackKeyRadius = Math.min(4, blackKeyHeight * 0.12);

      // =====================================================
      // DRAW WHITE KEYS
      // =====================================================
      // Built once per frame and reused for every key — cheap, and
      // gives every white key a soft top-to-bottom shade so they read
      // as slightly domed/glossy rather than flat rectangles.
      const whiteKeyGradient = ctx.createLinearGradient(
        0,
        keyboardY,
        0,
        keyboardY + whiteKeyHeight
      );
      whiteKeyGradient.addColorStop(0, "#ffffff");
      whiteKeyGradient.addColorStop(0.85, "#e9e9ea");
      whiteKeyGradient.addColorStop(1, "#d8d9db");

      for (let i = 0; i < whiteKeyMidi.length; i++) {
        const x = i * whiteKeyWidth;
        const gap = Math.min(1, whiteKeyWidth * 0.04);

        ctx.fillStyle = whiteKeyGradient;
        fillRoundedRect(
          ctx,
          x + gap / 2,
          keyboardY,
          whiteKeyWidth - gap,
          whiteKeyHeight,
          { tl: 0, tr: 0, br: whiteKeyRadius, bl: whiteKeyRadius }
        );

        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        strokeRoundedRect(
          ctx,
          x + gap / 2,
          keyboardY,
          whiteKeyWidth - gap,
          whiteKeyHeight,
          { tl: 0, tr: 0, br: whiteKeyRadius, bl: whiteKeyRadius }
        );
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
        fillRoundedRect(
          ctx,
          x + whiteKeyWidth * 0.05,
          keyboardY,
          whiteKeyWidth * 0.9,
          keyboardHeight,
          { tl: 0, tr: 0, br: whiteKeyRadius, bl: whiteKeyRadius }
        );
      }

      // =====================================================
      // 3. DRAW BLACK KEYS (positioned correctly)
      // =====================================================

      // Dark gradient with a bright "shine" band near the bottom to
      // mimic the glossy reflection real black keys catch near the
      // front edge.
      const blackKeyGradient = ctx.createLinearGradient(
        0,
        keyboardY,
        0,
        keyboardY + blackKeyHeight
      );
      blackKeyGradient.addColorStop(0, "#3a3a3d");
      blackKeyGradient.addColorStop(0.55, "#111113");
      blackKeyGradient.addColorStop(0.8, "#050506");
      blackKeyGradient.addColorStop(0.9, "#4a4a4e");
      blackKeyGradient.addColorStop(1, "#0a0a0b");

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

        ctx.fillStyle = blackKeyGradient;
        fillRoundedRect(
          ctx,
          x,
          keyboardY,
          blackNoteWidth,
          blackKeyHeight,
          { tl: 0, tr: 0, br: blackKeyRadius, bl: blackKeyRadius }
        );

        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 1;
        strokeRoundedRect(
          ctx,
          x,
          keyboardY,
          blackNoteWidth,
          blackKeyHeight,
          { tl: 0, tr: 0, br: blackKeyRadius, bl: blackKeyRadius }
        );
      }

      // =====================================================
      // 3b. HIGHLIGHT ACTIVE BLACK KEYS (drawn on top of everything)
      // =====================================================
      for (const note of activeNotes) {
        const midi = note.note;
        if (!isBlackKey(midi)) continue;

        const key = getKeyGeometry(
          midi,
          whiteKeyWidth,
          whiteKeyMap,
          BLACK_WIDTH_RATIO
        );
        const x = key.x;

        ctx.fillStyle = note.hand === "left" ? "#ff8a65" : "#0b76b3";
        fillRoundedRect(
          ctx,
          x + blackNoteWidth * 0.05,
          keyboardY,
          blackNoteWidth * 0.9,
          blackKeyHeight,
          { tl: 0, tr: 0, br: blackKeyRadius, bl: blackKeyRadius }
        );
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [midiData, audioRef, offset]);

  return (
    <canvas
      ref={canvasRef}
      className="piano-roll-canvas"
    />
  );
}

export default PianoRollCanvas;