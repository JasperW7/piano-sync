import UploadPanel from "./UploadPanel";

function Header({ setMidiData, setAudioUrl }) {
  return (
    <div className="app-header">
      <div className="logo">Piano Sync</div>

      <UploadPanel
        setMidiData={setMidiData}
        setAudioUrl={setAudioUrl}
      />
    </div>
  );
}

export default Header;
