"""Download the two public models from sherpa-onnx's official release assets."""
from pathlib import Path
import argparse
import shutil
import tarfile
import urllib.request

BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
SEGMENTATION = "sherpa-onnx-pyannote-segmentation-3-0"
EMBEDDING = "nemo_en_titanet_small.onnx"

def fetch(url, target):
    if target.is_file() and target.stat().st_size > 0:
        return
    partial = target.with_suffix(target.suffix + ".download")
    print("Telechargement : " + target.name, flush=True)
    with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as out:
        shutil.copyfileobj(response, out)
    partial.replace(target)

def download(directory):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / (SEGMENTATION + ".tar.bz2")
    fetch(BASE + "speaker-segmentation-models/" + archive.name, archive)
    # Extract only expected regular files; never trust archive paths/links.
    with tarfile.open(archive) as tar:
        for name in ("model.onnx", "LICENSE", "README.md"):
            member = tar.getmember(SEGMENTATION + "/" + name)
            if not member.isfile():
                raise ValueError("Archive de modeles invalide")
            target = directory / SEGMENTATION / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    fetch(BASE + "speaker-recongition-models/" + EMBEDDING, directory / EMBEDDING)
    print("Modeles prets. Les analyses suivantes sont hors ligne.", flush=True)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("directory")
    download(p.parse_args().directory)
