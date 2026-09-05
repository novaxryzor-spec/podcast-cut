'use strict';
const core=require('./core');

function validateDiarization(d,duration) {
  if(!d||d.version!==1||!Array.isArray(d.turns)||!d.turns.length||d.turns.length>200000||!Array.isArray(d.speakers)) throw Error('Résultat de diarisation vide ou invalide.');
  if(!Number.isFinite(d.duration)||Math.abs(d.duration-duration)>.1) throw Error('La diarisation ne correspond pas à la durée du mix. Relancez la détection.');
  const ids=d.speakers.map(s=>s.id);
  if(!ids.length||ids.length>6||ids.some(id=>typeof id!=='string'||!/^VOICE_\d{2}$/.test(id))||new Set(ids).size!==ids.length) throw Error('Identifiants de voix invalides.');
  for(const t of d.turns) if(!ids.includes(t.speaker)||!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end<=t.start||t.end>duration+.05) throw Error('Intervalle de parole invalide.');
  if(ids.some(id=>!d.turns.some(t=>t.speaker===id))) throw Error('Voix sans intervalle de parole.');
  return ids;
}

function makeMixedPlan(analysis,d,mapping,c) {
  core.validate(c);
  const ids=validateDiarization(d,analysis.duration);
  for(const id of ids) if(!Object.prototype.hasOwnProperty.call(mapping,id)||!Number.isInteger(mapping[id])||mapping[id]<0||mapping[id]>=c.speakers.length) throw Error('Associez chaque voix détectée à une caméra.');
  const n=analysis.levels.length;
  const events=[];
  d.turns.forEach(t=>{
    const start=Math.max(0,Math.floor(t.start*c.fps)),end=Math.min(n,Math.ceil(t.end*c.fps));
    if(end>start) {events.push({frame:start,id:t.speaker,delta:1});events.push({frame:end,id:t.speaker,delta:-1});}
  });
  events.sort((a,b)=>a.frame-b.frame);
  const counts=new Map(),active=new Uint8Array(n),choices=new Int16Array(n);
  let cursor=0,current=c.wide?-1:mapping[d.turns.slice().sort((a,b)=>a.start-b.start)[0].speaker];
  for(let f=0;f<n;f++) {
    while(cursor<events.length&&events[cursor].frame<=f) {const e=events[cursor++];counts.set(e.id,(counts.get(e.id)||0)+e.delta);}
    const voices=ids.filter(id=>(counts.get(id)||0)>0);
    const cameras=[...new Set(voices.map(id=>mapping[id]))];
    if(cameras.length>1&&c.wide) current=-1;
    else if(cameras.length===1) current=cameras[0];
    else if(cameras.length>1&&!cameras.includes(current)) current=cameras[0];
    // No active voice: hold the current shot. The wide shot is reserved for genuine overlap
    // (several people speaking at once), NOT every pause — cutting to wide on silences produced
    // dozens of needless cuts (and pushed the razor step past its reliable limit).
    choices[f]=current;
    // A missed diarization turn must not delete audible material.
    // Only low-energy gaps outside all detected turns can be removed.
    active[f]=voices.length||analysis.levels[f]>c.threshold?1:0;
  }
  return core.finishPlan(active,choices,c);
}
module.exports={validateDiarization,makeMixedPlan};
