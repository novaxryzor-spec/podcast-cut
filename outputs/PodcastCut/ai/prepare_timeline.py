"""Create only an analysis proxy from timeline audio; original Premiere audio stays intact."""
import argparse
import json
import math
import subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
import imageio_ffmpeg

def prepare(spec, output):
    fps=float(spec['snapshot']['fps'])
    start=float(spec['start']);end=float(spec['end'])
    if not math.isfinite(end-start) or not 0 < end-start <= 10800:
        raise ValueError('Plage de timeline invalide')
    sr=16000
    source_channels=1
    for clip in spec['audioClips']:
        source=Path(clip['path'])
        if source.is_file():
            try: source_channels=max(source_channels,int(sf.info(source).channels))
            except Exception: pass
    count=round((end-start)*sr)
    # Disk-backed output avoids allocating a full multi-hour mix in memory.
    with sf.SoundFile(output,'w',samplerate=sr,channels=source_channels,subtype='PCM_16') as out:
        silence=np.zeros((sr*30,source_channels),dtype=np.float32)
        remaining=count
        while remaining:
            n=min(remaining,len(silence));out.write(silence[:n]);remaining-=n
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    with sf.SoundFile(output,'r+') as out:
        for clip in spec['audioClips']:
            left=max(start,float(clip['start']));right=min(end,float(clip['end']))
            if right<=left:continue
            source=Path(clip['path'])
            if not source.is_file():raise ValueError('Media audio introuvable : '+str(source))
            offset=float(clip['inPoint'])+left-float(clip['start'])
            if offset<0 or abs(float(clip['speed'])-1)>.0001 or clip['reverse']:raise ValueError('Vitesse ou point d entree audio invalide')
            cmd=[ffmpeg,'-nostdin','-v','error','-ss',str(offset),'-i',str(source),'-t',str(right-left),'-map','0:a:0','-vn','-ac',str(source_channels),'-ar',str(sr),'-f','f32le','pipe:1']
            proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            wanted=round((right-left)*sr);written=0
            out.seek(round((left-start)*sr))
            try:
                while True:
                    data=proc.stdout.read(sr*4*10)
                    if not data:break
                    if len(data)%4:raise ValueError('Trame audio incomplete')
                    block=np.frombuffer(data,dtype='<f4')
                    usable=(len(block)//source_channels)*source_channels
                    block=block[:usable].reshape((-1,source_channels))[:max(0,wanted-written)]
                    out.write(block);written+=len(block)
                error=proc.stderr.read().decode('utf-8',errors='replace')
                if proc.wait()!=0:raise ValueError('Decodage audio impossible : '+error[-1200:])
                if written<wanted-max(2,math.ceil(sr/fps)):raise ValueError('Media audio trop court pour les points de montage')
            finally:
                if proc.poll() is None:proc.kill();proc.wait()
                proc.stdout.close();proc.stderr.close()
    return str(Path(output).resolve())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--spec',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    try:
        spec=json.loads(Path(a.spec).read_text(encoding='utf-8'))
        print(json.dumps({'type':'complete','audio':prepare(spec,a.output)}),flush=True)
    except Exception as e:
        print(json.dumps({'type':'error','message':str(e)}),flush=True);raise SystemExit(1)
