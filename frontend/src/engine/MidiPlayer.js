const LOOKAHEAD = 0.15;

export default class MidiPlayer extends EventTarget {
  constructor(audioContext, instrument, midiData) {
    super();
    this._ctx = audioContext;
    this._instrument = instrument;
    this._midiData = midiData;
    this._duration = midiData.length
      ? Math.max(...midiData.map((n) => n.start + n.duration)) + 0.5
      : 0;

    this._gainNode = this._ctx.createGain();
    this._gainNode.connect(this._ctx.destination);
    this._instrument.connect(this._gainNode);

    this._currentTime = 0;
    this._paused = true;
    this._playbackRate = 1;
    this._lastWallTime = 0;
    this._nextNoteIndex = 0;
    this._activeNodes = [];
    this._rafId = null;

    this.isMidiPlayer = true;
  }

  get audioContext() {
    return this._ctx;
  }

  get gainNode() {
    return this._gainNode;
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(t) {
    const clamped = Math.max(0, Math.min(t, this._duration));
    this.dispatchEvent(new Event("seeking"));
    this._stopAllNotes();
    this._currentTime = clamped;
    this._nextNoteIndex = this._findNoteIndex(clamped);
    this._lastWallTime = performance.now();
    this.dispatchEvent(new Event("seeked"));
  }

  get duration() {
    return this._duration;
  }

  get paused() {
    return this._paused;
  }

  get playbackRate() {
    return this._playbackRate;
  }

  set playbackRate(rate) {
    this._playbackRate = rate;
  }

  play() {
    if (!this._paused) return;

    if (this._currentTime >= this._duration) {
      this._currentTime = 0;
      this._nextNoteIndex = 0;
    }

    if (this._ctx.state === "suspended") {
      this._ctx.resume();
    }

    this._paused = false;
    this._lastWallTime = performance.now();
    this._tick();
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    if (this._paused) return;
    this._paused = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._stopAllNotes();
    this.dispatchEvent(new Event("pause"));
  }

  dispose() {
    this.pause();
    this._activeNodes = [];
    this._gainNode.disconnect();
  }

  updateMidiData(newData) {
    this._stopAllNotes();
    this._midiData = newData;
    this._duration = newData.length
      ? Math.max(...newData.map((n) => n.start + n.duration)) + 0.5
      : 0;
    this._nextNoteIndex = this._findNoteIndex(this._currentTime);
  }

  _tick = () => {
    if (this._paused) return;

    const now = performance.now();
    const delta = ((now - this._lastWallTime) / 1000) * this._playbackRate;
    this._lastWallTime = now;
    this._currentTime += delta;

    if (this._currentTime >= this._duration) {
      this._currentTime = this._duration;
      this._paused = true;
      this._stopAllNotes();
      this.dispatchEvent(new Event("ended"));
      return;
    }

    this._scheduleNotes();
    this._pruneFinished();
    this._rafId = requestAnimationFrame(this._tick);
  };

  _scheduleNotes() {
    const data = this._midiData;
    const horizon = this._currentTime + LOOKAHEAD * this._playbackRate;

    while (this._nextNoteIndex < data.length) {
      const note = data[this._nextNoteIndex];
      if (note.start > horizon) break;

      if (note.start + note.duration > this._currentTime) {
        const delay = (note.start - this._currentTime) / this._playbackRate;
        const acTime = this._ctx.currentTime + Math.max(0, delay);
        const adjustedDuration = note.duration / this._playbackRate;

        const played = this._instrument.play(String(note.note), acTime, {
          duration: adjustedDuration,
          gain: (note.velocity / 127) * 0.8,
        });

        this._activeNodes.push({
          node: played,
          endTime: note.start + note.duration,
        });
      }

      this._nextNoteIndex++;
    }
  }

  _pruneFinished() {
    this._activeNodes = this._activeNodes.filter(
      (a) => a.endTime > this._currentTime
    );
  }

  _stopAllNotes() {
    for (const a of this._activeNodes) {
      try {
        if (a.node && a.node.stop) a.node.stop();
      } catch (_) {}
    }
    this._activeNodes = [];
  }

  _findNoteIndex(time) {
    const data = this._midiData;
    let lo = 0;
    let hi = data.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (data[mid].start + data[mid].duration <= time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
