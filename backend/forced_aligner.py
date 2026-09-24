import logging
import re

import torch
import torchaudio
from torchaudio.functional import forced_align

from text_utils import to_romaji

log = logging.getLogger(__name__)

FINETUNED_MODEL = "NextFire/mms-300m-ForcedAligner-karaoke-ja-Latn"
SAMPLE_RATE = 16000

_ft_model = None
_ft_processor = None
_mms_cache = None


# ── Text normalization ───────────────────────────────────────

def _normalize_transcript(text):
    text = text.lower()
    text = re.sub(r"[^a-z' ]", " ", text)
    text = re.sub(r" +", " ", text).strip()
    return text


# ── Audio loading ────────────────────────────────────────────

def _load_audio(audio_path):
    waveform, sr = torchaudio.load(audio_path, backend="ffmpeg")
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, sr, SAMPLE_RATE)
    return waveform


# ── Model loading ────────────────────────────────────────────

def _get_finetuned():
    global _ft_model, _ft_processor
    if _ft_model is None:
        from transformers import Wav2Vec2ForCTC, AutoProcessor
        log.info("Loading finetuned model: %s", FINETUNED_MODEL)
        _ft_processor = AutoProcessor.from_pretrained(FINETUNED_MODEL)
        _ft_model = Wav2Vec2ForCTC.from_pretrained(FINETUNED_MODEL)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _ft_model = _ft_model.to(device).eval()
        log.info("Model loaded on %s", device)
    return _ft_model, _ft_processor


def _get_mms_fa():
    global _mms_cache
    if _mms_cache is None:
        log.info("Loading MMS_FA model")
        bundle = torchaudio.pipelines.MMS_FA
        _mms_cache = {
            "model": bundle.get_model().eval(),
            "tokenizer": bundle.get_tokenizer(),
            "aligner": bundle.get_aligner(),
        }
    return _mms_cache


# ── Frame-to-time helpers ────────────────────────────────────

def _merge_token_spans(alignment, scores, blank=0):
    spans = []
    current_token = None
    start_frame = 0
    token_scores = []

    for i, (tok, score) in enumerate(zip(alignment, scores)):
        tok = tok.item()
        if tok == blank:
            if current_token is not None:
                spans.append({
                    "token": current_token,
                    "start": start_frame,
                    "end": i,
                    "score": sum(token_scores) / max(len(token_scores), 1),
                })
                current_token = None
                token_scores = []
            continue

        if tok != current_token:
            if current_token is not None:
                spans.append({
                    "token": current_token,
                    "start": start_frame,
                    "end": i,
                    "score": sum(token_scores) / max(len(token_scores), 1),
                })
            current_token = tok
            start_frame = i
            token_scores = [score.item()]
        else:
            token_scores.append(score.item())

    if current_token is not None:
        spans.append({
            "token": current_token,
            "start": start_frame,
            "end": len(alignment),
            "score": sum(token_scores) / max(len(token_scores), 1),
        })

    return spans


# ── Finetuned model alignment ────────────────────────────────

def _align_finetuned(original_lines, normalized_lines, waveform):
    model, processor = _get_finetuned()
    device = next(model.parameters()).device

    with torch.inference_mode():
        inputs = processor(
            waveform.squeeze(0),
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
        )
        input_values = inputs.input_values.to(device)
        logits = model(input_values).logits.cpu()
        log_probs = torch.log_softmax(logits, dim=-1)

    num_frames = log_probs.shape[1]
    ratio = waveform.shape[1] / num_frames

    all_tokens = []
    line_boundaries = []

    for norm in normalized_lines:
        tokens = processor.tokenizer.encode(norm, add_special_tokens=False)
        start = len(all_tokens)
        all_tokens.extend(tokens)
        line_boundaries.append((start, len(all_tokens)))

    if not all_tokens:
        raise RuntimeError("Tokenization produced no tokens")

    targets = torch.tensor([all_tokens], dtype=torch.int32)
    input_lengths = torch.tensor([num_frames])
    target_lengths = torch.tensor([len(all_tokens)])

    alignment, scores = forced_align(
        log_probs, targets, input_lengths, target_lengths, blank=0
    )

    token_spans = _merge_token_spans(alignment[0], scores[0].exp(), blank=0)

    return _spans_to_lines(
        original_lines, normalized_lines, line_boundaries,
        token_spans, ratio, SAMPLE_RATE, "forced_align",
    )


# ── MMS_FA alignment ────────────────────────────────────────

def _align_mms_fa(original_lines, normalized_lines, waveform):
    cache = _get_mms_fa()
    model = cache["model"]
    tokenizer = cache["tokenizer"]

    with torch.inference_mode():
        emission, _ = model(waveform)

    num_frames = emission.shape[1]
    ratio = waveform.shape[1] / num_frames

    all_tokens = []
    line_boundaries = []

    for norm in normalized_lines:
        tokens = tokenizer([norm])[0]
        start = len(all_tokens)
        all_tokens.extend(tokens)
        line_boundaries.append((start, len(all_tokens)))

    if not all_tokens:
        raise RuntimeError("Tokenization produced no tokens")

    targets = torch.tensor([all_tokens], dtype=torch.int32)
    input_lengths = torch.tensor([num_frames])
    target_lengths = torch.tensor([len(all_tokens)])

    alignment, scores = forced_align(
        emission, targets, input_lengths, target_lengths, blank=0
    )

    token_spans = _merge_token_spans(alignment[0], scores[0].exp(), blank=0)

    return _spans_to_lines(
        original_lines, normalized_lines, line_boundaries,
        token_spans, ratio, SAMPLE_RATE, "mms_fa",
    )


# ── Map token spans to lyric lines ───────────────────────────

def _spans_to_lines(
    original_lines, normalized_lines, line_boundaries,
    token_spans, ratio, sample_rate, source,
):
    results = []
    span_idx = 0

    for i, (tok_start, tok_end) in enumerate(line_boundaries):
        num_tokens = tok_end - tok_start

        if num_tokens == 0 or span_idx >= len(token_spans):
            results.append({
                "lyric_index": i,
                "lyric": original_lines[i],
                "start": None,
                "end": None,
                "score": 0.0,
                "source": "none",
                "words": [],
                "phones": [],
            })
            continue

        line_spans = token_spans[span_idx:span_idx + num_tokens]
        span_idx += num_tokens

        if not line_spans:
            results.append({
                "lyric_index": i,
                "lyric": original_lines[i],
                "start": None,
                "end": None,
                "score": 0.0,
                "source": "none",
                "words": [],
                "phones": [],
            })
            continue

        start_time = line_spans[0]["start"] * ratio / sample_rate
        end_time = line_spans[-1]["end"] * ratio / sample_rate
        avg_score = sum(s["score"] for s in line_spans) / len(line_spans)

        results.append({
            "lyric_index": i,
            "lyric": original_lines[i],
            "start": round(start_time, 3),
            "end": round(end_time, 3),
            "score": round(avg_score, 3),
            "source": source,
            "words": [],
            "phones": [],
        })

        log.info(
            "Line %02d: %.2f -> %.2f (%.3f) %s",
            i, start_time, end_time, avg_score, original_lines[i],
        )

    return results


# ── Public entry point ───────────────────────────────────────

def align_with_forced_aligner(lyrics_text, audio_path):
    if isinstance(lyrics_text, str):
        lines = [l.strip() for l in lyrics_text.splitlines() if l.strip()]
    else:
        lines = [str(l).strip() for l in lyrics_text if str(l).strip()]

    if not lines:
        raise ValueError("No lyrics provided")

    normalized_lines = []
    for line in lines:
        romaji = to_romaji(line)
        normalized = _normalize_transcript(romaji)
        normalized_lines.append(normalized if normalized else "")

    waveform = _load_audio(audio_path)
    log.info(
        "Audio loaded: %.1f seconds, %d samples",
        waveform.shape[1] / SAMPLE_RATE, waveform.shape[1],
    )

    try:
        return _align_finetuned(lines, normalized_lines, waveform)
    except Exception as e:
        log.warning("Finetuned model failed (%s), falling back to MMS_FA", e)

    return _align_mms_fa(lines, normalized_lines, waveform)
