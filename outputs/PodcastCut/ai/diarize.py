"""Offline diarization worker. JSON line protocol; no network operations."""
import argparse
import json
import math
import os
from pathlib import Path
import sys


def emit(kind, **kwargs):
    print(json.dumps({"type": kind, **kwargs}, ensure_ascii=True), flush=True)


def diarize(audio_path, model_dir, output_dir, count):
    import numpy as np
    import soundfile as sf
    import sherpa_onnx
    from scipy.signal import resample_poly

    model_dir, output_dir = Path(model_dir), Path(output_dir)
    segmentation = model_dir / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
    embedding = model_dir / "nemo_en_titanet_small.onnx"
    if not segmentation.is_file() or not embedding.is_file():
        raise ValueError("Modeles IA absents. Lancez Installer-IA.cmd une fois.")
    if count < 1 or count > 6:
        raise ValueError("Le nombre de voix doit etre compris entre 1 et 6.")
    emit("status", message="Lecture et preparation du mix...")
    with sf.SoundFile(audio_path) as source:
        if source.format not in ("WAV", "WAVEX") or source.samplerate < 8000:
            raise ValueError("Choisissez un fichier WAV non compresse, au moins 8 kHz.")
        duration = len(source) / source.samplerate
        if duration < 1 or duration > 10800:
            raise ValueError("Duree prise en charge : de 1 seconde a 3 heures.")
        original_rate = source.samplerate
        chunks = []
        divisor = math.gcd(original_rate, 16000)
        for block in source.blocks(blocksize=original_rate * 30, dtype="float32", always_2d=True):
            mono = block.mean(axis=1)
            if not np.isfinite(mono).all():
                raise ValueError("Le mix contient des valeurs audio invalides.")
            if original_rate != 16000:
                mono = resample_poly(mono, 16000 // divisor, original_rate // divisor)
            chunks.append(np.asarray(mono, dtype=np.float32))
    samples = np.concatenate(chunks)
    del chunks
    if np.max(np.abs(samples)) < 1e-6:
        raise ValueError("Le mix est silencieux (ou les canaux stereo s'annulent).")
    threads = min(4, os.cpu_count() or 1)
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation)),
            num_threads=threads, provider="cpu",
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(embedding), num_threads=threads, provider="cpu"),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=count),
        min_duration_on=0.25, min_duration_off=0.3,
    )
    if not config.validate():
        raise ValueError("Configuration IA invalide. Reinstallez les modeles.")
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    if sd.sample_rate != 16000:
        raise ValueError("Le modele charge doit utiliser 16 kHz.")
    emit("status", message="Identification locale des voix...")
    def progress(done, total):
        emit("progress", value=round(100 * done / max(1, total), 1))
        return 0
    turns = []
    labels = {}
    for turn in sd.process(samples, callback=progress).sort_by_start_time():
        start, end = max(0., float(turn.start)), min(duration, float(turn.end))
        if end <= start:
            continue
        raw = int(turn.speaker)
        if raw not in labels:
            labels[raw] = "VOICE_%02d" % (len(labels) + 1)
        turns.append({"start": round(start, 5), "end": round(end, 5), "speaker": labels[raw]})
    if not turns:
        raise ValueError("Aucune voix detectee dans ce mix.")
    if len(labels) > 6:
        raise ValueError("Plus de six voix detectees : divisez l'enregistrement.")
    output_dir.mkdir(parents=True, exist_ok=True)
    speakers = []
    for label in labels.values():
        candidates = [t for t in turns if t["speaker"] == label]
        clean = [t for t in candidates if not any(o["speaker"] != label and o["start"] < t["end"] and o["end"] > t["start"] for o in turns)]
        chosen = max(clean or candidates, key=lambda t: t["end"] - t["start"])
        start, end = chosen["start"], min(chosen["end"], chosen["start"] + 8)
        excerpt = output_dir / (label + ".wav")
        sf.write(excerpt, samples[round(start * 16000):round(end * 16000)], 16000, subtype="PCM_16")
        speakers.append({"id": label, "sampleStart": start, "sampleEnd": end, "sampleFile": str(excerpt.resolve()), "overlap": not bool(clean)})
    result = {"version": 1, "engine": "sherpa-onnx", "duration": duration, "speakers": speakers, "turns": turns}
    output = output_dir / "diarization.json"
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=True), encoding="utf-8")
    temporary.replace(output)
    emit("complete", result=str(output.resolve()), voices=len(speakers))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--speakers", type=int, required=True)
    args = parser.parse_args()
    try:
        diarize(args.audio, args.models, args.output, args.speakers)
    except Exception as error:
        emit("error", message=str(error))
        sys.exit(1)
