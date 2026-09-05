const assert=require('assert');const {makeMixedPlan}=require('../mixed');const {toXML}=require('../core');
const c={mode:'mixed',mixAudio:'C:/mix.wav',fps:25,threshold:-35,minShot:.2,hold:.04,silence:.3,padding:0,width:1920,height:1080,removeSilence:false,wide:'C:/wide.mov',speakers:[0,1,2,3].map(i=>({camera:'C:/cam'+i+'.mov',gain:0}))};
const a={duration:8,levels:new Float32Array(200).fill(-15),channels:1,bits:16,sampleRate:16000};
const d={version:1,duration:8,speakers:[{id:'VOICE_01'},{id:'VOICE_02'}],turns:[{start:0,end:4,speaker:'VOICE_01'},{start:3,end:8,speaker:'VOICE_02'}]};
const m={VOICE_01:3,VOICE_02:1};let count=0;function test(name,fn){fn();count++;console.log('OK '+name);}
const plan=makeMixedPlan(a,d,m,c);
test('Association explicite des voix aux cameras',()=>{assert.equal(plan.segments[0].camera,3);assert(plan.segments.some(s=>s.camera===1));});
test('Chevauchement vers plan large',()=>assert(plan.segments.some(s=>s.camera===-1)));
test('Mix exporte une seule fois malgre quatre cameras',()=>{const xml=toXML(plan,c,[a]);assert.equal((xml.match(/<track>/g)||[]).length,2);assert.equal((xml.match(/<audio><samplecharacteristics>/g)||[]).length,1);});
test('Stereo : deux canaux, jamais huit',()=>assert.equal((toXML(plan,c,[{...a,channels:2}]).match(/<track>/g)||[]).length,3));
test('Association incomplete bloquee',()=>assert.throws(()=>makeMixedPlan(a,d,{VOICE_01:0},c),/Associez/));
test('Diarisation perimee bloquee',()=>assert.throws(()=>makeMixedPlan(a,{...d,duration:9},m,c),/durée/));
test('Parole audible non detectee conservee',()=>{const gaps={...d,turns:[{start:0,end:1,speaker:'VOICE_01'},{start:7,end:8,speaker:'VOICE_02'}]};assert.equal(makeMixedPlan(a,gaps,m,{...c,removeSilence:true}).outputFrames,200);});
test('Doubles segments meme voix ne creent pas un chevauchement fictif',()=>{const same={...d,speakers:[{id:'VOICE_01'}],turns:[{start:0,end:6,speaker:'VOICE_01'},{start:2,end:8,speaker:'VOICE_01'}]};assert(makeMixedPlan(a,same,{VOICE_01:0},c).segments.every(s=>s.camera===0));});
console.log(count+' tests audio mixe reussis.');
