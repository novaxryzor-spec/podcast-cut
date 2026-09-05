function podcastCutPick(kind) {
    var f = File.openDialog(kind === 'audio' ? 'Choisir un WAV synchronisé' : 'Choisir une caméra synchronisée', kind === 'audio' ? '*.wav' : '*.*', false);
    return f ? f.fsName : '';
}
function podcastCutSave() {
    var f = File.saveDialog('Enregistrer la séquence Podcast Cut', '*.xml');
    return f ? f.fsName : '';
}
function podcastCutImport(path) {
    try {
        if (!app.project || !app.project.path) return 'ERREUR: Ouvrez et enregistrez un projet Premiere avant l’import.';
        if (!File(path).exists) return 'ERREUR: XML introuvable.';
        var before = app.project.sequences.numSequences;
        if (!app.project.importFiles([path], true, app.project.rootItem, false)) return 'ERREUR: Premiere a refusé l’import XML.';
        return app.project.sequences.numSequences > before ? 'OK' : 'ERREUR: Import accepté, mais aucune nouvelle séquence détectée. Vérifiez le panneau Projet et importez le XML manuellement si nécessaire.';
    } catch (e) { return 'ERREUR: ' + e.toString(); }
}
// Import a per-person mic WAV and drop it on an audio track at a given sequence time (seconds),
// so "separate mics" mode can then follow who speaks. Additive and reversible (Undo).
function podcastPlaceMic(request) {
    try {
        if (!app.project || !app.project.path) return 'ERREUR: Enregistrez le projet Premiere avant de caler les micros.';
        var seq = app.project.activeSequence;
        if (!seq) return 'ERREUR: Ouvrez la sequence de rushes.';
        var f = new File(request.path);
        if (!f.exists) return 'ERREUR: Micro introuvable : ' + request.path;
        var root = app.project.rootItem, before = {};
        for (var i = 0; i < root.children.numItems; i++) before[root.children[i].nodeId] = true;
        if (!app.project.importFiles([request.path], true, root, false)) return 'ERREUR: Premiere a refuse l import du micro.';
        var item = null;
        for (i = 0; i < root.children.numItems; i++) if (!before[root.children[i].nodeId]) { item = root.children[i]; break; }
        if (!item) for (i = 0; i < root.children.numItems; i++) { try { if (root.children[i].getMediaPath && root.children[i].getMediaPath() === f.fsName) { item = root.children[i]; break; } } catch (e) {} }
        if (!item) return 'ERREUR: Micro importe mais introuvable dans le panneau Projet.';
        var idx = Number(request.trackIndex);
        if (!(idx >= 0) || idx >= seq.audioTracks.numTracks) return 'ERREUR: Piste A' + (idx + 1) + ' inexistante. Ajoutez des pistes audio a la sequence.';
        var track = seq.audioTracks[idx];
        if (request.inSeconds && Number(request.inSeconds) > 0) { try { item.setInPoint(Number(request.inSeconds), 1); } catch (e) {} }
        var at = Number(request.atSeconds); if (!(at >= 0)) at = 0;
        var n0 = track.clips.numItems;
        track.overwriteClip(item, at);
        if (track.clips.numItems <= n0) return 'ERREUR: Placement du micro echoue sur A' + (idx + 1) + ' (piste verrouillee ou occupee ?).';
        return pcJSON({ ok: true, track: idx, at: at, name: String(item.name) });
    } catch (e) { return 'ERREUR: ' + e.toString(); }
}

function pcJSON(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return '"' + value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\t/g,'\\t').replace(/[\u0000-\u001f]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);}) + '"';
    if (typeof value === 'number') return isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    var parts = [], k;
    if (value instanceof Array) { for(k=0;k<value.length;k++) parts.push(pcJSON(value[k])); return '['+parts.join(',')+']'; }
    for(k in value) if(value.hasOwnProperty(k)) parts.push(pcJSON(k)+':'+pcJSON(value[k]));
    return '{'+parts.join(',')+'}';
}
function pcSnapshot() {
    var seq=app.project.activeSequence;
    if(!seq) throw new Error('Ouvrez une sequence de rushes synchronises.');
    var settings=seq.getSettings();
    var data={sequenceId:String(seq.sequenceID),name:String(seq.name),timebase:String(seq.timebase),zeroPoint:String(seq.zeroPoint),fps:254016000000/Number(seq.timebase),width:Number(settings.videoFrameWidth),height:Number(settings.videoFrameHeight),video:[],audio:[]};
    function tracks(collection) {
        var list=[];
        for(var i=0;i<collection.numTracks;i++) {
            var track=collection[i],transitionCount=0,muted=false;
            // A freshly created/empty Premiere track can expose one of these collections
            // a few milliseconds after the sequence is activated. Treat it as empty rather
            // than aborting the whole panel read.
            try {muted=Boolean(track.isMuted());} catch(ignoreMute) {muted=false;}
            try {transitionCount=track.transitions&&Number(track.transitions.numItems)||0;} catch(ignoreTransitions) {transitionCount=0;}
            var item={index:i,name:String(track.name||('Track '+(i+1))),muted:muted,transitions:transitionCount,clips:[]};
            for(var j=0;j<track.clips.numItems;j++) {
                var c=track.clips[j],p=c.projectItem,speed=1,reverse=false,nested=false,mediaPath='';
                try {if(c.getSpeed)speed=Number(c.getSpeed());} catch(ignoreSpeed) {speed=1;}
                try {if(c.isSpeedReversed)reverse=Boolean(c.isSpeedReversed());} catch(ignoreReverse) {reverse=false;}
                try {if(p&&p.isSequence)nested=Boolean(p.isSequence());} catch(ignoreNested) {nested=false;}
                try {if(p&&p.getMediaPath)mediaPath=String(p.getMediaPath());} catch(ignorePath) {mediaPath='';}
                item.clips.push({id:String(c.nodeId||('clip-'+i+'-'+j)),name:String(c.name||''),path:mediaPath,nested:nested,start:Number(c.start.seconds),end:Number(c.end.seconds),inPoint:Number(c.inPoint.seconds),outPoint:Number(c.outPoint.seconds),speed:speed,reverse:reverse,disabled:Boolean(c.disabled)});
            }
            list.push(item);
        }
        return list;
    }
    data.video=tracks(seq.videoTracks);data.audio=tracks(seq.audioTracks);
    return data;
}
function podcastTimelineRead() {
    try {return pcJSON(pcSnapshot());} catch(e) {return 'ERREUR: '+e.toString();}
}
function pcSequenceById(id) {
    for(var i=0;i<app.project.sequences.numSequences;i++) if(String(app.project.sequences[i].sequenceID)===String(id))return app.project.sequences[i];
    return null;
}
function pcCrossesAt(track,seconds,fps) {
    var cl=track.clips;
    for(var i=0;i<cl.numItems;i++)if(cl[i].start.seconds<seconds-0.1/fps&&cl[i].end.seconds>seconds+0.1/fps)return true;
    return false;
}
function podcastTimelineApply(request) {
    var original=null,copy=null,oldZero='0';
    try {
        var current=pcSnapshot();
        if(pcJSON(current)!==pcJSON(request.snapshot))throw new Error('La timeline a change. Cliquez sur Lire la timeline puis relancez l analyse.');
        if(!request.segments.length||request.segments.length>10000)throw new Error('Nombre de plans invalide.');
        var next=request.startFrame, validTracks={};
        for(var vt=0;vt<request.cameraTracks.length;vt++)validTracks[request.cameraTracks[vt]]=true;
        for(var si=0;si<request.segments.length;si++) {
            var segment=request.segments[si];
            if(segment.start!==next||segment.end<=segment.start||segment.start%1||segment.end%1||!validTracks[segment.track])throw new Error('Coupes invalides.');
            next=segment.end;
        }
        if(next!==request.endFrame)throw new Error('Plage de montage incomplete.');
        original=app.project.activeSequence;
        var before={};
        for(var i=0;i<app.project.sequences.numSequences;i++)before[String(app.project.sequences[i].sequenceID)]=true;
        if(original.clone()===false)throw new Error('Premiere a refuse la duplication de la sequence.');
        for(i=0;i<app.project.sequences.numSequences;i++)if(!before[String(app.project.sequences[i].sequenceID)]) {if(copy)throw new Error('Plusieurs copies inattendues.');copy=app.project.sequences[i];}
        if(!copy)throw new Error('Duplication de sequence impossible.');
        copy.name=request.name;
        if(copy.projectItem)copy.projectItem.name=request.name;
        app.project.openSequence(copy.sequenceID);
        if(String(app.project.activeSequence.sequenceID)!==String(copy.sequenceID))throw new Error('Impossible d activer la copie.');
        app.enableQE();
        var qseq=qe.project.getActiveSequence();
        if(!qseq)throw new Error('API de coupe Premiere indisponible.');
        oldZero=String(copy.zeroPoint);copy.setZeroPoint('0');
        // QE razor accepts non-drop timecode. Reset only the copy's display origin.
        var base=Math.round(current.fps),ticksPerFrame=Number(current.timebase),copySettings=copy.getSettings();
        function tc(frame) {
            if(typeof Time!=='undefined') {
                // +0.25 frame: frame/fps can land just below the exact frame time in floating point
                // (e.g. 6902/25 -> 276.0799999), and getFormatted truncates that to the PREVIOUS
                // frame, cutting one frame early. A quarter-frame nudge keeps us squarely in `frame`.
                var moment=new Time();moment.seconds=(frame+0.25)/current.fps;
                return String(moment.getFormatted(copySettings.videoFrameRate,copy.videoDisplayFormat));
            }
            function pad(n){return n<10?'0'+n:String(n);}
            var seconds=Math.floor(frame/base);
            return pad(Math.floor(seconds/3600))+':'+pad(Math.floor(seconds/60)%60)+':'+pad(seconds%60)+':'+pad(frame%base);
        }
        var boundaries=[request.startFrame];
        for(si=0;si<request.segments.length;si++)boundaries.push(request.segments[si].end);
        for(vt=0;vt<request.cameraTracks.length;vt++) {
            var index=request.cameraTracks[vt],track=copy.videoTracks[index];
            if(!track||!qseq.getVideoTrackAt(index))throw new Error('Piste video indisponible dans la copie.');
            for(var b=0;b<boundaries.length;b++) {
                var frame=boundaries[b],seconds=frame/current.fps,tries=0;
                // QE track handles grow unreliable after many razors on the same track, which broke
                // montages with lots of cuts. Re-fetch the QE track for every cut and retry.
                while(pcCrossesAt(copy.videoTracks[index],seconds,current.fps)&&tries<4) {
                    var qs=qe.project.getActiveSequence(),qtk=qs&&qs.getVideoTrackAt(index);
                    if(!qtk)throw new Error('API de coupe indisponible sur V'+(index+1)+'.');
                    qtk.razor(tc(frame));tries++;
                }
                if(pcCrossesAt(copy.videoTracks[index],seconds,current.fps))throw new Error('Coupe non appliquee sur V'+(index+1)+'. Verifiez le verrouillage de piste et la cadence.');
            }
            track=copy.videoTracks[index];
            var pointer=0;
            for(ci=0;ci<track.clips.numItems;ci++) {
                var clip=track.clips[ci],middle=(Number(clip.start.ticks)+Number(clip.end.ticks))/(2*ticksPerFrame);
                if(middle<request.startFrame||middle>=request.endFrame)continue;
                while(pointer<request.segments.length-1&&request.segments[pointer].end<=middle)pointer++;
                clip.disabled=request.segments[pointer].track!==index;
                if(Boolean(clip.disabled)!==(request.segments[pointer].track!==index))throw new Error('Activation de camera refusee.');
            }
        }
        // All original mix edits/effects remain in place; avoid doubled camera audio.
        for(var a=0;a<copy.audioTracks.numTracks;a++) {
            var shouldMute=a!==request.audioTrack;
            copy.audioTracks[a].setMute(shouldMute?1:0);
            if(Boolean(copy.audioTracks[a].isMuted())!==shouldMute)throw new Error('Premiere a refuse le réglage de la piste audio A'+(a+1)+'.');
        }
        copy.setZeroPoint(oldZero);
        return pcJSON({ok:true,sequenceId:String(copy.sequenceID),name:String(copy.name),shots:request.segments.length});
    } catch(e) {
        var cleanup='';
        try {if(original)app.project.openSequence(original.sequenceID);if(copy&&!app.project.deleteSequence(copy))cleanup=' La copie partielle peut subsister : supprimez-la avant de reessayer.';}catch(ignore){cleanup=' Une copie partielle peut subsister dans le projet.';}
        return 'ERREUR: '+e.toString()+cleanup;
    }
}
