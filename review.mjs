import{SCHEMA,LABELS,effective,touched,safeHTML,mediaURL,zipStore,unzipStored,validateImport}from'./review-core.mjs?v=16';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const channelNames={'TG компании':'Юнитрамп · Telegram','TG Романа':'Роман Сотников · Telegram','TG Кирилла':'Кирилл Шувалов · Telegram','TG Екатерины':'Екатерина Тюкавкина · Telegram','TG Оксаны':'Оксана Журман · Telegram','VK':'ВК · посты','VK Клипы':'ВК · клипы','Instagram':'Instagram компании',YouTube:'YouTube · полный выпуск','YouTube Shorts':'YouTube Shorts','IG Reels':'Instagram · Reels'};
const tags=['Текст','Фото / баннер','Видео','Другое'],labels=LABELS;
let db=null,storageFailed=false,pending=0,queue=Promise.resolve(),posts=[],targets=new Map(),records=new Map(),audioCache=new Map(),currentKey='',slide=0,urls=[],mediaBusy=false,recording=null,recognition=null,captureToken=0,memoryDirty=false,saveTimer,toastTimer;
const statusOf=t=>effective(records.get(t.key),t.version);
function toast(s){$('toast').textContent=s;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function error(s,local=false){const el=$(local?'review-error':'global-error');el.textContent=s;el.hidden=!s;}
function recordFor(t){return records.get(t.key)||{key:t.key,id:t.post.id,variant:t.variant,decision:'',decisionVersion:'',notes:'',tags:[],attachments:[],history:[],updatedAt:new Date().toISOString()};}
function context(t){return{id:t.post.id,variant:t.variant,title:t.post.title,date:t.post.date,time:t.post.time,channel:t.label,text:t.text,media:t.media,version:t.version};}
function updateSave(){
 const el=$('save-state');el.classList.toggle('save-failed',storageFailed);
 el.textContent=storageFailed?'Правки пока только в открытой странице — скачай файл':pending?'Сохраняю изменения…':'Все изменения сохранены в этом браузере';
}
function transaction(stores,fn){return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');try{fn(tx);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('Не удалось сохранить'));tx.onabort=()=>reject(tx.error||Error('Сохранение отменено'));});}
async function initDB(){
 try{
  db=await new Promise((resolve,reject)=>{const q=indexedDB.open('unitramp-review-v1',1);q.onupgradeneeded=()=>{const d=q.result;d.createObjectStore('records',{keyPath:'key'});d.createObjectStore('audio',{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('Закрой другую вкладку согласования и обнови страницу'));});
  const a=await new Promise((resolve,reject)=>{const q=db.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  records=new Map(a.filter(r=>typeof r.key==='string'&&typeof r.notes==='string'&&Array.isArray(r.attachments)).map(r=>[r.key,r]));
  db.onversionchange=()=>{db.close();db=null;storageFailed=true;updateSave();error('Хранилище обновилось в другой вкладке. Скачай текущие правки и обнови страницу.');};
 }catch(e){storageFailed=true;db=null;error('Браузер не разрешил автосохранение. Можно работать здесь, но перед закрытием обязательно скачай файл правок.');}
 updateSave();
}
function persist(rec,audios=[]){
 const copy=structuredClone(rec);for(const a of audios)audioCache.set(a.id,a.blob);pending++;updateSave();
 queue=queue.then(async()=>{if(!db||storageFailed){memoryDirty=true;return;}await transaction(['records','audio'],tx=>{tx.objectStore('records').put(copy);for(const a of audios)tx.objectStore('audio').put(a);});}).catch(e=>{storageFailed=true;memoryDirty=true;error('Не удалось сохранить последние изменения. Скачай файл правок перед закрытием страницы.');}).finally(()=>{pending--;updateSave();});
 return queue;
}
function change(fn,audios=[]){
 const t=targets.get(currentKey);if(!t)return;const r=recordFor(t);for(const a of r.attachments)if(!a.contentVersion)a.contentVersion=r.contentVersion||r.decisionVersion||'';fn(r);r.updatedAt=new Date().toISOString();r.contentVersion=t.version;r.context=context(t);records.set(t.key,r);persist(r,audios);updateSummary();renderList();updateDecision();
}
async function getAudio(id){
 if(audioCache.has(id))return audioCache.get(id);if(!db)return null;
 const x=await new Promise((resolve,reject)=>{const q=db.transaction('audio').objectStore('audio').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 if(x?.blob)audioCache.set(id,x.blob);return x?.blob||null;
}
function visibleTargets(p){const out=[targets.get(p.id+'::main')];if(targets.has(p.id+'::ig'))out.push(targets.get(p.id+'::ig'));return out;}
function matching(t){
 const filter=$('status-filter').value,r=records.get(t.key);
 return !filter||(filter==='commented'?(r?.notes?.trim()||r?.attachments?.some(a=>!a.removed)):statusOf(t)===filter);
}
function filtered(){
 const s=$('search').value.trim().toLocaleLowerCase('ru'),ch=$('channel').value;
 return posts.filter(p=>(!ch||p.channel===ch)&&(!s||(p.id+' '+p.title+' '+p.text+' '+(p.instagram_text||'')).toLocaleLowerCase('ru').includes(s))&&visibleTargets(p).some(matching));
}
function renderList(){
 const a=filtered();$('nav-count').textContent=a.length+' / '+posts.length;
 $('post-list').innerHTML=a.length?a.map(p=>{const ts=visibleTargets(p),active=ts.some(t=>t.key===currentKey),s=statusOf(ts[0]),bits=ts.map(t=>(t.variant==='ig'?'IG':p.channel.startsWith('TG ')?'TG':'')+(t.variant==='ig'||p.channel.startsWith('TG ')?' · ':'')+labels[statusOf(t)]).join(' / ');return'<button type="button" data-post="'+esc(p.id)+'" class="'+(active?'active':'')+'" aria-current="'+(active?'true':'false')+'" '+(mediaBusy?'disabled':'')+'><span class="item-meta"><b>'+esc(p.id)+'</b><span>'+p.date.slice(8)+'.12</span></span><span class="item-title">'+esc(p.title)+'</span><span class="item-status '+s+'">'+esc(bits)+'</span></button>';}).join(''):'<p class="empty">Здесь пока нет постов. Попробуй другой канал или решение.</p>';
}
function updateSummary(){
 const count={pending:0,approved:0,rework:0,remove:0};for(const t of targets.values())count[statusOf(t)]++;
 for(const k in count)$('n-'+k).textContent=count[k];const checked=targets.size-count.pending;$('progress-fill').style.width=checked/targets.size*100+'%';
 $('plan-count').textContent=posts.length+' поста · '+targets.size+' версий для согласования · проверено '+checked;
}
function updateDecision(){
 const t=targets.get(currentKey);if(!t)return;const r=recordFor(t),s=statusOf(t),el=$('current-decision');el.textContent=labels[s];el.className='decision '+s;
 $('stale').hidden=!(r.decision&&r.decisionVersion!==t.version);$('clear-decision').hidden=!r.decision;
 for(const b of document.querySelectorAll('[data-decision]')){b.classList.toggle('selected',b.dataset.decision===s);b.setAttribute('aria-pressed',String(b.dataset.decision===s));}
 $('scope').textContent='Решение относится к версии «'+t.label+'». '+(t.post.instagram_text&&t.variant==='main'?'Instagram проверяется отдельно.':'');
}
function renderTags(){
 const r=recordFor(targets.get(currentKey));$('tags').innerHTML=tags.map(s=>'<button type="button" data-tag="'+esc(s)+'" aria-pressed="'+r.tags.includes(s)+'">'+esc(s)+'</button>').join('');
}
function renderMedia(){
 for(const u of urls)URL.revokeObjectURL(u);urls=[];const t=targets.get(currentKey),a=t.media||[],m=a[slide];$('media').replaceChildren();
 if(!m){$('media').innerHTML='<p class="muted">'+(t.post.poll?'Это опрос — изображение не требуется.':'Текстовая публикация — без изображения.')+'</p>';return;}
 const figure=document.createElement('figure'),asset=document.createElement(m.kind==='video'?'video':'img');asset.src=mediaURL(m.file);
 if(m.kind==='video'){asset.controls=true;asset.playsInline=true;asset.preload='metadata';if(m.poster)asset.poster=mediaURL(m.poster);}
 else{asset.alt=t.post.title+' · слайд '+(slide+1);asset.decoding='async';}
 asset.addEventListener('error',()=>error('Не удалось загрузить медиа. Открой оригинал или обнови страницу.',true));
 figure.append(asset);const cap=document.createElement('figcaption'),txt=document.createElement('span');txt.textContent=m.caption||'Материал публикации';const link=document.createElement('a');link.href=mediaURL(m.file);link.target='_blank';link.rel='noopener';link.textContent='Открыть оригинал ↗';cap.append(txt,link);figure.append(cap);$('media').append(figure);
 if(a.length>1){const controls=document.createElement('div');controls.className='slide-controls';controls.innerHTML='<button type="button" data-slide="'+(slide-1)+'" aria-label="Предыдущий слайд" '+(slide===0?'disabled':'')+'>←</button><span>Слайд '+(slide+1)+' из '+a.length+'</span><button type="button" data-slide="'+(slide+1)+'" aria-label="Следующий слайд" '+(slide===a.length-1?'disabled':'')+'>→</button>';$('media').append(controls);const thumbs=document.createElement('div');thumbs.className='thumbs';for(let i=0;i<a.length;i++){const b=document.createElement('button');b.type='button';b.dataset.slide=String(i);b.className=i===slide?'active':'';b.setAttribute('aria-label','Показать слайд '+(i+1));const im=document.createElement('img');im.src=mediaURL(a[i].poster||a[i].file);im.alt='';im.loading='lazy';b.append(im);thumbs.append(b);}$('media').append(thumbs);}
}
async function renderAudios(){
 const owner=currentKey,t=targets.get(owner),r=recordFor(t),host=$('audios');host.replaceChildren();const oldRows=r.attachments.filter(a=>!a.removed&&(a.contentVersion||r.contentVersion||r.decisionVersion)&&(a.contentVersion||r.contentVersion||r.decisionVersion)!==t.version);let archive=null;if(oldRows.length){archive=document.createElement('details');archive.className='feedback-history';const summary=document.createElement('summary');summary.textContent='Голосовые к предыдущим версиям · '+oldRows.length;archive.append(summary);host.append(archive);}
 for(const[aidx,a]of r.attachments.entries()){
  if(owner!==currentKey)return;
  const row=document.createElement('div');
  if(a.removed){row.className='removed-audio';row.innerHTML='Запись убрана <button type="button" class="quiet" data-restore-audio="'+esc(a.id)+'">Вернуть</button>';host.append(row);continue;}
  row.className='audio-row';row.innerHTML='<div class="audio-info"><span>Голосовое '+(aidx+1)+(a.duration?' · '+time(a.duration):'')+'</span><button type="button" data-remove-audio="'+esc(a.id)+'" aria-label="Убрать голосовое '+(aidx+1)+'">Убрать</button></div>';const historical=(a.contentVersion||r.contentVersion||r.decisionVersion)&&(a.contentVersion||r.contentVersion||r.decisionVersion)!==t.version;(historical&&archive?archive:host).append(row);
  try{const b=await getAudio(a.id);if(owner!==currentKey)return;if(!b){const warn=document.createElement('p');warn.className='muted';warn.textContent='Аудиофайл недоступен. Можно восстановить его из выгрузки.';row.append(warn);continue;}const u=URL.createObjectURL(b);urls.push(u);const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=u;row.append(audio);}
  catch(e){row.append('Не удалось открыть запись');}
 }
}
function renderCurrent(){
 const t=targets.get(currentKey),r=recordFor(t),p=t.post;error('',true);$('post-id').textContent=p.id;$('post-date').textContent=p.date.slice(8)+'.12 · '+p.time+' ЕКБ';$('post-channel').textContent=t.label;$('post-title').textContent=p.title;$('post-format').textContent=t.variant==='ig'?'Instagram · адаптация':p.format;$('post-format').textContent+=(p.publication_dependency?' · После полного FPV-выпуска 9 декабря':'');$('review-for').textContent=p.id+' · твоё решение';
 $('notes').value=r.notes;$('post-text').replaceChildren(safeHTML(t.html));
 const variants=visibleTargets(p);$('variant-tabs').innerHTML=variants.length>1?variants.map(x=>'<button type="button" data-variant="'+x.variant+'" class="'+(x.key===currentKey?'active':'')+'" '+(mediaBusy?'disabled':'')+'>'+esc(x.variant==='ig'?'Instagram':'Telegram + Макс')+'</button>').join(''):'';
 const extra=[];if(p.poll)extra.push('ОПРОС\n'+p.poll.question+'\n'+p.poll.options.map((v,i)=>(i+1)+'. '+v).join('\n')+'\n'+(p.poll.multiple_answers?'Можно выбрать несколько ответов':'Один вариант ответа'));if(p.first_comment)extra.push('ПЕРВЫЙ КОММЕНТАРИЙ\n'+p.first_comment);
 $('extras').replaceChildren();for(const s of extra){const box=document.createElement('div');box.className='extras';box.textContent=s;$('extras').append(box);}
 renderMedia();renderAudios();renderTags();updateDecision();renderList();updateSteps();history.replaceState(null,'','#'+encodeURIComponent(p.id)+'/'+t.variant);
}
function updateSteps(){const a=filtered(),id=targets.get(currentKey)?.post.id,i=a.findIndex(p=>p.id===id);$('position').textContent=(i<0?'—':i+1)+' / '+a.length;$('prev').disabled=mediaBusy||i<=0;$('next').disabled=mediaBusy||i<0||i>=a.length-1;}
function go(key){
 if(mediaBusy){toast('Сначала заверши запись или диктовку.');return;}if(!targets.has(key))return;currentKey=key;slide=0;renderCurrent();if(matchMedia('(max-width:980px)').matches)$('postnav').open=false;
}
function goRelative(n){const a=filtered(),i=a.findIndex(p=>p.id===targets.get(currentKey).post.id),p=a[i+n];if(p)go(visibleTargets(p).find(matching)?.key||p.id+'::main');}
function time(s){const n=Math.max(0,Math.floor(s));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function lock(v){mediaBusy=v;$('export').disabled=v;$('import').disabled=v;$('attach-audio').disabled=v;$('search').disabled=v;$('channel').disabled=v;$('status-filter').disabled=v;for(const b of document.querySelectorAll('[data-variant]'))b.disabled=v;renderList();updateSteps();}
function resetVoice(){lock(false);$('record').hidden=false;$('record').disabled=false;$('stop-record').hidden=true;$('timer').hidden=true;$('notes').readOnly=false;$('dictate').textContent='Начать диктовку';$('record').disabled=!(window.MediaRecorder&&navigator.mediaDevices?.getUserMedia);}
function ext(mime){return mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':mime.includes('mpeg')?'mp3':mime.includes('wav')?'wav':'webm';}
async function addAudio(blob,meta={}){
 if(!blob.size)throw Error('Запись пуста — попробуй ещё раз.');
 if(blob.size>50*1024*1024)throw Error('Запись больше 50 МБ. Выбери более короткий файл.');
 const id=crypto.randomUUID(),mime=blob.type||meta.mime||'audio/webm',a={id,mime,createdAt:new Date().toISOString(),duration:meta.duration||null,file:'audio/'+id+'.'+ext(mime),contentVersion:targets.get(currentKey).version};
 change(r=>r.attachments.push(a),[{id,targetKey:currentKey,blob}]);await queue;await renderAudios();
}
async function startRecording(){
 if(mediaBusy)return;error('',true);const token=++captureToken;lock(true);$('record').disabled=true;$('record').hidden=true;$('stop-record').hidden=false;$('stop-record').textContent='Отменить';$('voice-state').textContent='Разреши доступ к микрофону в окне браузера…';
 let stream;
 try{
  document.querySelectorAll('audio,video').forEach(el=>el.pause());
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  if(token!==captureToken){stream.getTracks().forEach(t=>t.stop());return;}
  const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(v=>MediaRecorder.isTypeSupported(v)),rec=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:48000}),chunks=[],started=Date.now(),owner=currentKey;
  let resolveDone;const done=new Promise(resolve=>resolveDone=resolve);recording={rec,stream,done};
  const tick=setInterval(()=>{const elapsed=(Date.now()-started)/1000;$('timer').textContent=time(elapsed);if(elapsed>=600)stopRecording();},500);
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.onerror=e=>error('Запись прервалась. Сохранился доступный фрагмент; прослушай его.',true);
  rec.onstop=async()=>{clearInterval(tick);stream.getTracks().forEach(t=>t.stop());try{if(currentKey!==owner)throw Error('Пост сменился во время записи');await addAudio(new Blob(chunks,{type:rec.mimeType||mime||'audio/webm'}),{duration:(Date.now()-started)/1000});$('voice-state').textContent=storageFailed?'Запись добавлена. Скачай файл правок, чтобы её сохранить.':'Голосовое добавлено к этому посту. Можно прослушать ниже.';}catch(e){error(e.message,true);}finally{recording=null;resetVoice();resolveDone();}};
  rec.start(500);$('timer').hidden=false;$('timer').textContent='00:00';$('stop-record').textContent='■ Закончить запись';$('voice-state').textContent='Идёт запись для '+targets.get(owner).post.id+'. До 10 минут.';
 }catch(e){stream?.getTracks().forEach(t=>t.stop());if(token!==captureToken)return;resetVoice();$('voice-state').textContent='Запись не началась.';error(e.name==='NotAllowedError'?'Микрофон не разрешён. Разреши его в настройках этой страницы или прикрепи готовое аудио.':e.name==='NotFoundError'?'Микрофон не найден. Можно подключить его или прикрепить аудио.':'Не удалось начать запись: '+e.message,true);}
}
async function stopRecording(){
 if(!recording){captureToken++;resetVoice();$('voice-state').textContent='Запись отменена.';return;}
 if(recording.rec.state!=='inactive'){$('stop-record').disabled=true;recording.rec.stop();}await recording.done;$('stop-record').disabled=false;
}
function startDictation(){
 if(recognition){recognition.stop();return;}if(mediaBusy)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;
 const rec=new SR(),owner=currentKey,base=$('notes').value;recognition=rec;lock(true);$('notes').readOnly=true;$('dictate').textContent='Закончить диктовку';$('interim').textContent='Слушаю…';rec.lang='ru-RU';rec.continuous=true;rec.interimResults=true;
 rec.onresult=e=>{if(owner!==currentKey)return;let final='',interim='';for(const v of e.results){if(v.isFinal)final+=v[0].transcript+' ';else interim+=v[0].transcript;}
  const text=base+(base.trim()&&final.trim()?'\n':'')+final.trim();$('notes').value=text;change(r=>r.notes=text);$('interim').textContent=interim||'Слушаю…';};
 rec.onerror=e=>{if(e.error!=='no-speech')error(e.error==='not-allowed'?'Браузер не разрешил диктовку. Можно записать голосовое или ввести текст.':'Диктовка остановилась. Готовый текст сохранён; можно продолжить вручную.',true);};
 rec.onend=()=>{recognition=null;resetVoice();$('interim').textContent='Диктовка закончена. Проверь распознанный текст.';};
 try{rec.start();}catch(e){recognition=null;resetVoice();error('Не удалось включить диктовку. Используй запись голосового.',true);}
}
function decision(value){
 change(r=>{if(r.decision)r.history.push({decision:r.decision,decisionVersion:r.decisionVersion,notes:r.notes,updatedAt:r.updatedAt});r.decision=value;r.decisionVersion=value?targets.get(currentKey).version:'';});
 toast(value?labels[value]+' · '+targets.get(currentKey).post.id:'Решение снято');
}
function plainSummary(pkg){
 const title=['UNITRAMP · замечания к декабрю 2026','Сформировано: '+new Date(pkg.exportedAt).toLocaleString('ru-RU'),'Проверено решений: '+pkg.records.filter(r=>r.effectiveDecision!=='pending').length,''];
 for(const r of pkg.records){const c=r.context||{};title.push(r.id+' · '+(c.channel||r.variant)+' · '+(c.title||''),'Решение: '+labels[r.effectiveDecision]+(r.decision&&r.effectiveDecision==='pending'?' (прежнее решение устарело)':''));if(r.tags?.length)title.push('К чему: '+r.tags.join(', '));if(r.notes?.trim())title.push('Замечания:\n'+r.notes);for(const a of r.attachments)title.push('Голосовое: '+a.file);title.push('');}
 return title.join('\n');
}
async function exportFeedback(){
 if(mediaBusy){toast('Закончи запись, затем скачай правки.');return;}await queue;
 const rows=[...records.values()].filter(touched);if(!rows.length){toast('Пока нет замечаний или решений. Выбери пост и оставь обратную связь.');return;}
 $('export').disabled=true;
 try{
  const files=[],rr=[];let total=0;
  for(const src of rows){const r=structuredClone(src),t=targets.get(r.key);r.attachments=r.attachments.filter(a=>!a.removed);r.effectiveDecision=t?effective(r,t.version):'pending';r.currentContentVersion=t?.version||null;r.context=t?context(t):r.context;
   for(const a of r.attachments){const b=await getAudio(a.id);if(!b)throw Error('Не найдена запись для '+r.id+'. Прикрепи её заново или убери из замечаний.');total+=b.size;if(total>220*1024*1024)throw Error('Голосовых больше 220 МБ. Скачай записи по отдельности или сократи подборку.');files.push({name:a.file,data:b});}rr.push(r);
  }
  const pkg={schema:SCHEMA,month:'2026-12',exportedAt:new Date().toISOString(),planVersion:window.reviewDataVersion,sourceURL:new URL('review.html',location.href).href,records:rr};
  const en=new TextEncoder();files.unshift({name:'feedback.json',data:en.encode(JSON.stringify(pkg,null,2))},{name:'ЗАМЕЧАНИЯ.txt',data:en.encode(plainSummary(pkg))});const blob=await zipStore(files),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='UNITRAMP-правки-декабрь-'+new Date().toISOString().slice(0,10)+'.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);memoryDirty=false;toast('Файл правок подготовлен. Прикрепи ZIP к нашему чату — в нём замечания и голосовые.');
 }catch(e){error('Выгрузка не получилась: '+e.message);}
 finally{$('export').disabled=false;}
}
async function importFeedback(file){
 if(!file||mediaBusy)return;error('');if(file.size>250*1024*1024){error('Файл больше250 МБ.');return;}
 try{
  const files=unzipStored(new Uint8Array(await file.arrayBuffer()));if(!files.has('feedback.json'))throw Error('В архиве нет feedback.json');
  const pkg=validateImport(JSON.parse(new TextDecoder().decode(files.get('feedback.json'))),files);let imported=0;
  for(const r of pkg.records){const old=records.get(r.key);if(old&&Date.parse(old.updatedAt)>=Date.parse(r.updatedAt))continue;const clean={key:r.key,id:r.key.split('::')[0],variant:r.key.split('::')[1],notes:r.notes,tags:r.tags,decision:r.decision||'',decisionVersion:r.decisionVersion||'',contentVersion:r.contentVersion||'',updatedAt:r.updatedAt,context:r.context||null,history:Array.isArray(r.history)?r.history:[],attachments:r.attachments.map(a=>({id:a.id,file:a.file,mime:a.mime,duration:a.duration||null,createdAt:a.createdAt||r.updatedAt,contentVersion:a.contentVersion||r.contentVersion||r.decisionVersion||''}))};if(old)clean.history.push({decision:old.decision,decisionVersion:old.decisionVersion,notes:old.notes,updatedAt:old.updatedAt});
   const audios=clean.attachments.map(a=>({id:a.id,targetKey:clean.key,blob:new Blob([files.get(a.file)],{type:a.mime})}));records.set(clean.key,clean);await persist(clean,audios);imported++;
  }
  updateSummary();renderList();renderCurrent();toast('Загружены замечания к '+imported+' версиям. Более новые правки в этом браузере сохранены.');
 }catch(e){error('Не удалось загрузить правки: '+e.message);}
 finally{$('import').value='';}
}
$('search').addEventListener('input',()=>{renderList();updateSteps();});
for(const k of ['channel','status-filter'])$(k).addEventListener('change',()=>{renderList();updateSteps();});
$('post-list').addEventListener('click',e=>{const b=e.target.closest('[data-post]');if(b){const p=posts.find(x=>x.id===b.dataset.post);go(visibleTargets(p).find(matching)?.key||p.id+'::main');}});
$('variant-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-variant]');if(b)go(targets.get(currentKey).post.id+'::'+b.dataset.variant);});
$('media').addEventListener('click',e=>{const b=e.target.closest('[data-slide]');if(b){slide=Number(b.dataset.slide);renderMedia();renderAudios();}});
$('notes').addEventListener('input',()=>change(r=>r.notes=$('notes').value));
$('tags').addEventListener('click',e=>{const b=e.target.closest('[data-tag]');if(b){change(r=>{const k=b.dataset.tag;r.tags=r.tags.includes(k)?r.tags.filter(x=>x!==k):[...r.tags,k];});renderTags();}});
document.querySelectorAll('[data-decision]').forEach(b=>b.addEventListener('click',()=>decision(b.dataset.decision)));
$('clear-decision').addEventListener('click',()=>decision(''));
$('prev').addEventListener('click',()=>goRelative(-1));$('next').addEventListener('click',()=>goRelative(1));
$('next-pending').addEventListener('click',()=>{if(mediaBusy)return;const all=filtered().flatMap(visibleTargets),idx=all.findIndex(t=>t.key===currentKey),rot=[...all.slice(idx+1),...all.slice(0,idx+1)],t=rot.find(t=>statusOf(t)==='pending');if(t)go(t.key);else toast('В выбранной подборке больше нет версий без решения.');});
$('jump-review').addEventListener('click',()=>$('review-panel').scrollIntoView({behavior:'smooth',block:'start'}));
$('jump-post').addEventListener('click',()=>document.querySelector('.preview').scrollIntoView({behavior:'smooth',block:'start'}));
$('copy-post').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(targets.get(currentKey).text);toast('Текст поста скопирован');}catch{toast('Браузер не разрешил копирование. Можно выделить текст вручную.');}});
$('record').addEventListener('click',startRecording);$('stop-record').addEventListener('click',stopRecording);$('dictate').addEventListener('click',startDictation);
$('audios').addEventListener('click',e=>{const b=e.target.closest('[data-remove-audio],[data-restore-audio]');if(b){const id=b.dataset.removeAudio||b.dataset.restoreAudio;change(r=>{const a=r.attachments.find(x=>x.id===id);if(a)a.removed=!!b.dataset.removeAudio;});renderAudios();}});
$('attach-audio').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const ext=f.name.split('.').pop().toLowerCase(),types={m4a:'audio/mp4',mp4:'audio/mp4',webm:'audio/webm',ogg:'audio/ogg',wav:'audio/wav',mp3:'audio/mpeg'};if(!types[ext]&&!f.type.startsWith('audio/'))throw Error('Выбери аудиофайл');const b=new Blob([f],{type:f.type.startsWith('audio/')?f.type:types[ext]});await addAudio(b);toast('Аудио добавлено к посту');}catch(x){error(x.message,true);}finally{e.target.value='';}});
$('export').addEventListener('click',exportFeedback);$('import').addEventListener('change',e=>importFeedback(e.target.files[0]));
window.addEventListener('beforeunload',e=>{if(mediaBusy||pending||memoryDirty){e.preventDefault();e.returnValue='';}});
async function init(){
 try{
  const res=await fetch('./review-data.json?v=15',{cache:'no-store'});if(!res.ok)throw Error('План недоступен');const data=await res.json();if(data.month!=='2026-12'||!Array.isArray(data.posts)||data.posts.length===0||new Set(data.posts.map(p=>p.id)).size!==data.posts.length)throw Error('Некорректная версия плана');
  const live=await fetch('./dec-2026.json?reviewSource='+data.source_sha256,{cache:'no-store'});if(!live.ok)throw Error('Актуальный план недоступен');const bytes=await live.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==data.source_sha256)throw Error('План обновлён. Согласование новой версии ещё готовится; прежние замечания сохранены.');
  posts=data.posts;window.reviewDataVersion=data.version;
  for(const p of posts){const personal=!!p.max_text;targets.set(p.id+'::main',{key:p.id+'::main',post:p,variant:'main',version:p.review_versions.main,text:p.text,html:p.text_html||p.text,media:p.media_items||[],label:(channelNames[p.channel]||p.channel)+(personal?' + Макс':'')});if(personal&&p.instagram_text&&p.review_versions.ig)targets.set(p.id+'::ig',{key:p.id+'::ig',post:p,variant:'ig',version:p.review_versions.ig,text:p.instagram_text,html:p.instagram_html||p.instagram_text,media:p.instagram_media||p.media_items||[],label:(channelNames[p.channel]||p.channel).replace(' · Telegram','')+' · Instagram'});}
  await initDB();for(const c of [...new Set(posts.map(p=>p.channel))]){const op=document.createElement('option');op.value=c;op.textContent=channelNames[c]||c;$('channel').append(op);}
  const h=decodeURIComponent(location.hash.slice(1)).split('/'),key=h[0]+'::'+(h[1]||'main');currentKey=targets.has(key)?key:posts[0].id+'::main';
  $('workspace').hidden=false;$('loading').hidden=true;$('export').disabled=false;if(matchMedia('(max-width:980px)').matches)$('postnav').open=false;
  $('dictation-options').hidden=!(window.SpeechRecognition||window.webkitSpeechRecognition);if(!(window.MediaRecorder&&navigator.mediaDevices?.getUserMedia)){$('record').disabled=true;$('voice-state').textContent='Запись микрофона здесь недоступна. Можно прикрепить аудио или ввести текст.';}
  updateSummary();renderCurrent();
 }catch(e){$('loading').hidden=true;error('Не удалось открыть согласование. Обнови страницу. Если ошибка повторится, напиши мне. '+e.message);}
}
init();
