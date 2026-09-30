import { useRef, useState, useEffect } from "react";
import MidiPlayer from "../engine/MidiPlayer";

export default function useMidiSynth(midiData, audioUrl) {
  const midiPlayerRef = useRef(null);
  const audioContextRef = useRef(null);
  const instrumentRef = useRef(null);
  const [synthReady, setSynthReady] = useState(false);
  const [synthLoading, setSynthLoading] = useState(false);

  const midiOnly = midiData.length > 0 && !audioUrl;

  if (!midiOnly && midiPlayerRef.current && !midiPlayerRef.current.paused) {
    midiPlayerRef.current.pause();
  }

  useEffect(() => {
    if (!midiOnly) {
      if (midiPlayerRef.current) {
        midiPlayerRef.current.dispose();
        midiPlayerRef.current = null;
      }
      setSynthReady(false);
      return;
    }

    let cancelled = false;
    setSynthLoading(true);

    async function init() {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      if (!instrumentRef.current) {
        const Soundfont = await import("soundfont-player");
        const instrument = await Soundfont.instrument(
          audioContextRef.current,
          "acoustic_grand_piano"
        );
        if (cancelled) return;
        instrumentRef.current = instrument;
      }

      if (midiPlayerRef.current) {
        midiPlayerRef.current.dispose();
      }

      const player = new MidiPlayer(
        audioContextRef.current,
        instrumentRef.current,
        midiData
      );
      midiPlayerRef.current = player;

      if (!cancelled) {
        setSynthReady(true);
        setSynthLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [midiOnly, midiData]);

  const prevMidiDataRef = useRef(midiData);
  useEffect(() => {
    if (prevMidiDataRef.current === midiData) return;
    prevMidiDataRef.current = midiData;
    if (midiOnly && midiPlayerRef.current && synthReady) {
      midiPlayerRef.current.updateMidiData(midiData);
    }
  }, [midiData, midiOnly, synthReady]);

  return { midiPlayerRef, midiOnly, synthReady, synthLoading };
}
