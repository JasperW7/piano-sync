import UploadPanel from "./UploadPanel";

function Header({
  setMidiData,
  setTempo,
  setAudioUrl,
  setAudioFile,
  setSongInfo,
  setLyricsStep,
  showLyrics,
  setShowLyrics,
}) {
  return (
    <div className="app-header">
      <div className="logo">Piano Sync</div>

      <UploadPanel
        setMidiData={setMidiData}
        setTempo={setTempo}
        setAudioUrl={setAudioUrl}
        setAudioFile={setAudioFile}
        setSongInfo={setSongInfo}
        setLyricsStep={setLyricsStep}
        showLyrics={showLyrics}
      />

      <button
        className={`skip-lyrics-toggle ${!showLyrics ? "active" : ""}`}
        onClick={() => setShowLyrics((v) => !v)}
      >
        {showLyrics ? "Lyrics On" : "Lyrics Off"}
      </button>
    </div>
  );
}

export default Header;
