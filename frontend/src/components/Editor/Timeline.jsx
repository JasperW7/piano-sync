import { useEffect, useState, useRef } from "react";

function Timeline({ audioRef }) {
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const currentLabelRef = useRef(null);
  const durationLabelRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const timelineRef = useRef(null);
  useEffect(() => {
    let animationId;

    const update = () => {

    const audio = audioRef.current;

        if(audio){

            const current = audio.currentTime || 0;
            const duration = audio.duration || 0;

            const percent =
                duration
                ? current / duration * 100
                : 0;

            if (fillRef.current)
                fillRef.current.style.width = `${percent}%`;

            if (thumbRef.current)
                thumbRef.current.style.left = `${percent}%`;

            if (currentLabelRef.current)
                currentLabelRef.current.textContent = formatTime(current);

            if (durationLabelRef.current)
                durationLabelRef.current.textContent = formatTime(duration);
        }

        animationId=requestAnimationFrame(update);
    };

    update();

    return () => cancelAnimationFrame(animationId);
  }, [audioRef]);


  const formatTime = (time) => {
    if (!time || isNaN(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };
  const seek = (clientX) => {
    if (!audioRef.current || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();

    const percent = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width)
    );

    audioRef.current.currentTime =
        percent * audioRef.current.duration;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e) => {
        e.preventDefault();
        seek(e.clientX);
    };

    const handleUp = () => {
        setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging]);


  return (
    <div className="editor-timeline">
        <div
            ref={timelineRef}
            className="timeline-progress"
            onMouseDown={(e) => {
                setIsDragging(true);
                seek(e.clientX);
            }}
        >
        <div
            className={`timeline-bar ${isDragging ? "dragging" : ""}`}
        />   
        <div
          ref={fillRef}
          className="timeline-fill"
        />

        <div
          ref={thumbRef}
          className="timeline-thumb"
        />
      </div>
      <div className="timeline-times">
        <span ref={currentLabelRef}>
            0:00
        </span>

        <span ref={durationLabelRef}>
            0:00
        </span>
    </div>

    </div>
  );
}

export default Timeline;