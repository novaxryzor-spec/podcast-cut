'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const {analyzeWav,makePlan,toXML}=require('../core');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'podcast-cut-test-'));
const c={name:'Test & podcast <1>',fps:25,threshold:-35,minShot:1,hold:.12,silence:.6,padding:.12,width:1920,height:1080,removeSilence:false,wide:path.join(tmp,'wide.mov'),speakers:[{audio:path.join(tmp,'a.wav'),camera:path.join(tmp,'a.mov'),gain:0},{audio:path.join(tmp,'b.wav'),camera:path.join(tmp,'b.mov'),gain:0}]};
let passed=0;
function test(name,fn){fn();passed++;console.log('OK '+name);}
function wave(file,bits,tag,channels,seconds,signal){
 const sr=8000,n=sr*seconds,bytes=bits/8,align=channels*bytes,b=Buffer.alloc(44+n*align);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(tag,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*align,28);b.writeUInt16LE(align,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(n*align,40);
 for(let i=0;i<n;i++)for(let ch=0;ch<channels;ch++){const value=signal(i/sr,ch),p=44+i*align+ch*bytes;if(tag===3)b.writeFloatLE(value,p);else b.writeIntLE(Math.round(value*(Math.pow(2,bits-1)-1)),p,bytes);}
 fs.writeFileSync(file,b);
}
(async()=>{try{
 for(const [bits,tag,channels] of [[16,1,1],[24,1,2],[32,1,1],[32,3,2]]){
  const file=path.join(tmp,`${bits}-${tag}.wav`);wave(file,bits,tag,channels,2,(t,ch)=>.5*Math.sin(t*2*Math.PI*440)*(ch?-1:1));const a=await analyzeWav(file,25);
  test(`WAV ${bits} bits format ${tag}, ${channels} canal/canaux`,()=>{assert.equal(a.levels.length,50);assert(Math.abs(a.levels[10]+9.03)<.1);assert.equal(a.duration,2);});
 }
 const a={levels:Float32Array.from({length:250},(_,i)=>i<75||i>=175&&i<200?-15:-100),channels:1,bits:16,sampleRate:8000};
 const b={...a,levels:Float32Array.from({length:250},(_,i)=>i>=75&&i<125||i>=175&&i<200?-15:-100)};
 const p=makePlan([a,b],c);
 test('Alternance des voix et plan large en chevauchement',()=>{assert(p.segments.some(s=>s.camera===0));assert(p.segments.some(s=>s.camera===1));assert(p.segments.some(s=>s.camera===-1));assert.equal(p.outputFrames,250);});
 test('Durée minimale de plan',()=>{p.segments.slice(0,-1).forEach(s=>assert(s.end-s.start>=25));});
 const cut=makePlan([a,b],{...c,removeSilence:true});
 test('Suppression des silences avec synchro source/montage',()=>{assert(cut.outputFrames<250);let end=0;cut.segments.forEach(s=>{assert.equal(s.start,end);assert.equal(s.end-s.start,s.sourceEnd-s.sourceStart);end=s.end;});assert.equal(end,cut.outputFrames);});
 test('Marges supérieures au silence : aucune inversion',()=>{assert.doesNotThrow(()=>makePlan([a,b],{...c,removeSilence:true,padding:2}));});
 test('Rejet des durées audio incompatibles',()=>assert.throws(()=>makePlan([a,{...b,levels:new Float32Array(10)}],c),/durée/));
 test('Rejet de tous les silences',()=>assert.throws(()=>makePlan([{...a,levels:new Float32Array(250).fill(-120)},{...b,levels:new Float32Array(250).fill(-120)}],{...c,removeSilence:true,padding:0}),/silence/));
 test('Réglages invalides refusés',()=>assert.throws(()=>makePlan([a,b],{...c,minShot:NaN}),/invalide/));
 test('Sans plan large : uniquement les caméras individuelles',()=>assert(makePlan([a,b],{...c,wide:''}).segments.every(s=>s.camera>=0)));
 const xml=toXML(cut,c,[a,b]);
 test('XML : texte échappé, canaux, durée et chemins',()=>{assert(xml.includes('Test &amp; podcast &lt;1&gt;'));assert(xml.includes('<duration>'+cut.outputFrames+'</duration>'));assert(xml.includes('file:///'));assert.equal((xml.match(/<track>/g)||[]).length,3);const ids=Array.from(xml.matchAll(/<clipitem id="([^"]+)"/g),m=>m[1]);assert.equal(new Set(ids).size,ids.length);});
 test('Cadence NTSC exacte',()=>{const x=toXML(cut,{...c,fps:30000/1001},[a,b]);assert(x.includes('<timebase>30</timebase><ntsc>TRUE</ntsc>'));});
 const broken=path.join(tmp,'broken.wav');fs.writeFileSync(broken,'no');
 await assert.rejects(()=>analyzeWav(broken,25));passed++;console.log('OK WAV tronqué refusé');
 // End-to-end with generated audio, with retained XML for external parser QA.
 wave(c.speakers[0].audio,16,1,1,10,(t)=>t<3||t>=7&&t<8?.5*Math.sin(t*2764):0);
 wave(c.speakers[1].audio,16,1,1,10,(t)=>t>=3&&t<5||t>=7&&t<8?.5*Math.sin(t*3217):0);
 const real=await Promise.all(c.speakers.map(s=>analyzeWav(s.audio,25)));
 const realPlan=makePlan(real,{...c,removeSilence:true});
 test('Chaîne WAV → détection → montage XML',()=>{assert(realPlan.outputFrames<250);assert(realPlan.segments.some(s=>s.camera===-1));assert(toXML(realPlan,c,real).includes('<xmeml version="5">'));});
 if(process.env.PODCASTCUT_QA_XML)fs.writeFileSync(process.env.PODCASTCUT_QA_XML,toXML(realPlan,c,real));
 console.log('\n'+passed+' tests réussis.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
