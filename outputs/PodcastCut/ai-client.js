'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
function fingerprint(audio,count){const s=fs.statSync(audio);return JSON.stringify([path.resolve(audio),s.size,s.mtimeMs,count]);}
function detect(audio,count,root,onEvent){
  const python=path.join(root,'runtime','Scripts','python.exe');
  if(!fs.existsSync(python))throw Error('Moteur IA absent. Lancez Installer-IA.cmd puis réessayez.');
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'PodcastCut-voices-'));
  const key=fingerprint(audio,count);
  const child=cp.spawn(python,['-u',path.join(__dirname,'ai','diarize.py'),'--audio',audio,'--models',path.join(root,'models'),'--output',output,'--speakers',String(count)],{shell:false,windowsHide:true});
  let cancelled=false,timer;
  const promise=new Promise((resolve,reject)=>{
    let buffer='',errors='',workerError='',complete=false;
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;let newline;
      while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{const e=JSON.parse(line);if(e.type==='error')workerError=e.message;if(e.type==='complete')complete=true;if(onEvent)onEvent(e);}catch(_){}}
      if(buffer.length>65536)buffer=buffer.slice(-65536);
    });
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
    child.on('error',e=>{clearTimeout(timer);reject(Error('Impossible de lancer le moteur IA : '+e.message));});
    child.on('close',code=>{
      clearTimeout(timer);
      if(cancelled)return reject(Error('Détection annulée.'));
      if(code!==0||!complete)return reject(Error(workerError||(errors?'Échec IA : '+errors:'Le moteur IA a quitté sans résultat.')));
      try{
        if(fingerprint(audio,count)!==key)throw Error('Le fichier audio a changé pendant l’analyse. Relancez-la.');
        const data=JSON.parse(fs.readFileSync(path.join(output,'diarization.json'),'utf8'));
        for(const s of data.speakers)if(path.dirname(path.resolve(s.sampleFile))!==path.resolve(output)||!fs.existsSync(s.sampleFile))throw Error('Extrait de voix invalide.');
        resolve({data,key,output});
      }catch(e){reject(e);}
    });
    timer=setTimeout(()=>{workerError='Analyse trop longue (limite : 4 heures). Divisez le mix.';child.kill();},4*60*60*1000);
  });
  return {promise,cancel(){cancelled=true;child.kill();}};
}
function prepareTimeline(selection,root) {
  const python=path.join(root,'runtime','Scripts','python.exe');
  if(!fs.existsSync(python))return Promise.reject(Error('Lancez Installer-IA.cmd pour activer l’analyse de timeline.'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'PodcastCut-timeline-'));
  const spec=path.join(dir,'selection.json'),audio=path.join(dir,'mix.wav');
  fs.writeFileSync(spec,JSON.stringify(selection),'utf8');
  return new Promise((resolve,reject)=>cp.execFile(python,['-u',path.join(__dirname,'ai','prepare_timeline.py'),'--spec',spec,'--output',audio],{windowsHide:true,timeout:20*60*1000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
    if(error)return reject(Error('Préparation audio impossible : '+(stdout||stderr||error.message).slice(-1500)));
    if(!fs.existsSync(audio))return reject(Error('Mix temporaire manquant.'));
    resolve(audio);
  }));
}
function alignMic(referenceWav,micFile,root) {
  const python=path.join(root,'runtime','Scripts','python.exe');
  if(!fs.existsSync(python))return Promise.reject(Error('Lancez Installer-IA.cmd pour activer l’alignement automatique.'));
  return new Promise((resolve,reject)=>cp.execFile(python,['-u',path.join(__dirname,'ai','align.py'),'--reference',referenceWav,'--mic',micFile],{windowsHide:true,timeout:10*60*1000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
    let event=null;
    try{const line=String(stdout||'').trim().split(/\r?\n/).filter(Boolean).pop();if(line)event=JSON.parse(line);}catch(_){}
    if(event&&event.type==='error')return reject(Error(event.message));
    if(error&&!event)return reject(Error('Alignement impossible : '+String(stderr||error.message).slice(-800)));
    if(!event||event.type!=='complete')return reject(Error('Réponse d’alignement invalide.'));
    resolve({offset:Number(event.offset),peak:Number(event.peak),margin:Number(event.margin),confident:Boolean(event.confident)});
  }));
}
module.exports={detect,fingerprint,prepareTimeline,alignMic};
