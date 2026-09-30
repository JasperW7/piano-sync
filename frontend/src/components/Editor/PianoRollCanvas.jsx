import { useEffect, useRef, useCallback } from "react";

const NOTE_NAMES = ["A","A#","B","C","C#","D","D#","E","F","F#","G","G#"];

const BLACK_WIDTH_RATIO = 0.6;
const BLACK_HEIGHT_RATIO = 0.6;
const PIXELS_PER_SECOND = 140;
const EDGE_THRESHOLD = 8;
const MIN_NOTE_DURATION = 0.05;

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

function snapToGrid(time, tempo, subdivision) {
  if (!tempo || !subdivision) return time;
  const beatDuration = 60 / tempo;
  const gridInterval = beatDuration / (subdivision / 4);
  return Math.round(time / gridInterval) * gridInterval;
}

function PianoRollCanvas({
  midiData, audioRef, offset, showNoteLabels,
  tempo, showLeftHand, showRightHand,
  selectedNoteIds, onSelectNote, onEditNote, onAddNote,
}) {
  const canvasRef = useRef(null);
  const firstVisibleIndex = useRef(0);
  const noteRectsRef = useRef([]);
  const layoutRef = useRef({
    whiteKeyWidth: 0, whiteKeyMap: new Map(), whiteKeyMidi: [], playLine: 0,
  });
  const interactionRef = useRef({
    mode: "idle",
    frozenTime: 0,
    targetNoteId: null,
    originalNote: null,
    previewNote: null,
    dragStartY: 0,
    didPauseForEdit: false,
  });

  const gridSubdivision = 4;

  const yToTime = useCallback((mouseY) => {
    const { playLine } = layoutRef.current;
    const frozenTime = interactionRef.current.frozenTime;
    return frozenTime + (playLine - mouseY) / PIXELS_PER_SECOND;
  }, []);

  const xToPitch = useCallback((mouseX) => {
    const { whiteKeyWidth, whiteKeyMidi, whiteKeyMap } = layoutRef.current;
    for (let midi = 21; midi <= 108; midi++) {
      if (!isBlackKey(midi)) continue;
      const geo = getKeyGeometry(midi, whiteKeyWidth, whiteKeyMap, BLACK_WIDTH_RATIO);
      if (mouseX >= geo.x && mouseX < geo.x + geo.width) return midi;
    }
    const whiteIndex = Math.floor(mouseX / whiteKeyWidth);
    if (whiteIndex >= 0 && whiteIndex < whiteKeyMidi.length) {
      return whiteKeyMidi[whiteIndex];
    }
    return null;
  }, []);

  const getMousePos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      mx: e.clientX - rect.left,
      my: e.clientY - rect.top,
    };
  }, []);

  const hitTestNote = useCallback((mx, my) => {
    const rects = noteRectsRef.current;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) {
        const nearTop = my - r.y < EDGE_THRESHOLD;
        const nearBottom = (r.y + r.height) - my < EDGE_THRESHOLD;
        return { id: r.id, noteObj: r.noteObj, nearTop, nearBottom };
      }
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { mx, my } = getMousePos(e);
    const { playLine } = layoutRef.current;

    if (my > playLine) return;

    const audio = audioRef.current;
    const frozenTime = audio ? audio.currentTime + Number(offset) : 0;
    interactionRef.current.frozenTime = frozenTime;

    if (audio && !audio.paused) {
      audio.pause();
      interactionRef.current.didPauseForEdit = true;
    }

    const hit = hitTestNote(mx, my);

    if (hit) {
      if (hit.nearTop && selectedNoteIds.has(hit.id)) {
        interactionRef.current.mode = "resize_top";
        interactionRef.current.targetNoteId = hit.id;
        interactionRef.current.originalNote = { ...hit.noteObj };
        interactionRef.current.previewNote = { ...hit.noteObj };
        interactionRef.current.dragStartY = my;
      } else if (hit.nearBottom && selectedNoteIds.has(hit.id)) {
        interactionRef.current.mode = "resize_bot";
        interactionRef.current.targetNoteId = hit.id;
        interactionRef.current.originalNote = { ...hit.noteObj };
        interactionRef.current.previewNote = { ...hit.noteObj };
        interactionRef.current.dragStartY = my;
      } else {
        interactionRef.current.mode = "idle";
        if (e.shiftKey) {
          const newSet = new Set(selectedNoteIds);
          if (newSet.has(hit.id)) {
            newSet.delete(hit.id);
          } else {
            newSet.add(hit.id);
          }
          onSelectNote(newSet);
        } else {
          onSelectNote(new Set([hit.id]));
        }
      }
    } else {
      if (!e.shiftKey) {
        onSelectNote(new Set());
      }

      const pitch = xToPitch(mx);
      if (pitch == null) return;

      const time = snapToGrid(yToTime(my), tempo, gridSubdivision);

      let hand = "right";
      if (showLeftHand && !showRightHand) hand = "left";

      interactionRef.current.mode = "adding";
      interactionRef.current.previewNote = {
        note: pitch,
        start: time,
        duration: 0,
        velocity: 80,
        hand,
        track: 0,
      };
      interactionRef.current.dragStartY = my;
    }
  }, [audioRef, offset, hitTestNote, getMousePos, selectedNoteIds, onSelectNote, xToPitch, yToTime, tempo, showLeftHand, showRightHand]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { mx, my } = getMousePos(e);
    const mode = interactionRef.current.mode;

    if (mode === "idle") {
      const { playLine } = layoutRef.current;
      if (my > playLine) {
        canvas.style.cursor = "default";
        return;
      }
      const hit = hitTestNote(mx, my);
      if (hit) {
        if ((hit.nearTop || hit.nearBottom) && selectedNoteIds.has(hit.id)) {
          canvas.style.cursor = "ns-resize";
        } else {
          canvas.style.cursor = "pointer";
        }
      } else {
        canvas.style.cursor = "crosshair";
      }
      return;
    }

    if (mode === "resize_top") {
      const orig = interactionRef.current.originalNote;
      const rawTime = yToTime(my);
      const snappedEnd = snapToGrid(rawTime, tempo, gridSubdivision);
      const newDuration = Math.max(MIN_NOTE_DURATION, snappedEnd - orig.start);
      interactionRef.current.previewNote = {
        ...orig,
        duration: newDuration,
      };
      return;
    }

    if (mode === "resize_bot") {
      const orig = interactionRef.current.originalNote;
      const rawTime = yToTime(my);
      const snappedStart = snapToGrid(rawTime, tempo, gridSubdivision);
      const origEnd = orig.start + orig.duration;
      const newDuration = Math.max(MIN_NOTE_DURATION, origEnd - snappedStart);
      const newStart = origEnd - newDuration;
      interactionRef.current.previewNote = {
        ...orig,
        start: newStart,
        duration: newDuration,
      };
      return;
    }

    if (mode === "adding") {
      const preview = interactionRef.current.previewNote;
      const rawTime = yToTime(my);
      const snappedTime = snapToGrid(rawTime, tempo, gridSubdivision);
      const anchorTime = snapToGrid(preview.start, tempo, gridSubdivision);

      const startTime = Math.min(anchorTime, snappedTime);
      const endTime = Math.max(anchorTime, snappedTime);
      const duration = Math.max(MIN_NOTE_DURATION, endTime - startTime);

      interactionRef.current.previewNote = {
        ...preview,
        start: startTime,
        duration,
      };
      return;
    }
  }, [getMousePos, hitTestNote, yToTime, tempo, selectedNoteIds]);

  const handleMouseUp = useCallback(() => {
    const mode = interactionRef.current.mode;
    const preview = interactionRef.current.previewNote;

    if (mode === "resize_top" || mode === "resize_bot") {
      if (preview) {
        onEditNote(interactionRef.current.targetNoteId, {
          start: preview.start,
          duration: preview.duration,
        });
      }
    }

    if (mode === "adding") {
      if (preview && preview.duration >= MIN_NOTE_DURATION) {
        onAddNote(preview);
      }
    }

    interactionRef.current.mode = "idle";
    interactionRef.current.targetNoteId = null;
    interactionRef.current.originalNote = null;
    interactionRef.current.previewNote = null;
    interactionRef.current.didPauseForEdit = false;
  }, [onEditNote, onAddNote]);

  const handleMouseLeave = useCallback(() => {
    interactionRef.current.mode = "idle";
    interactionRef.current.targetNoteId = null;
    interactionRef.current.originalNote = null;
    interactionRef.current.previewNote = null;
    interactionRef.current.didPauseForEdit = false;
  }, []);

  useEffect(() => {
    firstVisibleIndex.current = 0;
  }, [midiData]);

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

    const render = () => {
      const audio = audioRef.current;

      if (!audio || canvas.width === 0 || canvas.height === 0) {
        animationId = requestAnimationFrame(render);
        return;
      }

      const currentTime = audio.currentTime + Number(offset);
      const playLine = canvas.height * 0.75;

      const whiteKeyMidi = [];
      for (let midi = 21; midi <= 108; midi++) {
        if (!isBlackKey(midi)) whiteKeyMidi.push(midi);
      }

      const whiteKeyWidth = canvas.width / whiteKeyMidi.length;

      const whiteKeyMap = new Map();
      whiteKeyMidi.forEach((midi, i) => whiteKeyMap.set(midi, i));

      layoutRef.current = { whiteKeyWidth, whiteKeyMap, whiteKeyMidi, playLine };

      const blackNoteWidth = whiteKeyWidth * BLACK_WIDTH_RATIO;
      const noteRadius = Math.min(7, whiteKeyWidth * 0.35);

      if (
        firstVisibleIndex.current >= midiData.length ||
        (
          firstVisibleIndex.current > 0 &&
          midiData[firstVisibleIndex.current]?.start > currentTime
        )
      ) {
        firstVisibleIndex.current = 0;
      }

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

      // ===== GRID LINES =====
      if (tempo && gridSubdivision) {
        const beatDuration = 60 / tempo;
        const gridInterval = beatDuration / (gridSubdivision / 4);
        const viewStart = currentTime - (playLine / PIXELS_PER_SECOND);
        const viewEnd = currentTime + 5;
        const startBeat = Math.floor(viewStart / gridInterval);
        const endBeat = Math.ceil(viewEnd / gridInterval);

        ctx.lineWidth = 1;
        for (let i = startBeat; i <= endBeat; i++) {
          const beatTime = i * gridInterval;
          const y = playLine - (beatTime - currentTime) * PIXELS_PER_SECOND;
          if (y < 0 || y > playLine) continue;

          const isDownbeat = Math.abs((beatTime % beatDuration)) < 0.001 ||
            Math.abs((beatTime % beatDuration) - beatDuration) < 0.001;
          ctx.strokeStyle = isDownbeat
            ? "rgba(255,255,255,0.12)"
            : "rgba(255,255,255,0.04)";

          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      // ===== DRAW NOTES =====
      const frameNoteRects = [];

      for (
        let i = firstVisibleIndex.current;
        i < midiData.length;
        i++
      ) {
        const note = midiData[i];

        if (note.start > currentTime + 5) break;

        if (note.hand === "left" && !showLeftHand) continue;
        if (note.hand === "right" && !showRightHand) continue;

        // Skip the note being resized — we'll draw the preview instead
        if (
          (interactionRef.current.mode === "resize_top" ||
            interactionRef.current.mode === "resize_bot") &&
          note.id === interactionRef.current.targetNoteId
        ) {
          continue;
        }

        const key = getKeyGeometry(
          note.note,
          whiteKeyWidth,
          whiteKeyMap,
          BLACK_WIDTH_RATIO
        );

        const width = key.width * 0.95;
        const x = key.x + (key.width - width) / 2;

        const height = note.duration * PIXELS_PER_SECOND;
        let y = playLine - (note.start - currentTime) * PIXELS_PER_SECOND - height;
        let drawHeight = height;

        if (y + drawHeight > playLine) {
          drawHeight = playLine - y;
        }
        if (drawHeight <= 0) continue;

        const r = Math.min(noteRadius, width / 2, drawHeight / 2);

        ctx.fillStyle = getNoteColor(note);
        fillRoundedRect(ctx, x, y, width, drawHeight, r);

        if (drawHeight > 6) {
          const glossHeight = Math.min(drawHeight * 0.4, 10);
          const gloss = ctx.createLinearGradient(0, y, 0, y + glossHeight);
          gloss.addColorStop(0, "rgba(255,255,255,0.35)");
          gloss.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gloss;
          fillRoundedRect(ctx, x, y, width, glossHeight, { tl: r, tr: r, br: 0, bl: 0 });
        }

        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1;
        strokeRoundedRect(ctx, x, y, width, drawHeight, r);

        // Selection highlight
        if (selectedNoteIds.has(note.id)) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 2;
          strokeRoundedRect(ctx, x - 1, y - 1, width + 2, drawHeight + 2, r + 1);

          // Resize handles
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.fillRect(x + 2, y, width - 4, 3);
          ctx.fillRect(x + 2, y + drawHeight - 3, width - 4, 3);
        }

        if (showNoteLabels && drawHeight > 14) {
          const name = NOTE_NAMES[(note.note - 21) % 12];
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.font = `bold ${Math.min(11, width * 0.65)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(name, x + width / 2, y + drawHeight - 3);
        }

        frameNoteRects.push({ id: note.id, x, y, width, height: drawHeight, noteObj: note });
      }

      // ===== PREVIEW NOTE (during drag) =====
      const preview = interactionRef.current.previewNote;
      if (preview && interactionRef.current.mode !== "idle") {
        const key = getKeyGeometry(
          preview.note,
          whiteKeyWidth,
          whiteKeyMap,
          BLACK_WIDTH_RATIO
        );

        const width = key.width * 0.95;
        const x = key.x + (key.width - width) / 2;
        const height = preview.duration * PIXELS_PER_SECOND;

        const frozenTime = interactionRef.current.frozenTime;
        let y = playLine - (preview.start - frozenTime) * PIXELS_PER_SECOND - height;
        let drawHeight = height;

        if (y + drawHeight > playLine) drawHeight = playLine - y;
        if (drawHeight > 0) {
          const r = Math.min(noteRadius, width / 2, drawHeight / 2);

          ctx.fillStyle = interactionRef.current.mode === "adding"
            ? "rgba(100,200,255,0.35)"
            : getNoteColor(preview);
          fillRoundedRect(ctx, x, y, width, drawHeight, r);

          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = 2;
          strokeRoundedRect(ctx, x, y, width, drawHeight, r);
          ctx.setLineDash([]);
        }
      }

      noteRectsRef.current = frameNoteRects;

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

      const whiteKeyGradient = ctx.createLinearGradient(0, keyboardY, 0, keyboardY + whiteKeyHeight);
      whiteKeyGradient.addColorStop(0, "#ffffff");
      whiteKeyGradient.addColorStop(0.85, "#e9e9ea");
      whiteKeyGradient.addColorStop(1, "#d8d9db");

      for (let i = 0; i < whiteKeyMidi.length; i++) {
        const x = i * whiteKeyWidth;
        const gap = Math.min(1, whiteKeyWidth * 0.04);

        ctx.fillStyle = whiteKeyGradient;
        fillRoundedRect(ctx, x + gap / 2, keyboardY, whiteKeyWidth - gap, whiteKeyHeight, { tl: 0, tr: 0, br: whiteKeyRadius, bl: whiteKeyRadius });

        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        strokeRoundedRect(ctx, x + gap / 2, keyboardY, whiteKeyWidth - gap, whiteKeyHeight, { tl: 0, tr: 0, br: whiteKeyRadius, bl: whiteKeyRadius });
      }

      // Active notes (for keyboard highlights)
      const activeNotes = [];
      {
        let idx = firstVisibleIndex.current;
        while (idx < midiData.length && midiData[idx].start <= currentTime) {
          const note = midiData[idx];
          if (
            currentTime >= note.start &&
            currentTime <= note.start + note.duration
          ) {
            if ((note.hand === "left" && showLeftHand) || (note.hand === "right" && showRightHand)) {
              activeNotes.push(note);
            }
          }
          idx++;
        }
      }

      // Active white key highlights
      for (const note of activeNotes) {
        const midi = note.note;
        if (isBlackKey(midi)) continue;

        const whiteIndex = whiteKeyMap.get(midi);
        const x = whiteIndex * whiteKeyWidth;

        ctx.fillStyle = note.hand === "left" ? "#ff8a65" : "#0b76b3";
        fillRoundedRect(ctx, x + whiteKeyWidth * 0.05, keyboardY, whiteKeyWidth * 0.9, keyboardHeight, { tl: 0, tr: 0, br: whiteKeyRadius, bl: whiteKeyRadius });
      }

      // Black keys
      const blackKeyGradient = ctx.createLinearGradient(0, keyboardY, 0, keyboardY + blackKeyHeight);
      blackKeyGradient.addColorStop(0, "#3a3a3d");
      blackKeyGradient.addColorStop(0.55, "#111113");
      blackKeyGradient.addColorStop(0.8, "#050506");
      blackKeyGradient.addColorStop(0.9, "#4a4a4e");
      blackKeyGradient.addColorStop(1, "#0a0a0b");

      for (let midi = 21; midi <= 108; midi++) {
        if (!isBlackKey(midi)) continue;

        const prevWhite = midi - 1;
        const nextWhite = midi + 1;

        let baseWhiteIndex = whiteKeyMap.get(prevWhite);
        if (baseWhiteIndex === undefined) {
          baseWhiteIndex = whiteKeyMap.get(nextWhite) - 1;
        }

        const x = (baseWhiteIndex + 1) * whiteKeyWidth - blackNoteWidth / 2;

        ctx.fillStyle = blackKeyGradient;
        fillRoundedRect(ctx, x, keyboardY, blackNoteWidth, blackKeyHeight, { tl: 0, tr: 0, br: blackKeyRadius, bl: blackKeyRadius });

        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 1;
        strokeRoundedRect(ctx, x, keyboardY, blackNoteWidth, blackKeyHeight, { tl: 0, tr: 0, br: blackKeyRadius, bl: blackKeyRadius });
      }

      // Active black key highlights
      for (const note of activeNotes) {
        const midi = note.note;
        if (!isBlackKey(midi)) continue;

        const key = getKeyGeometry(midi, whiteKeyWidth, whiteKeyMap, BLACK_WIDTH_RATIO);
        const x = key.x;

        ctx.fillStyle = note.hand === "left" ? "#ff8a65" : "#0b76b3";
        fillRoundedRect(ctx, x + blackNoteWidth * 0.05, keyboardY, blackNoteWidth * 0.9, blackKeyHeight, { tl: 0, tr: 0, br: blackKeyRadius, bl: blackKeyRadius });
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [midiData, audioRef, offset, showNoteLabels, tempo, showLeftHand, showRightHand, selectedNoteIds]);

  return (
    <canvas
      ref={canvasRef}
      className="piano-roll-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}

export default PianoRollCanvas;
