'use strict';
// 所有个人记录只写入当前站点的本地存储，不发送网络请求。
const STORAGE_KEY = 'body-daily-records-v1';
const TYPES = {food:'吃饭',water:'喝水',bowel:'排便',weight:'体重',alcohol:'喝酒'};
const COLORS = {food:['#28734f','#eaf5ec'],water:['#326db0','#eaf3ff'],bowel:['#9a7121','#fff5db'],weight:['#7d5da5','#f3edfa'],alcohol:['#a46028','#fff0df']};
// 每 100 克可食部分的近似千卡；烹饪方式和品牌会影响实际值。
const FOODS = [
  ['米饭',116,150,'碗'],['白粥',46,250,'碗'],['面条（熟）',110,200,'碗'],['馒头',223,100,'个'],['包子（肉）',230,100,'个'],['全麦面包',250,35,'片'],['吐司',266,30,'片'],['燕麦片（干）',389,40,'份'],['红薯（蒸）',86,150,'个'],['土豆（煮）',87,150,'个'],['玉米（熟）',112,150,'份'],['鸡蛋（水煮）',144,50,'个'],['鸡胸肉（熟）',165,100,'份'],['牛肉（熟瘦肉）',200,100,'份'],['猪肉（瘦）',143,100,'份'],['鱼肉（清蒸）',120,100,'份'],['虾（熟）',99,100,'份'],['豆腐',81,100,'份'],['西兰花',34,100,'份'],['黄瓜',15,100,'份'],['番茄',18,100,'份'],['苹果',52,180,'个'],['香蕉',89,100,'根'],['橙子',47,130,'个'],['草莓',32,100,'份'],['牛奶（全脂）',61,250,'杯'],['酸奶（原味）',72,100,'杯'],['花生',567,20,'份'],['杏仁',579,20,'份'],['食用油',900,10,'勺'],['饺子（肉）',220,25,'个'],['炒饭',180,250,'份'],['炸鸡',260,100,'份'],['披萨',266,100,'片'],['蛋糕',350,100,'份']
].map(([name,kcal,grams,unit]) => ({name,kcal,grams,unit}));
// 酒精度为体积分数（%）；碳水含量含糖，单位为克 / 100 ml。
const DRINKS = {beer:{name:'啤酒',abv:5,carbs:3.5},wine:{name:'干红 / 干白葡萄酒',abv:12,carbs:2.5},sweet:{name:'甜葡萄酒',abv:12,carbs:10},baijiu:{name:'白酒',abv:52,carbs:0},spirit:{name:'威士忌 / 伏特加',abv:40,carbs:0},rice:{name:'黄酒',abv:15,carbs:5},cocktail:{name:'鸡尾酒（参考配方）',abv:10,carbs:12},other:{name:'其他 / 自定义',abv:0,carbs:0}};
const $ = selector => document.querySelector(selector);
const fmt = n => Number(n).toLocaleString('zh-CN',{maximumFractionDigits:1});
const round = n => Math.round(n * 10) / 10;
function localDay(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function localTime(date = new Date()) { return `${localDay(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`; }
function alcoholCalories(ml, abv, carbs) { return round(ml * abv / 100 * 0.789 * 7 + ml / 100 * carbs * 4); }
function foodCalories(grams, per100) { return round(grams * per100 / 100); }
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records = [], activeType = 'food', manualCalories = false, storageBlocked = false, readyOffline = false;
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true,4000); }
function storageError(message) { $('#storage-error').textContent = message; $('#storage-error').hidden = false; }
function validRecord(r) {
  const num = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!r || typeof r.id !== 'string' || !Object.hasOwn(TYPES,r.type) || typeof r.time !== 'string' || !Number.isFinite(Date.parse(r.time)) || typeof r.note !== 'string') return false;
  if (r.type === 'food') return typeof r.name === 'string' && num(r.grams,0.1,100000) && num(r.calories,0,100000);
  if (r.type === 'water') return num(r.ml,1,100000);
  if (r.type === 'weight') return num(r.kg,0.1,1000);
  if (r.type === 'bowel') return ['成型软便','干硬','稀便','水样','带粘液'].includes(r.stool) && typeof r.pain === 'boolean';
  return typeof r.name === 'string' && num(r.ml,1,100000) && num(r.abv,0,100) && num(r.carbs,0,100) && num(r.calories,0,1000000);
}
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { records=[]; return; }
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.records) || !data.records.every(validRecord) || new Set(data.records.map(r => r.id)).size !== data.records.length) throw new Error('数据格式异常');
    records = data.records;
  } catch (error) {
    storageBlocked = true;
    storageError('无法安全读取本地记录，已停止写入，原始数据不会被覆盖。请保留网站数据并检查浏览器存储权限；若数据损坏，请先备份原始 localStorage 内容。');
  }
}
function persist(next) {
  if (storageBlocked) { toast('本地存储不可用，未保存'); return false; }
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,records:next})); records=next; $('#storage-error').hidden=true; return true; }
  catch (error) { storageError('保存失败：设备存储已满或浏览器禁止存储。表单仍保留，请导出现有记录并检查存储设置。'); return false; }
}
function numeric(name,min,max) {
  const el = document.querySelector(`[name="${name}"]`);
  const n = Number(el.value);
  if (el.value.trim() === '' || !Number.isFinite(n) || n<min || n>max) throw new Error('请填写有效的'+el.closest('label').childNodes[0].textContent.trim());
  return n;
}
function field(label,name,options='') { return `<label>${label}<input name="${name}" ${options}></label>`; }
function renderFields() {
  manualCalories=false;
  let content='';
  const kcalBox = `<div class="calorie-box">${field('总热量（千卡，可修改）','calories','type="number" min="0" max="1000000" step="0.1" inputmode="decimal" required')}<p id="estimate-hint" class="hint"></p><button type="button" id="auto-calories" class="text-button">恢复自动估算</button></div>`;
  if (activeType === 'food') content = `${field('食物名称','name','list="food-list" maxlength="100" autocomplete="off" required placeholder="例如：米饭、鸡蛋（水煮）"')}<datalist id="food-list">${FOODS.map(f=>`<option value="${f.name}"></option>`).join('')}</datalist><div class="form-row">${field('份量','quantity','type="number" min="0.1" max="100000" step="0.1" value="100" inputmode="decimal" required')}<label>单位<select name="unit"><option value="g">克</option><option value="serving">份（按食物参考份量）</option></select></label></div><p class="hint" id="food-reference">输入热量库中的名称可自动估算；其他食物请手动填写热量。</p>${kcalBox}`;
  if (activeType === 'water') content = field('饮水量（ml）','ml','type="number" min="1" max="100000" step="1" value="250" inputmode="numeric" required');
  if (activeType === 'weight') content = field('体重（kg）','kg','type="number" min="0.1" max="1000" step="0.1" inputmode="decimal" placeholder="例如：60.5" required');
  if (activeType === 'bowel') content = '<label>大便性状<select name="stool"><option>成型软便</option><option>干硬</option><option>稀便</option><option>水样</option><option>带粘液</option></select></label><label>是否腹痛<select name="pain"><option value="no">否</option><option value="yes">是</option></select></label>';
  if (activeType === 'alcohol') content = `<label>酒类参考<select name="drink">${Object.entries(DRINKS).map(([k,d])=>`<option value="${k}">${d.name}</option>`).join('')}</select></label>${field('酒名 / 品牌','name','value="啤酒" maxlength="100" required')}<div class="form-row">${field('饮用量（ml）','ml','type="number" min="1" max="100000" step="1" value="330" inputmode="numeric" required')}${field('酒精度（% vol）','abv','type="number" min="0" max="100" step="0.1" value="5" inputmode="decimal" required')}</div>${field('碳水化合物（克 / 100 ml，含糖）','carbs','type="number" min="0" max="100" step="0.1" value="3.5" inputmode="decimal" required')}<p class="hint">参考值可修改，请以酒瓶标签为准。鸡尾酒按整杯体积与最终酒精度填写，糖浆、果汁等计入碳水；配方不明确时请直接填写总热量。</p>${kcalBox}`;
  $('#type-fields').innerHTML=content;
  $('#save-record').textContent=`保存${TYPES[activeType]}记录`;
  if ($('[name="calories"]')) {
    $('[name="calories"]').addEventListener('input',()=>{manualCalories=true; $('#estimate-hint').textContent='已使用手动热量；改变份量后请重新确认。';});
    $('#auto-calories').addEventListener('click',()=>{manualCalories=false;estimate();});
    $('#type-fields').addEventListener('input',handleEstimate);
    if (activeType==='alcohol') $('[name="drink"]').addEventListener('change',()=>{const d=DRINKS[$('[name="drink"]').value]; ['name','abv','carbs'].forEach(k=>$(`[name="${k}"]`).value=d[k]);manualCalories=false;estimate();});
    estimate();
  }
}
function handleEstimate(event) { if (event.target.name !== 'calories') estimate(); }
function matchedFood() { return FOODS.find(f=>f.name===$('[name="name"]').value.trim()); }
function estimate() {
  if (!['food','alcohol'].includes(activeType)) return;
  let total;
  if (activeType==='food') {
    const food=matchedFood();
    $('#food-reference').textContent=food ? `${food.kcal} 千卡 / 100 克；1 份约 ${food.grams} 克（1 ${food.unit}）。按可食部分重量计算。` : '未匹配热量库，请用克填写份量，并手动填写总热量。';
    if (food) total=foodCalories(Number($('[name="quantity"]').value)*($('[name="unit"]').value==='serving'?food.grams:1),food.kcal);
  } else total=alcoholCalories(Number($('[name="ml"]').value),Number($('[name="abv"]').value),Number($('[name="carbs"]').value));
  if (manualCalories) return;
  $('[name="calories"]').value=Number.isFinite(total)?total:'';
  $('#estimate-hint').textContent=Number.isFinite(total)?(activeType==='alcohol'?'自动估算：酒精热量 + 碳水热量；其他成分未计入。':'自动估算，仅供日常记录参考。'):'没有匹配的食物，请手动填写热量。';
}
function createRecord() {
  const form=new FormData($('#record-form'));
  const date=new Date(form.get('time'));
  if (!Number.isFinite(date.getTime()) || date.getTime()>Date.now()+60000) throw new Error('记录时间不能晚于当前时间');
  const r={id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`,type:activeType,time:date.toISOString(),note:form.get('note').trim()};
  if (['food','alcohol'].includes(activeType)) {r.name=form.get('name').trim(); if(!r.name) throw new Error('请填写名称');r.calories=numeric('calories',0,activeType==='food'?100000:1000000);r.calorieSource=manualCalories?'手动填写':'自动估算';}
  if (activeType==='food') {const f=matchedFood();r.quantity=numeric('quantity',0.1,100000);r.unit=form.get('unit');if(!f && r.unit==='serving') throw new Error('自定义食物请使用克作为单位');r.grams=round(r.quantity*(r.unit==='serving'?f.grams:1));if(r.grams>100000) throw new Error('份量过大，请检查单位');}
  if (['water','alcohol'].includes(activeType)) r.ml=numeric('ml',1,100000);
  if (activeType==='alcohol') {r.abv=numeric('abv',0,100);r.carbs=numeric('carbs',0,100);r.alcoholGrams=round(r.ml*r.abv/100*0.789);}
  if (activeType==='weight') r.kg=numeric('kg',0.1,1000);
  if (activeType==='bowel') {r.stool=form.get('stool');r.pain=form.get('pain')==='yes';}
  if (!validRecord(r)) throw new Error('记录数据无效，请检查输入');
  return r;
}
function summarize(list) {
  const sum={food:0,alcohol:0,calories:0,water:0,ml:0,bowel:0,weight:null,weightTime:0};
  list.forEach(r=>{if(r.type==='food'||r.type==='alcohol') sum[r.type]+=r.calories;if(r.type==='water')sum.water+=r.ml;if(r.type==='alcohol')sum.ml+=r.ml;if(r.type==='bowel')sum.bowel++;if(r.type==='weight' && Date.parse(r.time)>=sum.weightTime){sum.weight=r.kg;sum.weightTime=Date.parse(r.time);}});
  sum.food=round(sum.food);sum.alcohol=round(sum.alcohol);sum.calories=round(sum.food+sum.alcohol);return sum;
}
function lastSevenDays(now=new Date()) { return Array.from({length:7},(_,i)=>{const d=new Date(now);d.setHours(12,0,0,0);d.setDate(d.getDate()-6+i);return localDay(d);}); }
function render() {
  const today=localDay();
  $('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  const s=summarize(records.filter(r=>localDay(new Date(r.time))===today));
  $('#today-calories').textContent=fmt(s.calories);$('#today-water').textContent=fmt(s.water);$('#today-alcohol').textContent=fmt(s.ml);$('#calorie-detail').textContent=`食物 ${fmt(s.food)} · 酒类 ${fmt(s.alcohol)}`;$('#alcohol-detail').textContent=`酒类热量 ${fmt(s.alcohol)} 千卡`;
  $('#record-count').textContent=`${records.length} 条记录`;
  if (!records.length) $('#record-list').innerHTML='<div class="empty"><b>从今天的第一笔开始</b><span>吃了什么、喝了多少，都可以记在这里。</span></div>';
  else {
    let lastDay='';
    $('#record-list').innerHTML=[...records].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).map(r=>{
      const d=new Date(r.time),day=localDay(d);const heading=day!==lastDay?`<h3 class="date-heading">${day===today?'今天 · ':''}${day}</h3>`:'';lastDay=day;
      const title=r.type==='food'?r.name:r.type==='water'?`${fmt(r.ml)} ml 水`:r.type==='weight'?`${fmt(r.kg)} kg`:r.type==='bowel'?r.stool:r.name;
      const detail=r.type==='food'?`${fmt(r.grams)} 克 · ${fmt(r.calories)} 千卡`:r.type==='alcohol'?`${fmt(r.ml)} ml · ${fmt(r.abv)}% vol · ${fmt(r.calories)} 千卡`:r.type==='bowel'?`腹痛：${r.pain?'是':'否'}`:'';
      return `${heading}<article class="record" style="--accent:${COLORS[r.type][0]};--tint:${COLORS[r.type][1]}"><div class="record-head"><span class="record-kind">${TYPES[r.type]}</span><time datetime="${esc(r.time)}">${d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</time></div><h3>${esc(title)}</h3>${detail?`<p>${esc(detail)}</p>`:''}${r.note?`<p>${esc(r.note)}</p>`:''}<div class="record-bottom"><span>${esc(r.calorieSource||'已记录')}</span><button class="delete" data-delete="${esc(r.id)}" aria-label="删除${esc(TYPES[r.type])}记录：${esc(title)}">删除</button></div></article>`;
    }).join('');
  }
  renderStats();
}
function chart(days,values,color,label,line=false) {
  const W=520,H=215,left=45,right=22,top=30,bottom=36,base=H-bottom;
  const available=values.filter(v=>v!==null);if(line&&!available.length)return '<div class="empty"><b>还没有体重记录</b><span>记录体重后，这里会显示最近 7 天的趋势。</span></div>';
  const min=line?Math.floor(Math.min(...available)-1):0,max=line?Math.ceil(Math.max(...available)+1):(label==='排便次数'?Math.max(2,Math.ceil(Math.max(0,...available)/2)*2):Math.max(1,...available)*1.2);
  const step=(W-left-right)/7,x=i=>left+step*(i+.5),y=v=>base-(v-min)/(max-min)*(base-top);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><title>${label}；详细数值见每日明细表</title>`;
  for(let i=0;i<3;i++){const v=min+(max-min)*i/2,yy=y(v);svg+=`<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}" stroke="#e6eeea"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${fmt(v)}</text>`;}
  // 未称重日期断开连线，避免将空缺误当成实际测量。
  if(line){for(let i=1;i<7;i++)if(values[i]!==null&&values[i-1]!==null)svg+=`<line x1="${x(i-1)}" y1="${y(values[i-1])}" x2="${x(i)}" y2="${y(values[i])}" stroke="${color}" stroke-width="3"/>`;}
  values.forEach((v,i)=>{svg+=`<text x="${x(i)}" y="${H-10}" text-anchor="middle">${days[i].slice(5).replace('-','/')}</text>`;if(v===null)return;if(line)svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="${color}"/>`;else svg+=`<rect x="${x(i)-15}" y="${y(v)}" width="30" height="${base-y(v)}" rx="5" fill="${color}"/>`;svg+=`<text class="value" x="${x(i)}" y="${y(v)-10}" text-anchor="middle">${fmt(v)}</text>`;});
  return svg+'</svg>';
}
function renderStats() {
  const days=lastSevenDays(), data=days.map(day=>summarize(records.filter(r=>localDay(new Date(r.time))===day)));
  $('#stats-range').textContent=`${days[0].slice(5)} — ${days[6].slice(5)}`;
  $('#calorie-chart').innerHTML=chart(days,data.map(s=>s.calories),'#428267','摄入热量');$('#water-chart').innerHTML=chart(days,data.map(s=>s.water),'#6099cf','饮水量');$('#bowel-chart').innerHTML=chart(days,data.map(s=>s.bowel),'#c29b50','排便次数');$('#weight-chart').innerHTML=chart(days,data.map(s=>s.weight),'#9273b4','体重变化',true);
  $('#stats-table').innerHTML=data.map((s,i)=>`<tr><td>${days[i].slice(5)}</td><td>${fmt(s.calories)}</td><td>${fmt(s.water)}</td><td>${s.bowel}</td><td>${s.weight===null?'—':fmt(s.weight)}</td><td>${fmt(s.ml)}</td><td>${fmt(s.alcohol)}</td></tr>`).join('');
}
// 电子表格公式防护；所有列都引用，保留逗号、引号与换行。
function csvCell(value) {let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function buildCSV(list) {
  const rows=[['记录编号','类型','本地时间','UTC时间','名称','食物重量（克）','输入份量','份量单位','饮水量（ml）','喝酒量（ml）','酒精度（%vol）','碳水（克/100ml）','纯酒精（克）','热量（千卡）','热量来源','大便性状','腹痛','体重（kg）','备注']];
  [...list].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).forEach(r=>rows.push([r.id,TYPES[r.type],localTime(new Date(r.time)).replace('T',' '),r.time,r.name,r.grams,r.quantity,r.unit==='g'?'克':r.unit==='serving'?'份':'',r.type==='water'?r.ml:'',r.type==='alcohol'?r.ml:'',r.abv,r.carbs,r.alcoholGrams,r.calories,r.calorieSource,r.stool,r.type==='bowel'?(r.pain?'是':'否'):'',r.kg,r.note]));
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
async function exportCSV() {
  if(!records.length){toast('还没有可导出的记录');return;}
  const file=new File([buildCSV(records)],`身体日常记录-${localDay()}.csv`,{type:'text/csv;charset=utf-8'});
  if(navigator.canShare && navigator.canShare({files:[file]})) {try{await navigator.share({files:[file],title:'身体日常记录备份'});return;}catch(error){if(error.name==='AbortError')return;}}
  const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('已生成 CSV，请保存备份文件');
}
function offlineStatus() {$('#offline-state').textContent=readyOffline?(navigator.onLine?'离线已就绪':'离线使用中'):(navigator.onLine?'正在准备离线使用':'未就绪，请联网打开');}
async function registerWorker() {
  if(!('serviceWorker' in navigator) || !window.isSecureContext){$('#offline-state').textContent='离线安装需要 HTTPS';return;}
  try{const registration=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;readyOffline=true;offlineStatus();registration.addEventListener('updatefound',()=>{const worker=registration.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)toast('新版本已缓存；关闭所有本应用窗口后重新打开即可更新');});});}
  catch(error){$('#offline-state').textContent='离线缓存失败，请联网重试';}
}
loadRecords();$('#record-time').value=localTime();renderFields();render();
document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{activeType=button.dataset.type;document.querySelectorAll('[data-type]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderFields();}));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('#daily').hidden=button.dataset.view!=='daily';$('#stats').hidden=button.dataset.view!=='stats';renderStats();}));
$('#record-form').addEventListener('submit',event=>{event.preventDefault();try{const r=createRecord();if(persist([...records,r])){$('#record-form').reset();$('#record-time').value=localTime();renderFields();render();toast('记录已保存');}}catch(error){toast(error.message);}});
$('#record-list').addEventListener('click',event=>{const button=event.target.closest('[data-delete]');if(!button)return;const r=records.find(r=>r.id===button.dataset.delete);if(r&&confirm(`删除这条${TYPES[r.type]}记录？此操作无法撤销。`)){if(persist(records.filter(item=>item.id!==r.id))){render();toast('记录已删除');}}});
$('#export').addEventListener('click',exportCSV);
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY||event.key===null){loadRecords();render();}});
window.addEventListener('online',offlineStatus);window.addEventListener('offline',offlineStatus);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});setInterval(render,60000);
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').hidden=false;});
$('#install').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true;}});
registerWorker();
