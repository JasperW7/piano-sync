import { useState, useRef, useEffect } from "react";

function Toolbar({
  audioRef,
  offset,
  speed,
  setOffset,
  setSpeed,
}) {
  const [openMenu, setOpenMenu] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const closeTimeout = useRef(null);
  const [volume, setVolume] = useState(1);

  // sync play state properly
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const update = () => setIsPlaying(!audio.paused);

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

  const handleEnter = (menu) => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    setOpenMenu(menu);
  };

  const handleLeave = () => {
    closeTimeout.current = setTimeout(() => {
      setOpenMenu(null);
    }, 150);
  };

  return (
    <div className="editor-toolbar">

      {/* LEFT */}
      <div className="toolbar-left">

        <button
          onClick={() => {
            if (!audioRef.current) return;
            audioRef.current.currentTime = 0;
          }}
        >
          ⏮
        </button>

        <button
          onClick={() => {
            if (!audioRef.current) return;

            if (audioRef.current.paused) {
              audioRef.current.play();
            } else {
              audioRef.current.pause();
            }
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

      </div>

      {/* RIGHT */}
      <div className="toolbar-right">

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
                  onChange={(e) =>
                    setSpeed(Number(e.target.value))
                  }
                />
                <div className="value">{speed.toFixed(2)}x</div>
              </div>
            </div>
          )}
        </div>

        {/* OFFSET */}
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
                  onChange={(e) =>
                    setOffset(Number(e.target.value))
                  }
                />
                <div className="value">{offset.toFixed(1)}s</div>
              </div>
            </div>
          )}
        </div>

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
                    max="1"
                    step="0.01"
                    value={volume}
                    onInput={(e)=>{
                        const v = Number(e.target.value);

                        setVolume(v);

                        if(audioRef.current){
                            audioRef.current.volume = v;
                        }
                    }}
                />

                <div className="value">
                    {Math.round(volume*100)}%
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default Toolbar;