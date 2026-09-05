'use strict';
// Global error trap (kept OUTSIDE the IIFE, using only var/function so it can never itself
// collide): any uncaught error or promise rejection becomes visible directly in the panel.
function pcShowFatal(msg){try{var s=document.getElementById('status');if(s){s.textContent='ERREUR: '+msg;s.className='error';}}catch(_){}}
window.addEventListener('error',function(e){pcShowFatal((e&&e.message?e.message:'inconnue')+(e&&e.filename?' @'+String(e.filename).split('/').pop()+':'+e.lineno:''));});
window.addEventListener('unhandledrejection',function(e){pcShowFatal('promesse: '+((e&&e.reason&&e.reason.message)||e.reason||'inconnue'));});
// CRITICAL: CEP mixed-context (--mixed-context) shares ONE global scope and pre-injects a global
// `cep` object. A top-level `const cep` (and any other top-level const/let) collides on that
// shared scope -> "Identifier 'cep' has already been declared" -> the ENTIRE script fails to
// parse, so no handlers are attached and the button does nothing. Wrapping everything in an IIFE
// makes these declarations function-scoped and collision-proof.
(function(){
const $=id=>document.getElementById(id);
const cep=window.__adobe_cep__;
const req=typeof require==='function'?require:(window.cep_node&&window.cep_node.require);
let core,fs,path,os,mixed,aiClient,timelineCore;
let startupError='';
if(req){try{fs=req('fs');path=req('path');os=req('os');const base=path.dirname(req('url').fileURLToPath(location.href.split('#')[0].split('?')[0]));core=req(path.join(base,'core.js'));mixed=req(path.join(base,'mixed.js'));aiClient=req(path.join(base,'ai-client.js'));timelineCore=req(path.join(base,'timeline.js'));}catch(e){startupError=e.message;}}
let speakers=[], result=null,busy=false,diarization=null,mapping={},detectionJob=null;
let timelineSnapshot=null,timelineSelection=null,mixedPending=null;
// Compact first-run defaults: two speakers and two cameras keep the complete panel visible.
if($('voiceCount'))$('voiceCount').value='2';
if($('cameraCount'))$('cameraCount').value='2';
const fields=['threshold','minShot','hold','silence','padding','width','height','fps'];
const colors=['#b6f36d','#82b7ff','#f3ad7c','#ccadff','#77dfd0','#ef99c5'];
function status(s,error){$('status').textContent=s;$('status').className=error?'error':'';}
function host(script){return new Promise((resolve,reject)=>{if(!cep)return reject(Error('Ouvrez le panneau dans Premiere Pro.'));let done=false;const timeout=setTimeout(()=>{if(!done)reject(Error('Premiere ne répond pas. Fermez puis rouvrez le panneau Podcast Cut et réessayez.'));},20000);cep.evalScript(script,r=>{if(done)return;done=true;clearTimeout(timeout);if(r==='EvalScript error.'||r.indexOf('ERREUR:')===0)reject(Error(r));else resolve(r);});});}
function pcSafeJson(request){var bs=String.fromCharCode(92);return JSON.stringify(request).split(String.fromCharCode(8232)).join(bs+'u2028').split(String.fromCharCode(8233)).join(bs+'u2029');}
function invalidate(){result=null;$('result').hidden=true;}
function lock(value){busy=value;document.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);$('progress').hidden=!value;if(!value&&isTimeline())$('removeSilence').disabled=true;}
async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){status(e.message,true);}finally{lock(false);}}
async function pick(kind){return host('podcastCutPick('+JSON.stringify(kind)+')');}
function drawSpeakers(){
 $('speakers').innerHTML='';
 speakers.forEach((s,i)=>{
  const el=document.createElement('div');el.className='speaker';
  el.innerHTML='<div class="speaker-head"><strong></strong><button class="small remove">Retirer</button></div><label>Caméra<div class="file-row"><input class="camera" readonly placeholder="Vidéo synchronisée"><button class="videoPick">Choisir</button></div></label><label>Microphone<div class="file-row"><input class="audio" readonly placeholder="WAV séparé, même début que la vidéo"><button class="audioPick">Choisir</button></div></label><label class="gain">Gain de détection (dB)<input type="number" min="-24" max="24" step="1"></label>';
  el.querySelector('strong').textContent=($('mode').value==='mixed'?'● Caméra ':'● Intervenant ')+(i+1);el.querySelector('strong').style.color=colors[i];
  el.querySelector('.audio').closest('label').classList.add('audio-label');
  for(const k of ['camera','audio']){el.querySelector('.'+k).value=s[k];el.querySelector('.'+k).title=s[k];}
  el.querySelector('.gain input').value=s.gain;
  el.querySelector('.gain input').oninput=e=>{s.gain=Number(e.target.value);invalidate();};
  el.querySelector('.remove').onclick=()=>{if(speakers.length===1)return status('Conservez au moins une caméra.',true);speakers.splice(i,1);mapping={};drawSpeakers();drawMapping();invalidate();};
  for(const [cls,key,kind] of [['videoPick','camera','video'],['audioPick','audio','audio']]) el.querySelector('.'+cls).onclick=()=>run(async()=>{const p=await pick(kind);if(p){s[key]=p;drawSpeakers();invalidate();}});
  $('speakers').appendChild(el);
 });
}
function config(){const c={mode:$('mode').value,mixAudio:$('mixAudio').value,name:$('name').value,wide:$('wide').value,speakers:speakers.map(s=>({...s})),removeSilence:$('removeSilence').checked};fields.forEach(k=>c[k]=Number($(k).value));if(isTimeline()){if(!timelineSelection)throw Error('Lisez la timeline puis détectez les voix.');c.mode='mixed';c.removeSilence=false;c.fps=timelineSnapshot.fps;c.width=timelineSnapshot.width;c.height=timelineSnapshot.height;c.wide=timelineSelection.wideTrack===null?'':'timeline-wide';}return c;}
function time(f,fps){return (f/fps).toFixed(2)+' s';}
function showResult(){
 const {plan,c}=result;
 $('result').hidden=false;$('stats').textContent=plan.segments.length+' plans · '+time(plan.outputFrames,c.fps)+' · −'+time(plan.sourceFrames-plan.outputFrames,c.fps);
 $('timeline').innerHTML='';$('legend').innerHTML='';
 plan.segments.forEach(s=>{const el=document.createElement('span');el.style.width=((s.end-s.start)/plan.outputFrames*100)+'%';el.style.background=s.camera<0?'#a0a8b7':colors[s.camera];el.title=(s.camera<0?'Plan large':'Intervenant '+(s.camera+1))+' · '+time(s.start,c.fps)+' → '+time(s.end,c.fps);$('timeline').appendChild(el);});
 [...c.speakers.map((s,i)=>['Intervenant '+(i+1),colors[i]]),...(c.wide?[['Plan large','#a0a8b7']]:[])].forEach(([name,color])=>{const el=document.createElement('span');const dot=document.createElement('i');dot.style.background=color;el.appendChild(dot);el.appendChild(document.createTextNode(name));$('legend').appendChild(el);});
 $('cuts').innerHTML='<table><thead><tr><th>Montage</th><th>Source</th><th>Caméra</th></tr></thead><tbody>'+plan.segments.slice(0,250).map(s=>'<tr><td>'+time(s.start,c.fps)+'</td><td>'+time(s.sourceStart,c.fps)+'</td><td>'+(s.camera<0?'Plan large':s.camera+1)+'</td></tr>').join('')+'</tbody></table>'+(plan.segments.length>250?'<p class="hint">Les 250 premiers plans sont affichés. Tous seront exportés.</p>':'');
}
$('add').onclick=()=>{if(speakers.length>=6)return status('Maximum : six intervenants.',true);speakers.push({camera:'',audio:'',gain:0});drawSpeakers();drawMapping();invalidate();};
$('pickWide').onclick=()=>run(async()=>{const p=await pick('video');if(p){$('wide').value=p;invalidate();}});
$('clearWide').onclick=()=>{$('wide').value='';invalidate();};
[...fields,'removeSilence','name'].forEach(k=>$(k).addEventListener('input',invalidate));
function presetValues(){const c={};fields.forEach(k=>c[k]=Number($(k).value));c.removeSilence=$('removeSilence').checked;c.forceMin=Number($('forceMin')?.value||0);c.forceMax=Number($('forceMax')?.value||20);c.frequencyWeight=Number($('frequencyWeight')?.value||30);return c;}
function presetStore(){try{return JSON.parse(localStorage.getItem('podcast-cut-presets')||'{}');}catch(_){return {};}}
function refreshPresets(selected){const sel=$('preset');if(!sel)return;const store=presetStore();sel.innerHTML='';const names=Object.keys(store);if(!names.length){const o=document.createElement('option');o.value='';o.textContent='Réglage Podcast Cut';sel.appendChild(o);}else names.forEach(name=>{const o=document.createElement('option');o.value=name;o.textContent=name;sel.appendChild(o);});if(selected&&store[selected])sel.value=selected;}
function applyPreset(c){fields.forEach(k=>{if(c[k]!==undefined&&$(k))$(k).value=c[k];});if($('removeSilence'))$('removeSilence').checked=!!c.removeSilence;['forceMin','forceMax','frequencyWeight'].forEach(k=>{if(c[k]!==undefined&&$(k))$(k).value=c[k];});['hold','minShot','silence','frequencyWeight'].forEach(k=>{const el=$(k),out=document.querySelector('output[data-for=\"'+k+'\"]');if(el&&out)out.textContent=el.value;});invalidate();}
$('savePreset').onclick=()=>{try{const name=window.prompt('Nom du preset','Réglage Podcast Cut');if(!name||!name.trim())return;const store=presetStore();store[name.trim()]=presetValues();localStorage.setItem('podcast-cut-presets',JSON.stringify(store));refreshPresets(name.trim());status('Preset enregistré : '+name.trim());}catch(e){status(e.message,true);}};
$('loadPreset').onclick=()=>{try{const name=$('preset')?.value,store=presetStore();if(!name||!store[name])throw Error('Sélectionnez un preset enregistré.');applyPreset(store[name]);status('Preset chargé : '+name);}catch(e){status(e.message,true);}};
$('preset').onchange=()=>{if($('preset').value)$('loadPreset').click();};
const presetButtons=document.querySelectorAll('.preset button');
if(presetButtons[0]){presetButtons[0].textContent='▣';presetButtons[0].title='Enregistrer un preset';presetButtons[0].onclick=()=>$('savePreset').click();}
if(presetButtons[1]){presetButtons[1].textContent='⌫';presetButtons[1].title='Supprimer le preset sélectionné';presetButtons[1].onclick=()=>{const name=$('preset').value,store=presetStore();if(!name||!store[name])return status('Sélectionnez un preset à supprimer.',true);if(window.confirm('Supprimer le preset « '+name+' » ?')){delete store[name];localStorage.setItem('podcast-cut-presets',JSON.stringify(store));refreshPresets();status('Preset supprimé.');}};}
refreshPresets();
function explainAdvanced(){
  const box=$('advancedBody');if(!box||box.dataset.ready)return;box.dataset.ready='1';
  box.innerHTML='<input id="name" type="hidden" value="Podcast — premier montage"><div class="advanced-card"><label>DÉLAI DES COUPES <span class="hint-dot">ⓘ</span><div class="range-line"><input id="hold" type="range" min="0.04" max="3" step="0.02" value="0.2"><output data-for="hold">0.2</output></div></label><label>IGNORER LES SEGMENTS COURTS <span class="hint-dot">ⓘ</span><div class="range-line"><input id="minShot" type="range" min="0.2" max="30" step="0.1" value="2.5"><output data-for="minShot">2.5</output></div></label><label>LISSAGE <span class="hint-dot">ⓘ</span><div class="range-line"><input id="silence" type="range" min="0.1" max="10" step="0.1" value="0.8"><output data-for="silence">0.8</output></div></label></div><div class="advanced-card"><div class="advanced-title">FORCER LES COUPES <span class="hint-dot">ⓘ</span></div><div class="force-grid"><label>COUPE MIN<input id="forceMin" type="number" min="0" max="30" value="0"></label><label>COUPE MAX<input id="forceMax" type="number" min="1" max="60" value="20"></label></div><input id="threshold" type="hidden" value="-35"><label>PONDÉRATION DES FRÉQUENCES <span class="hint-dot">ⓘ</span><div class="range-line"><input id="frequencyWeight" type="range" min="0" max="100" value="30"><output data-for="frequencyWeight">30</output></div></label></div>';
  box.querySelectorAll('input[type=range]').forEach(input=>{const out=box.querySelector('output[data-for="'+input.id+'"]');input.oninput=()=>{if(out)out.textContent=input.value;invalidate();};});
  ['hold','minShot','silence','threshold','forceMin','forceMax','frequencyWeight','name'].forEach(id=>{const el=$(id);if(el)el.addEventListener('input',invalidate);});
  const note=document.createElement('p');note.className='advanced-help';note.textContent='Les valeurs par défaut conviennent à la plupart des podcasts. Les paramètres sont appliqués au prochain montage.';box.appendChild(note);
}
explainAdvanced();
$('analyze').onclick=()=>run(async()=>{
 invalidate();if(!core)throw Error('Le moteur Node est indisponible. Ouvrez cette extension dans Premiere Pro.');
 const c=config();core.validate(c);
 const sources=c.mode==='mixed'?[c.mixAudio,...c.speakers.map(s=>s.camera)]:c.speakers.flatMap(s=>[s.audio,s.camera]);
 if(!isTimeline())[...sources,...(c.wide?[c.wide]:[])].forEach(p=>{if(!fs.existsSync(p)||!fs.statSync(p).isFile())throw Error('Fichier introuvable : '+p);});
 if(isTimeline())await ensureTimelineUnchanged();
 if(c.mode==='mixed') {
   if(!diarization||diarization.key!==aiClient.fingerprint(c.mixAudio,Number($('voiceCount').value)))throw Error('Détectez les voix de ce mix avant de préparer le montage.');
   status('Analyse du mix et préparation des coupes…');
   const analysis=await core.analyzeWav(c.mixAudio,c.fps,p=>{$('progress').value=p*100;});
   const plan=mixed.makeMixedPlan(analysis,diarization.data,mapping,c);
   result={plan,c,analyses:[analysis],selection:isTimeline()?timelineSelection:null};showResult();status('Montage préparé avec un seul mix audio. Vérifiez les changements de caméra.');return;
 }
 const analyses=[];
 for(let i=0;i<c.speakers.length;i++) {status('Analyse locale du microphone '+(i+1)+' / '+c.speakers.length+'…');analyses.push(await core.analyzeWav(c.speakers[i].audio,c.fps,p=>{$('progress').value=(i+p)/c.speakers.length*100;}));}
 const plan=core.makePlan(analyses,c);result={plan,c,analyses};showResult();status('Montage préparé. Examinez les coupes, puis exportez ou créez la séquence.');
});
$('export').onclick=()=>run(async()=>{if(!result)throw Error('Relancez l’analyse.');let p=await host('podcastCutSave()');if(!p)return;if(!/\.xml$/i.test(p))p+='.xml';fs.writeFileSync(p,core.toXML(result.plan,result.c,result.analyses),'utf8');status('XML enregistré : '+p);});
$('import').onclick=()=>run(async()=>{if(!result)throw Error('Relancez l’analyse.');const dir=path.join(os.tmpdir(),'PodcastCut');fs.mkdirSync(dir,{recursive:true});if(result.selection){await ensureTimelineUnchanged();const request=timelineCore.makeApplyRequest(result.selection,result.plan,result.c.name);const script=path.join(dir,'apply-'+Date.now()+'.jsx');fs.writeFileSync(script,'podcastTimelineApply('+pcSafeJson(request)+');','utf8');status('Duplication de la séquence et application des coupes…');const done=JSON.parse(await host('$.evalFile('+JSON.stringify(script)+')'));status('Montage créé : '+done.name+' · '+done.shots+' plans. La séquence originale est conservée.');invalidate();return;}const p=path.join(dir,'podcast-'+Date.now()+'.xml');fs.writeFileSync(p,core.toXML(result.plan,result.c,result.analyses),'utf8');status('Import de la nouvelle séquence…');await host('podcastCutImport('+JSON.stringify(p)+')');status('Import accepté par Premiere. Retrouvez la nouvelle séquence dans le panneau Projet.');});
speakers=[{camera:'',audio:'',gain:0},{camera:'',audio:'',gain:0}];drawSpeakers();
if(!cep)status('Aperçu de l’interface. Pour choisir des fichiers et monter, ouvrez Podcast Cut dans Premiere Pro.');
else if(startupError)status('Impossible de charger le moteur : '+startupError,true);

function resetVoices(){diarization=null;mapping={};mixedPending=null;$('voiceMapping').hidden=true;$('voices').innerHTML='';invalidate();}
function drawMapping(){
  $('voices').innerHTML='';$('voiceMapping').hidden=!diarization;
  if(!diarization)return;
  diarization.data.speakers.forEach((s,i)=>{
    const row=document.createElement('div');row.className='voice';
    const title=document.createElement('strong');title.textContent='Voix '+(i+1)+' · extrait à '+Number(s.sampleStart).toFixed(1)+' s';row.appendChild(title);
    const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=req('url').pathToFileURL(s.sampleFile).href;
    audio.onplay=()=>document.querySelectorAll('.voice audio').forEach(other=>{if(other!==audio)other.pause();});row.appendChild(audio);
    const label=document.createElement('label');label.textContent='Caméra pour la voix '+(i+1);
    const select=document.createElement('select');const empty=document.createElement('option');empty.value='';empty.textContent='Choisir après écoute';select.appendChild(empty);
    speakers.forEach((s,j)=>{const opt=document.createElement('option');opt.value=String(j);opt.textContent=s.label||'Caméra '+(j+1);select.appendChild(opt);});
    select.value=mapping[s.id]===undefined?'':String(mapping[s.id]);
    select.onchange=()=>{if(select.value==='')delete mapping[s.id];else mapping[s.id]=Number(select.value);invalidate();};
    label.appendChild(select);row.appendChild(label);
    if(s.overlap){const hint=document.createElement('p');hint.className='hint';hint.textContent='Cet extrait peut contenir plusieurs voix : vérifiez la correspondance.';row.appendChild(hint);}
    $('voices').appendChild(row);
  });
}
$('mode').onchange=()=>{
  const isMixed=$('mode').value==='mixed';document.body.classList.toggle('mixed',isMixed);$('mixedSetup').hidden=!isMixed;
  if(isMixed&&speakers.length<4)while(speakers.length<4)speakers.push({camera:'',audio:'',gain:0});
  drawSpeakers();invalidate();drawMapping();
};
$('pickMix').onclick=()=>run(async()=>{const p=await pick('audio');if(p){$('mixAudio').value=p;resetVoices();}});
$('voiceCount').onchange=resetVoices;
$('aiRoot').oninput=resetVoices;
if(os)$('aiRoot').value=path.join(os.homedir(),'Documents','PodcastCut','AI');
$('detectVoices').onclick=()=>run(async()=>{
  if(!aiClient)throw Error('Ouvrez le panneau dans Premiere Pro pour lancer la détection.');
  const count=Number($('voiceCount').value),root=$('aiRoot').value;
  if(isTimeline()) {await ensureTimelineUnchanged();timelineSelection=getTimelineSelection();speakers=timelineSelection.cameraTracks.map(t=>({camera:'timeline:V'+(t+1),audio:'',gain:0,label:'V'+(t+1)+' · '+timelineSnapshot.video.find(v=>v.index===t).name}));status('Préparation du mix depuis les clips de la timeline…');$('mixAudio').value=await aiClient.prepareTimeline(timelineSelection,root);}
  const audio=$('mixAudio').value;
  if(!audio||!fs.existsSync(audio))throw Error('Choisissez le WAV contenant la conversation.');
  resetVoices();$('progress').value=0;status('Démarrage de la détection des voix…');
  detectionJob=aiClient.detect(audio,count,root,e=>{if(e.type==='status')status(e.message);if(e.type==='progress'){$('progress').value=e.value;status('Identification des voix : '+e.value+' %');}});
  $('cancelDetection').hidden=false;$('cancelDetection').disabled=false;
  try{diarization=await detectionJob.promise;mixed.validateDiarization(diarization.data,diarization.data.duration);diarization.data.speakers.forEach((voice,i)=>{if(mapping[voice.id]===undefined&&speakers.length)mapping[voice.id]=i%speakers.length;});drawMapping();status(diarization.data.speakers.length+' voix détectées. Les caméras sont associées automatiquement dans l’ordre des pistes ; corrigez seulement si besoin.'+(diarization.data.speakers.length!==count?' Le nombre détecté diffère du nombre demandé : vérifiez le résultat.':''));}
  finally{detectionJob=null;$('cancelDetection').hidden=true;}
});
$('cancelDetection').onclick=()=>{if(detectionJob){detectionJob.cancel();$('cancelDetection').disabled=true;status('Annulation…');}};
window.addEventListener('beforeunload',()=>{if(detectionJob)detectionJob.cancel();});

function isTimeline(){return $('workflow').value==='timeline';}
function getTimelineSelection(){return timelineCore.selectTimeline(timelineSnapshot,Array.from($('trackChoices').querySelectorAll('input:checked')).map(e=>Number(e.value)),Number($('audioTrack').value),$('wideTrack').value===''?null:Number($('wideTrack').value));}
async function ensureTimelineUnchanged(){if(!timelineSnapshot)throw Error('Cliquez sur Lire la timeline active.');const fresh=JSON.parse(await host('podcastTimelineRead()'));if(JSON.stringify(fresh)!==JSON.stringify(timelineSnapshot))throw Error('La timeline a changé. Relisez-la puis relancez la détection.');}
function selectionChanged(){timelineSelection=null;resetVoices();}
$('readTimeline').onclick=()=>run(async()=>{
  timelineSnapshot=JSON.parse(await host('podcastTimelineRead()'));selectionChanged();$('trackChoices').innerHTML='';$('audioTrack').innerHTML='';$('wideTrack').innerHTML='<option value="">Aucun</option>';
  const requested=Math.min(Number($('cameraCount').value)||2,6);timelineSnapshot.video.filter(t=>t.clips.length).forEach((t,i)=>{const label=document.createElement('label');label.className='check';const box=document.createElement('input');box.type='checkbox';box.value=String(t.index);box.checked=i<requested;box.onchange=selectionChanged;label.appendChild(box);label.appendChild(document.createTextNode('V'+(t.index+1)+' · '+t.name));$('trackChoices').appendChild(label);const opt=document.createElement('option');opt.value=String(t.index);opt.textContent='V'+(t.index+1)+' · '+t.name;$('wideTrack').appendChild(opt);});
  timelineSnapshot.audio.filter(t=>t.clips.length).forEach(t=>{const opt=document.createElement('option');opt.value=String(t.index);opt.textContent='A'+(t.index+1)+' · '+t.name;$('audioTrack').appendChild(opt);});
  $('sequenceInfo').textContent=timelineSnapshot.name+' · '+timelineSnapshot.fps.toFixed(3)+' i/s · '+timelineSnapshot.width+' × '+timelineSnapshot.height;$('name').value=timelineSnapshot.name+' — Podcast Cut';status('Timeline lue. Vérifiez les pistes puis détectez les voix.');
});
$('audioTrack').onchange=selectionChanged;$('wideTrack').onchange=selectionChanged;
$('cameraCount').onchange=()=>{const count=Number($('cameraCount').value)||2;Array.from($('trackChoices').querySelectorAll('input')).forEach((box,i)=>{box.checked=i<count;});selectionChanged();};
$('workflow').onchange=()=>{
  const timeline=isTimeline();resetVoices();timelineSelection=null;
  for(const id of ['fileSpeakers','fileSequence','modeLabel','mixFileLabel','export'])$(id).hidden=timeline;
  $('timelineSetup').hidden=!timeline;
  if(timeline){$('mode').value='mixed';$('mixedSetup').hidden=false;document.body.classList.add('mixed');$('removeSilence').checked=false;}
  $('removeSilence').disabled=timeline;
  $('rhythmHint').textContent=timeline?'Le mode timeline conserve les positions du son et des images. La suppression des silences reste disponible en mode fichiers.':'Le gain ajuste la détection, pas le volume du montage.';
  $('import').textContent=timeline?'Monter la copie de la timeline':'Créer dans Premiere';
  $('workflowHint').textContent=timeline?'Placez vos quatre caméras synchronisées sur V1 à V4 et le mix audio sur A1. L’extension montera une copie de cette séquence.':'Choisissez des caméras et des WAV déjà synchronisés au début de leurs fichiers.';
};
$('workflow').onchange();

// Simple timeline workflow: the main button is the only action needed for
// separate microphone tracks. It mirrors the common V1..V4 / A1..A4 podcast setup.
function simpleTracks(){
  return {video:timelineSnapshot?timelineSnapshot.video.filter(t=>t.clips.length):[],audio:timelineSnapshot?timelineSnapshot.audio.filter(t=>t.clips.length):[]};
}
function renderSimpleTracks(){
  if(!timelineSnapshot)return;
  const tracks=simpleTracks(),people=Math.min(Number($('voiceCount').value)||2,6),cameras=Math.min(Number($('cameraCount').value)||2,6),mixedMode=$('audioMode').value==='mixed';
  const audioBox=$('audioRows'),videoBox=$('videoRows');audioBox.innerHTML='';videoBox.innerHTML='';
  for(let i=0;i<(mixedMode?1:people);i++){
    const row=document.createElement('div');row.className='audio-row';
    const input=document.createElement('input');input.value=mixedMode?'Mix audio':'Intervenant '+(i+1);input.readOnly=true;
    const select=document.createElement('select');select.className=mixedMode?'simple-mix':'simple-audio';
    tracks.audio.forEach((t,j)=>{const o=document.createElement('option');o.value=String(t.index);o.textContent='A'+(t.index+1);o.selected=j===Math.min(i,tracks.audio.length-1);select.appendChild(o);});
    row.appendChild(input);row.appendChild(select);audioBox.appendChild(row);
  }
  for(let i=0;i<cameras;i++){
    const row=document.createElement('div');row.className='video-row';const top=document.createElement('div');top.className='video-row-top';
    const label=document.createElement('span');label.textContent='V'+(i+1);const select=document.createElement('select');select.className='simple-video';
    tracks.video.forEach((t,j)=>{const o=document.createElement('option');o.value=String(t.index);o.textContent='V'+(t.index+1)+' · '+t.name;o.selected=j===Math.min(i,tracks.video.length-1);select.appendChild(o);});
    const method=document.createElement('select');method.className='simple-method';
    [['average','Fréquence moyenne'],['strong','Voix dominante'],['stable','Montage stable']].forEach(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;method.appendChild(option);});
    top.appendChild(label);top.appendChild(select);top.appendChild(method);row.appendChild(top);
    // Role for this camera: which speaker it films, or the wide shot (used when several speak at once).
    const roleWrap=document.createElement('div');roleWrap.className='role-row';
    const role=document.createElement('select');role.className='simple-role';role.hidden=true;
    const chips=document.createElement('div');chips.className='chips';
    for(let p=0;p<people;p++){const o=document.createElement('option');o.value='spk'+p;o.textContent='Intervenant '+(p+1);role.appendChild(o);}
    const initial=i<people?[i]:[];initial.forEach(p=>{role.options[p].selected=true;});
    for(let p=0;p<people;p++){const chip=document.createElement('button');chip.type='button';chip.className='chip';chip.textContent='INTERVENANT '+(p+1);chip.dataset.role='spk'+p;chip.onclick=()=>{chip.classList.toggle('active');Array.from(role.options).find(o=>o.value===chip.dataset.role).selected=chip.classList.contains('active');};if(initial.includes(p))chip.classList.add('active');chips.appendChild(chip);}
    roleWrap.appendChild(role);roleWrap.appendChild(chips);row.appendChild(roleWrap);videoBox.appendChild(row);
  }
  // Keep the legacy selection in sync for the mix-audio option.
  $('trackChoices').innerHTML='';Array.from(document.querySelectorAll('.simple-video')).forEach(select=>{const box=document.createElement('input');box.type='checkbox';box.checked=true;box.value=select.value;$('trackChoices').appendChild(box);});
  $('audioTrack').innerHTML='';tracks.audio.forEach(t=>{const o=document.createElement('option');o.value=String(t.index);o.textContent='A'+(t.index+1);$('audioTrack').appendChild(o);});
}
function selectedSimpleTracks(selector){return Array.from(document.querySelectorAll(selector)).map(x=>Number(x.value));}
// Read the per-camera role dropdowns. Each camera films a given speaker ('spk'+k) or is the wide
// shot ('wide'). A speaker may own several cameras. Returns {speakerCameras: array[speaker] of
// track indices (>=1 each), wideTrack: index|null}.
function videoRoleAssignment(){
  const rows=Array.from(document.querySelectorAll('#videoRows .video-row'));
  const people=Math.min(Number($('voiceCount').value)||2,6);
  const tracks=rows.map(r=>Number(r.querySelector('.simple-video').value));
  if(tracks.length!==new Set(tracks).size)throw Error('Chaque ligne vidéo doit utiliser une piste caméra différente.');
  const speakerCameras=[];
  for(let k=0;k<people;k++){
    const cams=[];rows.forEach((r,i)=>{const chip=r.querySelector('.chip[data-role="spk'+k+'"]');if(chip&&chip.classList.contains('active'))cams.push(tracks[i]);});
    if(!cams.length)throw Error('Attribuez au moins une caméra à l’intervenant '+(k+1)+' (menu de rôle).');
    speakerCameras.push(cams);
  }
  const wideIdx=rows.map((r,i)=>({i,all:Array.from(r.querySelectorAll('.chip[data-role^="spk"]')).every(c=>c.classList.contains('active'))})).filter(x=>x.all);
  if(wideIdx.length>1)throw Error('Une seule caméra peut être associée à tous les intervenants.');
  const wideTrack=wideIdx.length?tracks[wideIdx[0].i]:null;
  return {speakerCameras,wideTrack};
}
async function readSimpleTimeline(){
  status('Lecture de la timeline Premiere…');
  const raw=await host('podcastTimelineRead()');timelineSnapshot=JSON.parse(raw);timelineSelection=null;resetVoices();
  $('name').value=timelineSnapshot.name+' — Podcast Cut';$('width').value=timelineSnapshot.width;$('height').value=timelineSnapshot.height;$('fps').value=timelineSnapshot.fps;
  renderSimpleTracks();status('Timeline prête : choisissez les pistes, puis démarrez le montage.');
}
async function createSimpleTimelineMontage(){
  if(!core||!aiClient)throw Error('Le moteur de montage n’est pas disponible. Fermez puis rouvrez Podcast Cut.');
  const root=$('aiRoot').value,audioTracks=selectedSimpleTracks('.simple-audio');
  const {speakerCameras,wideTrack}=videoRoleAssignment();
  const allCameraTracks=speakerCameras.reduce((a,c)=>a.concat(c),[]);
  if(audioTracks.length!==Number($('voiceCount').value)||audioTracks.some(n=>!Number.isFinite(n)))throw Error('Choisissez une piste audio pour chaque intervenant.');
  if(audioTracks.length!==new Set(audioTracks).size)throw Error('Chaque intervenant doit utiliser une piste audio différente. Pour un seul mix, utilisez le mode « Un seul mix audio ».');
  status('Vérification des pistes synchronisées…');
  const selections=audioTracks.map(track=>timelineCore.selectTimeline(timelineSnapshot,allCameraTracks,track,wideTrack));
  const reference=selections[0];selections.forEach(s=>{if(s.startFrame!==reference.startFrame||s.endFrame!==reference.endFrame)throw Error('Les pistes audio doivent avoir exactement le même début et la même fin.');});
  const c={mode:'separate',mixAudio:'',name:$('name').value,wide:wideTrack===null?'':'timeline-wide',analysisMethod:document.querySelector('.simple-method')?.value||'average',forceMin:Number($('forceMin')?.value||0),forceMax:Number($('forceMax')?.value||0),frequencyWeight:Number($('frequencyWeight')?.value||30),speakers:speakerCameras.map(cams=>({camera:'timeline:V'+(cams[0]+1),audio:'',gain:0})),removeSilence:false,threshold:Number($('threshold').value),minShot:Number($('minShot').value),hold:Number($('hold').value),silence:Number($('silence').value),padding:Number($('padding').value),width:timelineSnapshot.width,height:timelineSnapshot.height,fps:timelineSnapshot.fps};
  core.validate(c);const analyses=[];
  for(let i=0;i<selections.length;i++){
    status('Préparation de la piste A'+(audioTracks[i]+1)+' · '+(i+1)+' / '+selections.length+'…');
    const wav=await aiClient.prepareTimeline(selections[i],root);c.speakers[i].audio=wav;
    analyses.push(await core.analyzeWav(wav,c.fps,p=>{$('progress').value=((i+p)/selections.length)*100;}));
  }
  status('Analyse des voix et création de la copie…');const plan=core.makePlan(analyses,c);const request=timelineCore.makeApplyRequest(reference,plan,c.name,speakerCameras);const answer=JSON.parse(await host('podcastTimelineApply('+pcSafeJson(request)+')'));
  status('Montage créé : '+answer.name+' · '+answer.shots+' plans. La séquence originale est conservée.');
}
async function createMixedTimelineMontage(){
  throw Error('Pour garantir les bons changements de caméra, utilisez une piste audio séparée par intervenant. Un mix unique ne permet pas d’identifier de façon fiable quelle voix correspond à quelle caméra.');
}
$('startPodcast').onclick=()=>run(async()=>{const button=$('startPodcast');button.textContent=timelineSnapshot?'MONTAGE EN COURS…':'LECTURE ET MONTAGE…';try{if(!timelineSnapshot)await readSimpleTimeline();await ensureTimelineUnchanged();if($('audioMode').value==='mixed')await createMixedTimelineMontage();else await createSimpleTimelineMontage();}finally{button.textContent='DÉMARRER LE MONTAGE PODCAST';}});
$('voiceCount').onchange=()=>{resetVoices();renderSimpleTracks();};
$('cameraCount').onchange=()=>{resetVoices();renderSimpleTracks();};
$('audioMode').onchange=()=>{resetVoices();renderSimpleTracks();};
// Auto-align: import each person's mic file and drop it, synced, on an empty audio track, using the
// timeline's existing audio as the sync reference (cross-correlation, 100% local). Then "separate
// mics" mode can follow who speaks. This is the missing piece when you only have a mixed track.
// Reliable file picker via an HTML <input type=file> (ExtendScript File.openDialog is unreliable
// from a floating CEP panel). Node exposes the absolute path on the File object.
function pickFile(){return new Promise(resolve=>{const inp=$('micPicker');if(!inp)return resolve('');inp.value='';inp.disabled=false;const done=()=>{inp.removeEventListener('change',done);const f=inp.files&&inp.files[0];resolve(f?(f.path||f.name):'');};inp.addEventListener('change',done);inp.click();});}
async function alignMics(){
  if(!aiClient||!aiClient.alignMic)throw Error('Le moteur d’alignement est indisponible. Fermez puis rouvrez Podcast Cut.');
  if(!timelineSnapshot)await readSimpleTimeline();
  await ensureTimelineUnchanged();
  const root=$('aiRoot').value,fps=timelineSnapshot.fps,count=Number($('voiceCount').value);
  const refTrack=timelineSnapshot.audio.find(t=>!t.muted&&t.clips.filter(c=>!c.disabled).length);
  if(!refTrack)throw Error('Aucune piste audio de référence sur la timeline (posez au moins le mix, ex. sur A4).');
  const rc=refTrack.clips.filter(c=>!c.disabled).slice().sort((a,b)=>a.start-b.start);
  const startFrame=Math.ceil(rc[0].start*fps-1e-5),endFrame=Math.floor(rc[rc.length-1].end*fps+1e-5);
  const selection={snapshot:timelineSnapshot,start:startFrame/fps,end:endFrame/fps,audioClips:rc,startFrame,endFrame,cameraTracks:[],cameras:[],audioTrack:refTrack.index,wideTrack:null};
  const emptyTracks=timelineSnapshot.audio.filter(t=>t.clips.filter(c=>!c.disabled).length===0).map(t=>t.index).sort((a,b)=>a-b);
  if(emptyTracks.length<count)throw Error('Ajoutez '+count+' pistes audio vides à la séquence (clic droit dans l’en-tête des pistes → Ajouter une piste), puis relancez.');
  status('Extraction du son de référence de la timeline…');
  const refWav=await aiClient.prepareTimeline(selection,root);
  const report=[];
  for(let i=0;i<count;i++){
    status('Intervenant '+(i+1)+'/'+count+' : choisissez le fichier micro (WAV)…');
    const mic=await pickFile();
    if(!mic){status('Alignement annulé. Aucune modification.');return;}
    status('Alignement du micro '+(i+1)+'…');$('progress').value=(i/count)*100;
    const al=await aiClient.alignMic(refWav,mic,root);
    const at=selection.start+al.offset,atClamped=Math.max(0,at),inSec=at<0?-at:0;
    const req={path:mic,trackIndex:emptyTracks[i],atSeconds:atClamped,inSeconds:inSec};
    const res=JSON.parse(await host('podcastPlaceMic('+pcSafeJson(req)+')'));
    report.push('A'+(emptyTracks[i]+1)+' = intervenant '+(i+1)+' (décalage '+al.offset.toFixed(2)+' s'+(al.confident?'':', ⚠ à vérifier')+')');
  }
  timelineSnapshot=null;await readSimpleTimeline();
  status('Micros calés : '+report.join(' · ')+'. Choisissez la piste de chaque intervenant, puis DÉMARRER LE MONTAGE.');
}
if($('alignMics'))$('alignMics').onclick=()=>run(alignMics);
$('advancedToggle').onclick=()=>{const body=$('advancedBody');body.hidden=!body.hidden;};
function openPodcastScreen(){ $('home').hidden=true; $('podcast').hidden=false; if(cep&&!timelineSnapshot)run(readSimpleTimeline); }
function openHomeScreen(){ $('podcast').hidden=true; $('home').hidden=false; }
if($('openPodcast'))$('openPodcast').onclick=openPodcastScreen;
if($('backHome'))$('backHome').onclick=openHomeScreen;
setTimeout(()=>{ $('splash').hidden=true; $('home').hidden=false; },1200);

})();
