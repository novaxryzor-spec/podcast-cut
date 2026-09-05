const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const {selectTimeline,makeApplyRequest}=require('../timeline');
const clip=(id,start=2,end=12)=>({id,name:id,path:'C:/'+id+'.wav',nested:false,start,end,inPoint:5,outPoint:15,speed:1,reverse:false,disabled:false});
const snapshot={sequenceId:'original',name:'Rushes',fps:25,timebase:String(254016000000/25),zeroPoint:'0',width:1920,height:1080,video:[0,1,2,3].map(i=>({index:i,name:'Video '+i,muted:false,transitions:0,clips:[clip('v'+i)]})),audio:[{index:0,name:'Mix',muted:false,transitions:0,clips:[clip('mix')]}]};
const selection=selectTimeline(snapshot,[0,1,2,3],0,null);
const plan={fps:25,sourceFrames:250,outputFrames:250,segments:[{sourceStart:0,sourceEnd:125,start:0,end:125,camera:0},{sourceStart:125,sourceEnd:250,start:125,end:250,camera:3}]};
let count=0;function test(name,fn){fn();count++;console.log('OK '+name);}
test('Decalage de la timeline conserve dans les coupes',()=>{const r=makeApplyRequest(selection,plan,'Montage');assert.equal(r.segments[0].start,50);assert.equal(r.segments[1].start,175);assert.equal(r.segments[1].track,3);assert.equal(selection.audioClips[0].inPoint,5);});
test('Trou interne dans une camera refuse',()=>{const s=JSON.parse(JSON.stringify(snapshot));s.video[2].clips=[{...clip('v2a'),start:2,end:4},{...clip('v2b'),start:7,end:12}];assert.throws(()=>selectTimeline(s,[0,1,2,3],0,null),/Trou/);});
test('Camera trop courte en fin refusee (>0,5 s)',()=>{const s=JSON.parse(JSON.stringify(snapshot));s.video[2].clips[0].end=11;assert.throws(()=>selectTimeline(s,[0,1,2,3],0,null),/avant la fin/);});
test('Decalage d une image en fin tolere et rogne la plage',()=>{const s=JSON.parse(JSON.stringify(snapshot));s.video[2].clips[0].end=12-1/25;const sel=selectTimeline(s,[0,1,2,3],0,null);assert.equal(sel.endFrame,299);assert.equal(sel.startFrame,50);});
test('Audio accelere refuse',()=>{const s=JSON.parse(JSON.stringify(snapshot));s.audio[0].clips[0].speed=2;assert.throws(()=>selectTimeline(s,[0,1],0,null),/vitesse/);});
test('Camera imbriquee acceptee',()=>{const s=JSON.parse(JSON.stringify(snapshot));s.video[0].clips[0].nested=true;s.video[0].clips[0].path='';assert(selectTimeline(s,[0,1,2,3],0,null));});
test('Plan large distinct requis',()=>assert.throws(()=>selectTimeline(snapshot,[0,1,2,3],0,3),/distincte/));
test('Audio absent refuse',()=>assert.throws(()=>selectTimeline(snapshot,[0,1],9,null),/audio/));
test('Suppression de silence bloquee avant mutation de la timeline',()=>assert.throws(()=>makeApplyRequest(selection,{...plan,outputFrames:200},'Test'),/silences/));
test('Plusieurs cameras par intervenant : rotation des angles',()=>{
  // 3-camera fixture so no populated track is left unselected.
  const s3={...snapshot,video:[0,1,2].map(i=>({index:i,name:'Video '+i,muted:false,transitions:0,clips:[clip('v'+i)]}))};
  // Speaker 0 owns cameras V1(0) and V3(2); speaker 1 owns V2(1). Selection covers all three.
  const sel=selectTimeline(s3,[0,2,1],0,null);
  const p={fps:25,sourceFrames:250,outputFrames:250,segments:[
    {sourceStart:0,sourceEnd:60,start:0,end:60,camera:0},
    {sourceStart:60,sourceEnd:120,start:60,end:120,camera:1},
    {sourceStart:120,sourceEnd:180,start:120,end:180,camera:0},
    {sourceStart:180,sourceEnd:250,start:180,end:250,camera:0}]};
  const r=makeApplyRequest(sel,p,'Multi',[[0,2],[1]]);
  // Speaker 0's three turns rotate V1,V3,V1; speaker 1 stays on V2.
  assert.deepEqual(r.segments.map(s=>s.track),[0,1,2,0]);
});

// Execute the actual ExtendScript against a Premiere/QE simulator.
// This verifies mutation boundaries and rollback, not compatibility with Adobe.
function fixture(failRazor=false){
 const ticks=254016000000;const time=s=>({seconds:s,ticks:String(Math.round(s*ticks))});
 function makeClip(c){return {nodeId:c.id,name:c.name,projectItem:{getMediaPath:()=>c.path,isSequence:()=>c.nested},start:time(c.start),end:time(c.end),inPoint:time(c.inPoint),outPoint:time(c.outPoint),disabled:c.disabled,getSpeed:()=>c.speed,isSpeedReversed:()=>c.reverse};}
 function track(t){const clips=t.clips.map(makeClip);Object.defineProperty(clips,'numItems',{get:()=>clips.length});return {name:t.name,clips,transitions:{numItems:0},muted:t.muted,isMuted(){return this.muted;},setMute(v){this.muted=!!v;}};}
 let seqs=[];const project={sequences:seqs,activeSequence:null,openSequence(id){this.activeSequence=seqs.find(s=>s.sequenceID===id);},deleteSequence(s){seqs.splice(seqs.indexOf(s),1);return true;}};
 Object.defineProperty(seqs,'numSequences',{get:()=>seqs.length});
 function seq(data,id){const s={sequenceID:id,name:data.name,timebase:data.timebase,zeroPoint:data.zeroPoint,projectItem:{name:data.name},videoTracks:data.video.map(track),audioTracks:data.audio.map(track),getSettings:()=>({videoFrameWidth:1920,videoFrameHeight:1080}),setZeroPoint(v){this.zeroPoint=v;},clone(){seqs.push(seq(data,'copy'));return true;}};s.videoTracks.numTracks=s.videoTracks.length;s.audioTracks.numTracks=s.audioTracks.length;return s;}
 project.activeSequence=seq(snapshot,'original');seqs.push(project.activeSequence);
 const context={app:{project,enableQE(){}},qe:{project:{getActiveSequence(){return {getVideoTrackAt(index){return {razor(tc){if(failRazor)return;const parts=tc.split(':').map(Number),seconds=parts[0]*3600+parts[1]*60+parts[2]+parts[3]/25;const clips=project.activeSequence.videoTracks[index].clips;const i=clips.findIndex(c=>c.start.seconds<seconds&&c.end.seconds>seconds);if(i<0)return;const old=clips[i],offset=seconds-old.start.seconds;const right={...old,nodeId:old.nodeId+'R',start:time(seconds),inPoint:time(old.inPoint.seconds+offset)};old.end=time(seconds);old.outPoint=time(old.inPoint.seconds+offset);clips.splice(i+1,0,right);}};}};}}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../host.jsx'),'utf8'),context);
 return {context,project,seqs};
}
test('Coupes natives simulees : copie, V1 puis V4, original intact',()=>{
 const f=fixture();const request=makeApplyRequest(selection,plan,'Montage');
 // Use the host-produced snapshot, including its serialization ordering.
 request.snapshot=JSON.parse(f.context.podcastTimelineRead());
 f.context.request=request;
 const answer=vm.runInContext('podcastTimelineApply(JSON.parse('+JSON.stringify(JSON.stringify(request))+'))',f.context);
 assert(!answer.startsWith('ERREUR'),answer);assert.equal(f.seqs.length,2);assert.equal(f.seqs[0].videoTracks[0].clips.length,1);assert.equal(f.seqs[0].videoTracks[0].clips[0].disabled,false);
 const copy=f.project.activeSequence;assert.equal(copy.videoTracks[0].clips[0].disabled,false);assert.equal(copy.videoTracks[0].clips[1].disabled,true);assert.equal(copy.videoTracks[3].clips[0].disabled,true);assert.equal(copy.videoTracks[3].clips[1].disabled,false);assert.equal(copy.audioTracks[0].clips.length,1);
});
test('Echec de coupe : retrait de la copie et retour original',()=>{const f=fixture(true),r=makeApplyRequest(selection,plan,'Test');r.snapshot=JSON.parse(f.context.podcastTimelineRead());const answer=vm.runInContext('podcastTimelineApply(JSON.parse('+JSON.stringify(JSON.stringify(r))+'))',f.context);assert(answer.startsWith('ERREUR'));assert.equal(f.seqs.length,1);assert.equal(f.project.activeSequence.sequenceID,'original');});
test('Timeline modifiee : aucune duplication',()=>{const f=fixture(),r=makeApplyRequest(selection,plan,'Test');r.snapshot=JSON.parse(f.context.podcastTimelineRead());f.project.activeSequence.name='Changed';const answer=vm.runInContext('podcastTimelineApply(JSON.parse('+JSON.stringify(JSON.stringify(r))+'))',f.context);assert(answer.includes('change'));assert.equal(f.seqs.length,1);});
console.log(count+' tests timeline reussis.');
