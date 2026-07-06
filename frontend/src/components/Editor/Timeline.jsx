import { useEffect, useState } from "react";

function Timeline({ audioRef }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    let animationId;

    const update = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime || 0);
        setDuration(audioRef.current.duration || 0);
      }

      animationId = requestAnimationFrame(update);
    };

    update();

    return () => cancelAnimationFrame(animationId);
  }, [audioRef]);

  const progress =
    duration > 0 ? (currentTime / duration) * 100 : 0;

  const formatTime = (time) => {
    if (!time || isNaN(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };
  const seek = (e) => {
    if (!audioRef.current || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;

    audioRef.current.currentTime = percent * duration;
  };
  useEffect(() => {
    const stopDrag = () => setIsDragging(false);

    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
    }, []);

  return (
    <div className="editor-timeline">
        <div
        className="timeline-progress"
        onMouseDown={(e) => {
            setIsDragging(true);
            seek(e);
        }}
        onMouseMove={(e) => {
            if (!isDragging) return;
            seek(e);
        }}
        onMouseUp={() => {
            setIsDragging(false);
        }}
        onMouseLeave={() => {
            setIsDragging(false);
        }}
        >
        <div
          className="timeline-fill"
          style={{ width: `${progress}%` }}
        />

        <div
          className="timeline-thumb"
          style={{ left: `${progress}%` }}
        />
      </div>

      <div className="timeline-times">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export default Timeline;