import { useState, useRef, useEffect } from "react";

function TransportBar({
  audioRef,
  audioContextRef,
  midiOnly,
  offset,
  speed,
  setOffset,
  setSpeed,
  loopA,
  loopB,
}) {
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const currentLabelRef = useRef(null);
  const durationLabelRef = useRef(null);
  const timelineRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  const loopARef = useRef(loopA);
  const loopBRef = useRef(loopB);
  loopARef.current = loopA;
  loopBRef.current = loopB;

  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const volumeRef = useRef(1);
  const [openMenu, setOpenMenu] = useState(null);
  const closeTimeout = useRef(null);

  const formatTime = (time) => {
    if (!time || isNaN(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // ----- Web Audio API for volume > 100% -----
  const prevAudioRef = useRef(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const changed = prevAudioRef.current !== audio;
    prevAudioRef.current = audio;

    if (audioContextRef.current && !changed) return;

    if (audio.isMidiPlayer) {
      audioContextRef.current = audio.audioContext;
      gainNodeRef.current = audio.gainNode;
    } else {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);

      audioContextRef.current = ctx;
      sourceNodeRef.current = source;
      gainNodeRef.current = gain;
    }

    gainNodeRef.current.gain.value = volumeRef.current;
  }, [audioRef]);

  // ----- slider progress loop -----
  useEffect(() => {
    let animationId;

    const update = () => {
      const audio = audioRef.current;

      if (audio) {
        const current = audio.currentTime || 0;
        const duration = audio.duration || 0;

        const a = loopARef.current;
        const b = loopBRef.current;
        if (a != null && b != null && current >= b && !audio.paused) {
          audio.currentTime = a;
        }

        const percent = duration ? (current / duration) * 100 : 0;

        if (fillRef.current) fillRef.current.style.width = `${percent}%`;
        if (thumbRef.current) thumbRef.current.style.left = `${percent}%`;

        if (currentLabelRef.current)
          currentLabelRef.current.textContent = formatTime(current);

        if (durationLabelRef.current)
          durationLabelRef.current.textContent = formatTime(duration);
      }

      animationId = requestAnimationFrame(update);
    };

    update();

    return () => cancelAnimationFrame(animationId);
  }, [audioRef]);

  // ----- play/pause state -----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnd = () => setIsPlaying(false);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioRef]);

  // ----- mute during seeks to prevent buzzing -----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onSeeking = () => {
      const gain = gainNodeRef.current;
      const ctx = audioContextRef.current;
      if (gain && ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
      }
    };

    const onSeeked = () => {
      const gain = gainNodeRef.current;
      const ctx = audioContextRef.current;
      if (gain && ctx) {
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(volumeRef.current, ctx.currentTime + 0.05);
      }
    };

    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onSeeked);

    return () => {
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [audioRef]);

  const seek = (clientX) => {
    if (!audioRef.current || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();

    const percent = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width)
    );

    audioRef.current.currentTime = percent * audioRef.current.duration;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e) => {
      e.preventDefault();
      seek(e.clientX);
    };

    const handleUp = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }

    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  };

  const handleEnter = (menu) => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    setOpenMenu(menu);
  };

  const handleLeave = () => {
    closeTimeout.current = setTimeout(() => setOpenMenu(null), 150);
  };

  return (
    <div className="transport-bar">
      {/* SLIDER */}
      <div
        ref={timelineRef}
        className="timeline-progress"
        onMouseDown={(e) => {
          setIsDragging(true);
          seek(e.clientX);
        }}
      >
        <div className={`timeline-bar ${isDragging ? "dragging" : ""}`} />
        {loopA != null && audioRef.current?.duration > 0 && (
          <div className="loop-marker loop-marker-a" style={{
            left: `${(loopA / audioRef.current.duration) * 100}%`,
          }} />
        )}
        {loopB != null && audioRef.current?.duration > 0 && (
          <div className="loop-marker loop-marker-b" style={{
            left: `${(loopB / audioRef.current.duration) * 100}%`,
          }} />
        )}
        <div ref={fillRef} className="timeline-fill" />
        <div ref={thumbRef} className="timeline-thumb" />
      </div>

      {/* CONTROLS ROW */}
      <div className="transport-row">
        <div className="transport-side transport-side-left" />

        <div className="transport-center">
          <span ref={currentLabelRef} className="transport-time">
            0:00
          </span>

          <button
            className="transport-restart"
            onClick={() => {
              if (!audioRef.current) return;
              audioRef.current.currentTime = 0;
            }}
          >
            ⏮
          </button>

          <button className="transport-play" onClick={togglePlay}>
            {isPlaying ? "⏸" : "▶"}
          </button>

          <span ref={durationLabelRef} className="transport-time">
            0:00
          </span>
        </div>

        <div className="transport-side transport-side-right">
          {/* SPEED */}
          <div
            className="icon-group"
            onMouseEnter={() => handleEnter("speed")}
            onMouseLeave={handleLeave}
          >
            <button>⚡</button>

            {openMenu === "speed" && (
              <div className="dropdown vertical">
                <label>Speed</label>

                <div className="slider-vertical">
                  <input
                    type="range"
                    min="0.25"
                    max="2"
                    step="0.05"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  />
                  <div className="value">{speed.toFixed(2)}x</div>
                </div>
              </div>
            )}
          </div>

          {/* OFFSET (hidden in MIDI-only mode) */}
          {!midiOnly && (
            <div
              className="icon-group"
              onMouseEnter={() => handleEnter("offset")}
              onMouseLeave={handleLeave}
            >
              <button>⏱</button>

              {openMenu === "offset" && (
                <div className="dropdown vertical">
                  <label>Offset</label>

                  <div className="slider-vertical">
                    <input
                      type="range"
                      min="-5"
                      max="5"
                      step="0.1"
                      value={offset}
                      onChange={(e) => setOffset(Number(e.target.value))}
                    />
                    <div className="value">{offset.toFixed(1)}s</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VOLUME */}
          <div
            className="icon-group"
            onMouseEnter={() => handleEnter("volume")}
            onMouseLeave={handleLeave}
          >
            <button>🔊</button>

            {openMenu === "volume" && (
              <div className="dropdown vertical">
                <label>Volume</label>

                <div className="slider-vertical">
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={volume}
                    onInput={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      volumeRef.current = v;
                      if (gainNodeRef.current) {
                        gainNodeRef.current.gain.value = v;
                      }
                    }}
                  />
                  <div className="value">{Math.round(volume * 100)}%</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TransportBar;
