export const SCHEMA='unitramp-review/1';
export const LABELS={pending:'Без решения',approved:'Одобрено',rework:'Переделать',remove:'Убрать'};
export function effective(record,version){return record?.decision&&record.decisionVersion===version?record.decision:'pending';}
export function touched(r){return !!(r.decision||r.notes?.trim()||r.tags?.length||r.attachments?.some(a=>!a.removed));}
export function safeHTML(html){
 const doc=new DOMParser().parseFromString(html||'','text/html');
 const allowed=new Set(['STRONG','B','EM','I','U','S','BR','P','UL','OL','LI','A','BLOCKQUOTE']);
 function clean(node){const frag=document.createDocumentFragment();for(const child of node.childNodes){if(child.nodeType===3){frag.append(child.textContent);continue;}if(child.nodeType!==1)continue;if(['SCRIPT','STYLE','IFRAME','OBJECT'].includes(child.tagName))continue;const inner=clean(child);if(!allowed.has(child.tagName)){frag.append(inner);continue;}const el=document.createElement(child.tagName.toLowerCase());if(child.tagName==='A'){try{const u=new URL(child.getAttribute('href'));if(!['http:','https:'].includes(u.protocol)){frag.append(inner);continue;}el.href=u.href;el.target='_blank';el.rel='noopener noreferrer';}catch{frag.append(inner);continue;}}el.append(inner);frag.append(el);}return frag;}
 return clean(doc.body);
}
export function mediaURL(path){if(typeof path!=='string'||!/^media\/[A-Za-zА-Яа-яЁё0-9_/. ()-]+$/.test(path)||path.includes('..'))throw Error('Некорректный путь медиа');return new URL(path,location.href).href;}
const enc=new TextEncoder(),dec=new TextDecoder();
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export async function zipStore(files){
 const parts=[],central=[];let offset=0;const now=new Date(),dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),dosDate=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
 for(const f of files){
  const name=enc.encode(f.name),data=f.data instanceof Uint8Array?f.data:new Uint8Array(await f.data.arrayBuffer()),crc=crc32(data);
  const h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(10,dosTime,true);v.setUint16(12,dosDate,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);h.set(name,30);parts.push(h,data);
  const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(12,dosTime,true);cv.setUint16(14,dosDate,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=h.length+data.length;
 }
 const length=central.reduce((a,b)=>a+b.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,length,true);ev.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
export function unzipStored(bytes){
 if(bytes.byteLength>250*1024*1024)throw Error('Файл больше250 МБ. Раздели записи на несколько выгрузок.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new Map();let p=0,total=0;
 while(p+4<=bytes.length&&view.getUint32(p,true)===0x04034b50){
  if(p+30>bytes.length)throw Error('Повреждённый архив');
  const flags=view.getUint16(p+6,true),method=view.getUint16(p+8,true),crc=view.getUint32(p+14,true),len=view.getUint32(p+18,true),raw=view.getUint32(p+22,true),nl=view.getUint16(p+26,true),xl=view.getUint16(p+28,true),start=p+30+nl+xl;
  if(method!==0||flags&9||len!==raw)throw Error('Выбери ZIP, скачанный из этой страницы согласования');
  if(start+len>bytes.length||nl===0||out.size>5000)throw Error('Повреждённый архив');
  const name=dec.decode(bytes.subarray(p+30,p+30+nl));if(name.includes('..')||name.startsWith('/')||name.includes('\\')||out.has(name))throw Error('Некорректное имя файла');
  const data=bytes.slice(start,start+len);if(crc32(data)!==crc)throw Error('Файл повреждён: '+name);total+=len;if(total>250*1024*1024)throw Error('Слишком большой архив');
  out.set(name,data);p=start+len;
 }
 if(!out.size||p+4>bytes.length||view.getUint32(p,true)!==0x02014b50)throw Error('Не удалось прочитать архив правок');
 return out;
}
export function validateImport(pkg,files){
 if(pkg.schema!==SCHEMA||pkg.month!=='2026-12'||!Array.isArray(pkg.records)||pkg.records.length>500)throw Error('Это не файл согласования декабря UNITRAMP');
 const keys=new Set(),audio=new Set();
 for(const r of pkg.records){
  if(typeof r.key!=='string'||!/^[A-ZА-ЯЁ0-9-]+::(main|ig)$/.test(r.key)||keys.has(r.key))throw Error('Некорректная запись поста');keys.add(r.key);
  if(!['','approved','rework','remove'].includes(r.decision||'')||typeof r.notes!=='string'||r.notes.length>100000||!Array.isArray(r.attachments)||r.attachments.length>100)throw Error('Некорректные замечания');
  if(!Array.isArray(r.tags)||r.tags.some(x=>!['Текст','Фото / баннер','Видео','Другое'].includes(x)))throw Error('Некорректные метки');
  if(!Number.isFinite(Date.parse(r.updatedAt)))throw Error('Некорректная дата замечания');
  for(const a of r.attachments){
   if(!/^[a-f0-9-]{36}$/.test(a.id)||audio.has(a.id)||!/^audio\/[a-f0-9-]{36}\.(webm|mp4|m4a|ogg|wav|mp3)$/.test(a.file)||typeof a.mime!=='string'||!(/^(audio\/|video\/mp4)/.test(a.mime)))throw Error('Некорректная аудиозапись');
   audio.add(a.id);const f=files.get(a.file);if(!f||f.length>50*1024*1024)throw Error('Не найдена аудиозапись: '+a.file);
  }
 }
 return pkg;
}
