import axios from "axios";
import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

function LyricsPanel({
  songInfo,
  setSongInfo,
  audioFile,
  lyricsText,
  setLyricsText,
  lyricsOriginal,
  setLyricsOriginal,
  syncedLyrics,
  setSyncedLyrics,
  lyricsStep,
  setLyricsStep,
}) {
  const [title, setTitle] = useState(songInfo?.title || "");
  const [artist, setArtist] = useState(songInfo?.artist || "");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [detectedLang, setDetectedLang] = useState(null);
  const [error, setError] = useState(null);
  const [alignMethod, setAlignMethod] = useState(null);

  const isIdentifying = lyricsStep === "identifying";
  const isFetching = lyricsStep === "fetching";
  const isAligning = lyricsStep === "aligning";
  const busy = isIdentifying || isFetching || isAligning;

  if (songInfo && !title && !artist) {
    setTitle(songInfo.title || "");
    setArtist(songInfo.artist || "");
  }

  const fetchLyrics = async () => {
    setError(null);
    setLyricsStep("fetching");
    try {
      const res = await axios.post(`${API}/lyrics`, { title, artist });
      setLyricsText(res.data.lyrics);
      setLyricsOriginal(res.data.lyrics_original);
      setDetectedLang(res.data.detected_language);
      setLyricsStep(null);
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to fetch lyrics";
      setError(msg);
      setLyricsStep(null);
    }
  };

  const submitPasted = async () => {
    if (!pasteText.trim()) return;
    setError(null);
    setLyricsStep("fetching");
    try {
      const res = await axios.post(`${API}/lyrics`, {
        lyrics_text: pasteText,
        title,
        artist,
      });
      setLyricsText(res.data.lyrics);
      setLyricsOriginal(res.data.lyrics_original);
      setDetectedLang(res.data.detected_language);
      setPasteMode(false);
      setLyricsStep(null);
    } catch (err) {
      setError("Failed to process pasted lyrics");
      setLyricsStep(null);
    }
  };

  const alignLyrics = async () => {
    if (!audioFile) {
      setError("Upload an audio file first");
      return;
    }
    setError(null);
    setLyricsStep("aligning");
    try {
      const payload = { audio_file: audioFile, title, artist };
      if (lyricsOriginal) {
        payload.lyrics_text = lyricsOriginal;
      } else if (lyricsText) {
        payload.lyrics_text = lyricsText;
      }
      const res = await axios.post(`${API}/lyrics/synced`, payload, {
        timeout: 600000,
      });
      setSyncedLyrics(res.data.lines);
      setAlignMethod(res.data.alignment_method);
      setLyricsStep(null);
    } catch (err) {
      const msg = err.response?.data?.error || "Alignment failed";
      setError(msg);
      setLyricsStep(null);
    }
  };

  return (
    <div className="lyrics-panel">
      <div className="lyrics-panel-header">Lyrics</div>

      {/* Song info fields */}
      <div className="lyrics-fields">
        <input
          className="lyrics-input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
        <input
          className="lyrics-input"
          placeholder="Artist"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          disabled={busy}
        />
      </div>

      {isIdentifying && (
        <div className="lyrics-status">Identifying song...</div>
      )}

      {/* Action buttons */}
      {!lyricsText && !syncedLyrics && (
        <div className="lyrics-actions">
          <button
            className="lyrics-btn"
            onClick={fetchLyrics}
            disabled={busy || (!title && !artist)}
          >
            {isFetching ? "Searching..." : "Fetch Lyrics"}
          </button>
          <button
            className="lyrics-btn lyrics-btn-secondary"
            onClick={() => setPasteMode((v) => !v)}
            disabled={busy}
          >
            {pasteMode ? "Cancel" : "Paste Lyrics"}
          </button>
        </div>
      )}

      {/* Paste textarea */}
      {pasteMode && !lyricsText && (
        <div className="lyrics-paste">
          <textarea
            className="lyrics-textarea"
            placeholder="Paste Japanese or romaji lyrics here..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
          />
          <button
            className="lyrics-btn"
            onClick={submitPasted}
            disabled={!pasteText.trim() || busy}
          >
            Use These Lyrics
          </button>
        </div>
      )}

      {/* Fetched/processed lyrics display */}
      {lyricsText && !syncedLyrics && (
        <div className="lyrics-preview">
          {detectedLang && (
            <span className="lyrics-lang-badge">
              {detectedLang === "japanese" ? "Japanese" : "Romaji"}
            </span>
          )}
          {detectedLang === "romaji" && (
            <span className="lyrics-note">
              Romaji detected — will use Whisper alignment
            </span>
          )}
          <textarea
            className="lyrics-textarea"
            value={lyricsText}
            onChange={(e) => setLyricsText(e.target.value)}
            rows={8}
          />
          <div className="lyrics-actions">
            <button
              className="lyrics-btn"
              onClick={alignLyrics}
              disabled={busy || !audioFile}
            >
              {isAligning ? "Aligning..." : "Align to Audio"}
            </button>
            <button
              className="lyrics-btn lyrics-btn-secondary"
              onClick={() => {
                setLyricsText(null);
                setLyricsOriginal(null);
                setDetectedLang(null);
              }}
              disabled={busy}
            >
              Clear
            </button>
          </div>
          {isAligning && (
            <div className="lyrics-status">
              Aligning lyrics to audio... this may take 1-2 minutes
            </div>
          )}
        </div>
      )}

      {/* Synced lyrics result */}
      {syncedLyrics && (
        <div className="lyrics-synced">
          {alignMethod && (
            <span className="lyrics-lang-badge">
              Aligned via {alignMethod.toUpperCase()}
            </span>
          )}
          <div className="lyrics-synced-list">
            {syncedLyrics.map((line, i) => (
              <div key={i} className="lyrics-synced-line">
                <span className="lyrics-time">
                  {line.start != null
                    ? `${line.start.toFixed(1)}s`
                    : "—"}
                </span>
                <span className="lyrics-text">{line.lyric}</span>
              </div>
            ))}
          </div>
          <button
            className="lyrics-btn lyrics-btn-secondary"
            onClick={() => {
              setSyncedLyrics(null);
              setAlignMethod(null);
            }}
          >
            Re-align
          </button>
        </div>
      )}

      {error && <div className="lyrics-error">{error}</div>}
    </div>
  );
}

export default LyricsPanel;
