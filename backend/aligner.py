import logging
import os

from forced_aligner import align_with_forced_aligner
from whisper_aligner import align_with_whisper

log = logging.getLogger(__name__)


def align_lyrics_to_audio(lyrics, audio_path):
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    try:
        return align_with_forced_aligner(lyrics, audio_path)
    except Exception as e:
        log.warning("Forced alignment failed: %s — falling back to Whisper", e)
        return align_with_whisper(lyrics, audio_path)
