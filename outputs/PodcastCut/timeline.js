'use strict';
// Pure validation/planning. Premiere mutation lives exclusively in host.jsx.
function selectTimeline(snapshot,cameraTracks,audioTrack,wideTrack) {
  if(!snapshot||!snapshot.sequenceId||!Number.isFinite(snapshot.fps)||snapshot.fps<=0)throw Error('Ouvrez une séquence dans Premiere puis cliquez sur Lire la timeline.');
  if(cameraTracks.length<1||cameraTracks.length>6||new Set(cameraTracks).size!==cameraTracks.length)throw Error('Choisissez de 1 à 6 pistes caméra différentes.');
  const audio=snapshot.audio.find(t=>t.index===audioTrack);
  if(!audio||audio.muted||!audio.clips.length)throw Error('Choisissez une piste audio non vide et non muette.');
  if(audio.transitions)throw Error('La piste audio contient des transitions. Utilisez un mix continu sur une piste dédiée.');
  const clips=audio.clips.filter(c=>!c.disabled).sort((a,b)=>a.start-b.start);
  if(!clips.length)throw Error('Aucun clip audio actif.');
  clips.forEach((c,i)=>{
    if(!c.path||c.nested)throw Error('Le mix audio doit être un média direct. Pour une séquence audio imbriquée, exportez le mix et placez-le sur A1.');
    if(!Number.isFinite(c.speed)||Math.abs(c.speed-1)>.0001||c.reverse)throw Error('Le mix audio doit être à vitesse normale.');
    if(c.end<=c.start||c.inPoint<0)throw Error('Points de montage audio invalides.');
    if(i&&c.start<clips[i-1].end-1/snapshot.fps)throw Error('Les clips audio ne doivent pas se chevaucher sur la piste analysée.');
  });
  const startFrame=Math.ceil(clips[0].start*snapshot.fps-1e-5),endFrame=Math.floor(clips[clips.length-1].end*snapshot.fps+1e-5);
  if(endFrame<=startFrame)throw Error('Plage audio trop courte.');
  const start=startFrame/snapshot.fps,end=endFrame/snapshot.fps;
  if(end-start>10800)throw Error('Limite : trois heures par montage.');
  const selected=cameraTracks.slice();
  if(wideTrack!==null) {if(selected.includes(wideTrack))throw Error('Le plan large doit utiliser une piste distincte des caméras individuelles.');selected.push(wideTrack);}
  // Real multicam footage almost never starts/ends on the exact same frame across cameras.
  // We reject genuine INTERNAL gaps, but tolerate small head/tail mismatches (up to `tol`) by
  // trimming the montage to the span every selected camera actually covers. This is what makes
  // the plugin work on real timelines instead of rejecting a whole edit over a 1-frame tail.
  const tol=Math.max(0.5,2/snapshot.fps);
  let maxStart=start,minEnd=end;const shortEnd=[],lateStart=[];
  const cameras=selected.map(index=>{
    const track=snapshot.video.find(t=>t.index===index);
    if(!track||track.muted||!track.clips.length)throw Error('Piste V'+(index+1)+' vide ou masquée.');
    if(track.transitions)throw Error('Retirez les transitions de V'+(index+1)+' avant le montage automatique.');
    const inRange=track.clips.filter(c=>!c.disabled&&c.end>start&&c.start<end).sort((a,b)=>a.start-b.start);
    if(!inRange.length)throw Error('V'+(index+1)+' ne contient aucune image sur la plage audio.');
    const camStart=inRange[0].start;let covered=camStart;
    for(const c of inRange){
      if(c.start>covered+0.5/snapshot.fps)throw Error('Trou au milieu de V'+(index+1)+' vers '+covered.toFixed(2)+' s. Chaque caméra doit être continue sur la plage audio.');
      covered=Math.max(covered,c.end);
    }
    if(camStart>maxStart)maxStart=camStart;
    if(covered<minEnd)minEnd=covered;
    if(camStart>start+tol)lateStart.push('V'+(index+1));
    if(covered<end-tol)shortEnd.push('V'+(index+1));
    return track;
  });
  if(lateStart.length)throw Error('Ces caméras commencent trop après le début du mix : '+lateStart.join(', ')+'. Alignez-les ou désélectionnez-les.');
  if(shortEnd.length)throw Error('Ces caméras se terminent trop avant la fin du mix : '+shortEnd.join(', ')+'. Prolongez-les ou désélectionnez-les.');
  const startFrameEff=Math.max(startFrame,Math.ceil(maxStart*snapshot.fps-1e-5)),endFrameEff=Math.min(endFrame,Math.floor(minEnd*snapshot.fps+1e-5));
  if(endFrameEff<=startFrameEff)throw Error('La plage commune à toutes les caméras est trop courte.');
  const higherUnselected=snapshot.video.filter(t=>!selected.includes(t.index)&&t.clips.some(c=>!c.disabled&&c.end>start&&c.start<end));
  if(higherUnselected.length)throw Error('Séquence de rushes requise : retirez ou désactivez les clips des pistes vidéo non sélectionnées ('+higherUnselected.map(t=>'V'+(t.index+1)).join(', ')+').');
  const startEff=startFrameEff/snapshot.fps,endEff=endFrameEff/snapshot.fps;
  return {snapshot,cameraTracks,audioTrack,wideTrack,cameras,startFrame:startFrameEff,endFrame:endFrameEff,start:startEff,end:endEff,duration:endEff-startEff,audioClips:clips};
}
function makeApplyRequest(selection,plan,name,speakerCameras){
  if(plan.outputFrames!==plan.sourceFrames)throw Error('La suppression des silences est disponible en mode fichiers. Le mode timeline conserve les positions audio.');
  if(Math.abs(plan.sourceFrames-(selection.endFrame-selection.startFrame))>1)throw Error('La durée analysée ne correspond plus à la timeline.');
  // Each speaker (plan camera index) may own several physical cameras. Rotate through them across
  // that speaker's successive turns so multiple angles get used. Default: one camera per speaker.
  const groups=speakerCameras||selection.cameraTracks.map(t=>[t]);
  const rot={};
  const segments=plan.segments.map(s=>{
    if(s.camera<0)return {start:selection.startFrame+s.sourceStart,end:selection.startFrame+s.sourceEnd,track:selection.wideTrack};
    const cams=groups[s.camera];
    if(!cams||!cams.length)throw Error('Caméra manquante pour un intervenant.');
    rot[s.camera]=rot[s.camera]||0;
    const track=cams[rot[s.camera]%cams.length];rot[s.camera]++;
    return {start:selection.startFrame+s.sourceStart,end:selection.startFrame+s.sourceEnd,track};
  });
  if(!segments.length||segments.length>10000)throw Error('Nombre de plans invalide (maximum 10 000).');
  segments[segments.length-1].end=selection.endFrame;
  let previous=selection.startFrame;
  for(const s of segments){if(!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start!==previous||s.end<=s.start||!selection.cameras.some(c=>c.index===s.track))throw Error('Plan de coupes invalide.');previous=s.end;}
  return {snapshot:selection.snapshot,cameraTracks:selection.cameras.map(t=>t.index),audioTrack:selection.audioTrack,startFrame:selection.startFrame,endFrame:selection.endFrame,segments,name:name||selection.snapshot.name+' — Podcast Cut'};
}
module.exports={selectTimeline,makeApplyRequest};
