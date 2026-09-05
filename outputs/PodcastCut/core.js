'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

// Read in blocks: a multi-hour recording never needs to be loaded into RAM.
async function analyzeWav(filename, fps, onProgress) {
  const fd = fs.openSync(filename, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    function read(n, pos) {
      const b = Buffer.alloc(n);
      if (fs.readSync(fd, b, 0, n, pos) !== n) throw Error('WAV tronqué.');
      return b;
    }
    const head = read(12, 0);
    if (head.toString('ascii',0,4) !== 'RIFF' || head.toString('ascii',8,12) !== 'WAVE') throw Error('Format requis : WAV RIFF PCM ou flottant (pas RF64).');
    let fmt, data;
    for (let p=12;p+8<=size;) {
      const h=read(8,p), n=h.readUInt32LE(4), id=h.toString('ascii',0,4);
      if (p+8+n>size) throw Error('Bloc WAV tronqué.');
      if(id==='fmt ') {
        if(n<16) throw Error('En-tête WAV invalide.');
        const b=read(Math.min(n,40),p+8);
        let tag=b.readUInt16LE(0);
        if(tag===65534) { if(n<40) throw Error('WAV extensible invalide.'); tag=b.readUInt16LE(24); }
        fmt={tag,channels:b.readUInt16LE(2),sampleRate:b.readUInt32LE(4),align:b.readUInt16LE(12),bits:b.readUInt16LE(14)};
      }
      if(id==='data') data={offset:p+8,size:n};
      p+=8+n+(n%2);
    }
    if(!fmt||!data) throw Error('Blocs fmt/data manquants.');
    const {tag,channels,sampleRate,align,bits}=fmt;
    if(!channels || channels>32 || sampleRate<8000 || sampleRate>384000 || align!==channels*bits/8 || !((tag===1&&[16,24,32].includes(bits))||(tag===3&&bits===32))) throw Error('WAV non pris en charge : utilisez PCM 16/24/32 bits ou float 32 bits.');
    const samples=Math.floor(data.size/align), frames=Math.floor(samples/sampleRate*fps);
    if(frames<1) throw Error('Audio trop court.');
    const levels=new Float32Array(frames), channelLevels=Array.from({length:channels},()=>new Float32Array(frames)), block=Buffer.alloc(Math.ceil(sampleRate/fps)*align);
    for(let f=0;f<frames;f++) {
      const first=Math.floor(f*sampleRate/fps), end=Math.floor((f+1)*sampleRate/fps), count=end-first, bytes=count*align;
      if(fs.readSync(fd,block,0,bytes,data.offset+first*align)!==bytes) throw Error('Lecture WAV incomplète.');
        let sum=0,channelPower=new Float64Array(channels);
      for(let s=0;s<count;s++) {
        let power=0;
        for(let c=0;c<channels;c++) {
          const p=s*align+c*bits/8;
          const v=tag===3?block.readFloatLE(p):bits===16?block.readInt16LE(p)/32768:bits===24?block.readIntLE(p,3)/8388608:block.readInt32LE(p)/2147483648;
          if(!Number.isFinite(v)) throw Error('Échantillon audio invalide.');
          power+=v*v; channelPower[c]+=v*v;
        }
        sum+=power/channels; for(let c=0;c<channels;c++)channelLevels[c][f]+=channelPower[c]/count;
      }
      levels[f]=10*Math.log10(Math.max(1e-12,sum/count));
      if(f%300===0) { if(onProgress) onProgress(f/frames); await new Promise(r=>setTimeout(r,0)); }
    }
    for(let c=0;c<channels;c++)for(let f=0;f<frames;f++)channelLevels[c][f]=10*Math.log10(Math.max(1e-12,channelLevels[c][f]));
    return {levels,channelLevels,channels,sampleRate,bits,duration:samples/sampleRate};
  } finally { fs.closeSync(fd); }
}

function validate(c) {
  if(c.forceMin===undefined)c.forceMin=0;
  if(c.forceMax===undefined)c.forceMax=0;
  if(c.frequencyWeight===undefined)c.frequencyWeight=30;
  if(![24,25,30,50,60,24000/1001,30000/1001,60000/1001].some(x=>Math.abs(x-c.fps)<0.000001)) throw Error('Cadence non prise en charge.');
  for(const [key,lo,hi] of [['threshold',-90,-5],['minShot',0.2,30],['hold',0.04,3],['silence',0.1,10],['padding',0,2],['forceMin',0,30],['forceMax',0,60],['frequencyWeight',0,100],['width',320,8192],['height',240,8192]]) {
    if(!Number.isFinite(c[key])||c[key]<lo||c[key]>hi) throw Error('Réglage invalide : '+key);
  }
  if(!Number.isInteger(c.width)||!Number.isInteger(c.height)) throw Error('Dimensions entières requises.');
  if(c.forceMax>0 && c.forceMax<c.forceMin) throw Error('La coupe maximale doit être supérieure à la coupe minimale.');
  if(!Array.isArray(c.speakers)||!c.speakers.length||c.speakers.length>6) throw Error('Choisir 1 à 6 intervenants.');
  if(c.mode==='mixed' && !c.mixAudio) throw Error('Choisissez le WAV contenant toutes les voix.');
  for(const s of c.speakers) if((c.mode!=='mixed'&&!s.audio)||!s.camera||!Number.isFinite(s.gain)||Math.abs(s.gain)>24) throw Error('Caméra, WAV et gain valides requis pour chaque intervenant.');
}

function makePlan(analyses,c) {
  validate(c);
  if(analyses.length!==c.speakers.length) throw Error('Pistes audio incohérentes.');
  const n=Math.min(...analyses.map(a=>a.levels.length));
  if(!n) throw Error('Aucun audio à monter.');
  if(Math.max(...analyses.map(a=>a.levels.length))-n>1) throw Error('Les WAV doivent avoir la même durée (tolérance : une image).');
  const active=new Uint8Array(n), choices=new Int16Array(n);
  const smooth=c.speakers.map(()=>-120);
  let lastChoice=0;
  for(let f=0;f<n;f++) {
    let best=0, count=0, second=-120;
    analyses.forEach((a,i)=>{
      const raw=a.levels[f]+c.speakers[i].gain;
      smooth[i]=raw>smooth[i]?raw:Math.max(raw,smooth[i]-2);
      if(smooth[i]>c.threshold) count++;
      if(smooth[i]>smooth[best]) {second=smooth[best];best=i;}
      else if(smooth[i]>second) second=smooth[i];
    });
    active[f]=count>0?1:0;
    // When two microphones are close, do not guess a speaker. Prefer a
    // mapped wide shot; without one, hold the previous camera. A 6 dB lead
    // is required before an individual angle wins an overlap.
    const method=c.analysisMethod||'average';
    const requiredLead=method==='strong' ? 3 : method==='stable' ? 8 : 6;
    const clearLead=(smooth[best]-second)>=requiredLead;
    if(count>1 && !clearLead) choices[f]=c.wide?-1:lastChoice;
    else choices[f]=best;
    if(active[f] && choices[f]>=0) lastChoice=choices[f];
  }
  return finishPlan(active,choices,c);
}

function finishPlan(active,choices,c) {
  const n=active.length;
  const keep=new Uint8Array(n); keep.fill(1);
  if(c.removeSilence) {
    const pad=Math.round(c.padding*c.fps), min=Math.ceil(c.silence*c.fps);
    for(let f=0;f<n;) {
      if(active[f]) {f++;continue;}
      const start=f; while(f<n&&!active[f]) f++;
      if(f-start>=min && f-start>2*pad) keep.fill(0,start+pad,f-pad);
    }
  }
  let current=choices[0], candidate=current, pending=0, age=0, out=0;
  const hold=Math.ceil(c.hold*c.fps), minShot=Math.ceil(Math.max(c.minShot||0,c.forceMin||0)*c.fps), maxShot=c.forceMax>0?Math.ceil(c.forceMax*c.fps):Infinity, segments=[];
  for(let f=0;f<n;f++) {
    if(!keep[f]) {pending=0;age=minShot;continue;}
    const next=active[f]?choices[f]:current;
    if(next===candidate) pending++; else {candidate=next;pending=1;}
    if(next!==current&&pending>=hold&&age>=minShot) {current=next;age=0;}
    const last=segments[segments.length-1];
    if(last&&last.camera===current&&last.sourceEnd===f&&last.sourceEnd-last.sourceStart<maxShot) {last.sourceEnd++;last.end++;}
    else segments.push({camera:current,sourceStart:f,sourceEnd:f+1,start:out,end:out+1});
    out++;age++;
  }
  if(!segments.length) throw Error('Tout est considéré comme silence. Baissez le seuil ou désactivez la suppression.');
  return {segments,sourceFrames:n,outputFrames:out,fps:c.fps};
}

const esc=s=>String(s).replace(/[<>&"']/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[x]));
function toXML(plan,c,analyses) {
  validate(c);
  const ntsc=!Number.isInteger(c.fps), rate=`<rate><timebase>${Math.round(c.fps)}</timebase><ntsc>${ntsc?'TRUE':'FALSE'}</ntsc></rate>`;
  const videoInfo=`<samplecharacteristics>${rate}<width>${c.width}</width><height>${c.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>`;
  const seen=new Set();
  function file(p,type,idx) {
    const id=type+'-'+idx;
    if(seen.has(id)) return `<file id="${id}"/>`;
    seen.add(id);
    const a=analyses[idx];
    const media=type==='v'?`<video>${videoInfo}</video>`:`<audio><samplecharacteristics><depth>${a.bits}</depth><samplerate>${a.sampleRate}</samplerate></samplecharacteristics><channelcount>${a.channels}</channelcount></audio>`;
    return `<file id="${id}"><name>${esc(path.basename(p))}</name><pathurl>${esc(url.pathToFileURL(p).href)}</pathurl>${rate}<duration>${plan.sourceFrames}</duration><media>${media}</media></file>`;
  }
  function clip(seg,p,type,idx,channel,index) {
    return `<clipitem id="${type}-${idx}-${channel}-${index}"><name>${esc(path.basename(p))}</name><enabled>TRUE</enabled><duration>${plan.sourceFrames}</duration>${rate}<start>${seg.start}</start><end>${seg.end}</end><in>${seg.sourceStart}</in><out>${seg.sourceEnd}</out>${file(p,type,idx)}<sourcetrack><mediatype>${type==='v'?'video':'audio'}</mediatype><trackindex>${channel}</trackindex></sourcetrack></clipitem>`;
  }
  const video=plan.segments.map((s,i)=>clip(s,s.camera<0?c.wide:c.speakers[s.camera].camera,'v',s.camera,1,i)).join('');
  // Audio is cut only at removed silence, not at every camera switch.
  const audioSpans=[];
  plan.segments.forEach(s=>{const last=audioSpans[audioSpans.length-1];if(last&&last.sourceEnd===s.sourceStart) {last.sourceEnd=s.sourceEnd;last.end=s.end;} else audioSpans.push({...s});});
  let audio='';
  const audioSources=c.mode==='mixed'?[{audio:c.mixAudio}]:c.speakers;
  audioSources.forEach((s,i)=>{for(let ch=1;ch<=analyses[i].channels;ch++) audio+=`<track>${audioSpans.map((seg,j)=>clip(seg,s.audio,'a',i,ch,j)).join('')}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;});
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="podcast-cut-${Date.now()}"><name>${esc(c.name||'Podcast Cut')}</name><duration>${plan.outputFrames}</duration>${rate}<media><video><format>${videoInfo}</format><track>${video}</track></video><audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${audio}</audio></media></sequence></xmeml>`;
}
module.exports={analyzeWav,validate,makePlan,finishPlan,toXML};
