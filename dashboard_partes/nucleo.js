// ============================================================================
// NUCLEO: formato, iconos, navegacion, tooltips y componentes compartidos
// ============================================================================
const D = window.DATA;
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const nf = new Intl.NumberFormat('es-CO', {maximumFractionDigits:0});
const nf1 = new Intl.NumberFormat('es-CO', {maximumFractionDigits:1});
const money = v => { if(v==null) return ''; const s = v<0?'-':''; const a=Math.abs(v);
  return s + (a>=1e9 ? '$'+nf1.format(a/1e9)+' mil M' : a>=1e6 ? '$'+nf1.format(a/1e6)+' M' : '$'+nf.format(a)); };
const full = v => v==null ? '' : (v<0?'-':'')+'$'+nf.format(Math.abs(v));
// fechas ISO (2026-10-25 o 2026-10-25T00:00:00.000): se leen del texto, sin pasar por Date, para que la zona horaria no corra el dia
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?$/;
const dmy = s => { const m = ISO_RE.exec(String(s==null?'':s)); return m ? m[3]+'/'+m[2]+'/'+m[1] : ''; };
const fdate = s => { if(!s) return ''; const m=ISO_RE.exec(String(s)), d=m?new Date(+m[1],+m[2]-1,+m[3]):new Date(s); return isNaN(d)?'':d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'}); };
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PCLS = p => 'p'+String(p||'').charAt(0);
const pc = (a,b) => b>0 ? nf1.format(a/b*100)+'%' : '-';
const sumBy = (a,k) => a.reduce((s,x)=>s+(+x[k]||0),0);
const ANIM = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) && !/noanim/.test(location.search);
if(!ANIM) document.documentElement.classList.add('noanim');

// ---------- iconos (trazo, 24x24)
const ICON = {
  resumen:'<rect x="3" y="3" width="7" height="9" rx="1.6"/><rect x="14" y="3" width="7" height="5" rx="1.6"/><rect x="14" y="12" width="7" height="9" rx="1.6"/><rect x="3" y="16" width="7" height="5" rx="1.6"/>',
  caja:'<path d="M5 21V4M5 4h12l-2.3 4.2L17 12.4H5"/>',
  flujo:'<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/><path d="M3 21h18"/>',
  fuga:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5 1.4 0 2.6.4 3.6 1.1M15 14l6 6M21 14l-6 6"/>',
  tramites:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM8.5 12h7M8.5 16h5"/>',
  prioridades:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 11.2a3 3 0 100-6M18.5 20c0-2.4-1-4-2.5-5"/>',
  consulta:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 12.5c.6-1.3 1.5-2 2.5-2s1.9.7 2.5 2"/><circle cx="10.5" cy="8.4" r="1.1"/>',
  pagos:'<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  viajes:'<path d="M3 6.5h11v9.5H3zM14 9.5h4.2l2.8 3v3.5H14"/><circle cx="7" cy="18" r="1.9"/><circle cx="17" cy="18" r="1.9"/>',
  clientes:'<path d="M4 21V5.2a1 1 0 011-1h8.2a1 1 0 011 1V21M14.2 9H19a1 1 0 011 1v11M2.5 21h19M8 8h2.4M8 12h2.4M8 16h2.4"/>',
  ajover:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.1"/>',
  cartera:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  afiliados:'<path d="M5 21V4M5 4h12l-2.3 4.2L17 12.4H5"/>',
  alertas:'<path d="M12 3.2l10 17.6H2L12 3.2z"/><path d="M12 10v4.6M12 17.6v.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2M12 7.8v.01"/>'
};
const ico = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]||''}</svg>`;
const SUN='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>';
const MOON='<svg viewBox="0 0 24 24"><path d="M20.5 14.2A8.5 8.5 0 119.8 3.5a6.8 6.8 0 0010.7 10.7z"/></svg>';

// ---------- navegacion y cabecera
const GROUPS = [
  ['Caja', [['resumen','Resumen'],['caja','A quién pagar primero'],['flujo','Flujo de caja'],['fuga','Afiliados que frenaron'],['tramites','Trámites atascados'],['prioridades','Prioridades de analistas'],['consulta','Afiliado / placa']]],
  ['Operación', [['pagos','Pagos del mes'],['viajes','Viajes del mes'],['clientes','Por cliente'],['ajover','Ajover y Nouvelle']]],
  ['Cartera', [['cartera','Pendiente por pagar'],['alertas','Alertas']]]];
const TABS = GROUPS.flatMap(g=>g[1]);
const HEAD = {
  resumen:['Visión general','Resumen de caja y cartera','Qué se pagó, qué se debe y qué tan vencido está.'],
  caja:['Asignación de caja','A quién pagar primero','Escribe cuánto tienes y te digo a quién pagarle, cuánto y por qué. Verlo por afiliado, por cliente o por placa.'],
  flujo:['Proyección','Flujo de caja','Cuánto vas a deber vencido las próximas semanas y cuánto pagar por semana para ponerte al día.'],
  fuga:['Retención','Afiliados que frenaron','Afiliados que cargaban y dejaron de cargar: llámalos antes de perderlos. Va aparte de la prioridad de pago.'],
  tramites:['Destrabar','Trámites atascados','Dinero que ya se debe a los afiliados pero no se puede pagar por papeles: facturas de saldo que faltan, cumplidos pendientes y retenciones.'],
  prioridades:['Analistas','Prioridades de analistas','Lo que los analistas piden priorizar y por qué. Carlos lo ve también en el flujo de caja.'],
  consulta:['Consulta','Afiliado / placa','Pagos del mes, deuda (vencida y no vencida), viajes y prioridad de un afiliado o una placa en una sola hoja.'],
  pagos:['Tesorería','Pagos del mes','Todo lo pagado en el mes: anticipos, saldos, proveedores y gastos.'],
  viajes:['Operación','Viajes del mes','Nacional, CEDIS, EXPO e IMPO: venta, compra y estado de pago.'],
  clientes:['Comercial','Por cliente','Venta, compra a afiliados, anticipos y saldos por cliente, mes y operación.'],
  ajover:['Cuentas clave','Ajover y Nouvelle','Operación según ruta y tipología, flota que la mueve, rotación y detalle por manifiesto.'],
  cartera:['Cartera','Pendiente por pagar','Cuentas por pagar por antigüedad, tipo, proveedor y retención.'],
  alertas:['Control','Alertas','Cosas raras en viajes y pagos para revisar.']};
const BADGE = {caja:(D.caja||[]).filter(x=>String(x.nivel).charAt(0)==='1').length};
$('#nav').innerHTML = GROUPS.map(([g,items])=>`<div class="navg">${g}</div>`+items.map(([k,t])=>
  `<button type="button" data-k="${k}">${ico(k)}<span>${t}</span>${BADGE[k]?`<em class="bd" title="Afiliados críticos">${BADGE[k]}</em>`:''}</button>`).join('')).join('');
$('#hchips').innerHTML = [['Corte',D.meta.hoy],['Pagos hasta',D.meta.pagos_hasta],['Viajes hasta',D.meta.viajes_hasta],['Cartera al',D.meta.corte_cxp]]
  .map(([a,b],i)=>`<span class="chip">${i===0?'<i></i>':''}${a} <b>${esc(b)}</b></span>`).join('');
$('#liveTxt').textContent = 'Datos al corte '+D.meta.hoy;
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  try{ localStorage.setItem('tc-theme',t); }catch(e){}
  $('#themeBtn').innerHTML = t==='dark' ? SUN+'<span>Tema claro</span>' : MOON+'<span>Tema oscuro</span>';
}
$('#themeBtn').onclick = () => applyTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark');
applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
function show(k){
  $$('.side nav button').forEach(b=>b.classList.toggle('on', b.dataset.k===k));
  $$('main section').forEach(s=>s.classList.toggle('on', s.id==='s-'+k));
  const h = HEAD[k] || ['','',''];
  $('#hEyebrow').textContent = h[0]; $('#hTitle').textContent = h[1]; $('#hSub').textContent = h[2];
  document.title = 'Tractocar · '+h[1];
  try{ history.replaceState(null,'','#'+k); }catch(e){}
  countUps($('#s-'+k));
  window.scrollTo(0,0);
}
$('#nav').onclick = e => { const b=e.target.closest('button[data-k]'); if(b) show(b.dataset.k); };

// ---------- tooltip global (se alimenta de data-tip; todo texto va escapado)
const TIP = $('#tip');
const tipH = (title, rows=[]) => `<div class="tt">${esc(title)}</div>`+rows.map(r=>`<div class="tr"><span>${r.k?`<i style="background:${r.k}"></i>`:''}${esc(r.l)}</span><b>${esc(r.v)}</b></div>`).join('');
const tipA = (title, rows) => esc(tipH(title, rows));
const tipP = (title, text) => `<div class="tt">${esc(title)}</div><div class="tp">${esc(text)}</div>`;
const qm = (title, text) => `<span class="qm" tabindex="0" role="note" aria-label="${esc(title+': '+text)}" data-tip="${esc(tipP(title,text))}">?</span>`;   // signo de ayuda con tooltip
function tipShow(html, x, y){
  TIP.innerHTML = html; TIP.classList.add('on');
  const r = TIP.getBoundingClientRect(); let L = x+16, T = y+18;
  if(L+r.width > innerWidth-10) L = x-r.width-16;
  if(T+r.height > innerHeight-10) T = y-r.height-16;
  TIP.style.left = Math.max(8,L)+'px'; TIP.style.top = Math.max(8,T)+'px';
}
document.addEventListener('pointermove', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if(t) tipShow(t.dataset.tip, e.clientX, e.clientY); else TIP.classList.remove('on'); });
document.addEventListener('pointerleave', () => TIP.classList.remove('on'));
document.addEventListener('focusin', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if(t){ const b=t.getBoundingClientRect(); tipShow(t.dataset.tip, b.left+b.width/2, b.top); } });
document.addEventListener('focusout', () => TIP.classList.remove('on'));
document.addEventListener('scroll', () => TIP.classList.remove('on'), true);

// ---------- numeros animados (siempre queda el valor final en el texto)
const FMT = {money, int:v=>nf.format(Math.round(v)), pct:v=>nf1.format(v)+'%', pct0:v=>nf.format(Math.round(v))+'%'};
const animState = new WeakMap();
function setNum(el, to, fmt=money, dur=520){
  const from = animState.has(el) ? animState.get(el) : 0; animState.set(el,to);
  el.dataset.count = to; el._tok = (el._tok||0)+1; const my = el._tok;
  if(!ANIM || from===to || document.hidden){ el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = t => { if(el._tok!==my) return; const k=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-k,3);
    el.textContent = fmt(from+(to-from)*e); if(k<1) requestAnimationFrame(step); else el.textContent = fmt(to); };
  requestAnimationFrame(step);
  setTimeout(()=>{ if(el._tok===my) el.textContent = fmt(to); }, dur+120);
}
function countUps(root){ if(!root) return; $$('[data-count]',root).forEach(el=>{ if(el._shown) return; el._shown=true; animState.delete(el); setNum(el, +el.dataset.count, FMT[el.dataset.fmt||'money']); }); }

// ---------- componentes visuales
function niceMax(v){ const p=Math.pow(10,Math.floor(Math.log10(Math.max(v,1)))), n=v/p, s=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(x=>n<=x+1e-9); return s*p; }
function spark(vals, {w=104,h=34,color='var(--s1)'}={}){
  const n = vals.length; if(n<2) return '';
  const mx = Math.max(...vals,1), px = i=>5+i*(w-10)/(n-1), py = v=>h-5-(v/mx)*(h-12);
  const pts = vals.map((v,i)=>[px(i),py(v)]), d = 'M'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join('L'), l = pts[n-1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}L${px(n-1)},${h-5}L${px(0)},${h-5}Z" fill="${color}" opacity=".12"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${l[0]}" cy="${l[1]}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/></svg>`;
}
function ring(p, {size=128,sw=11,color='var(--s1)',label=''}={}){
  const r=(size-sw)/2, c=2*Math.PI*r, v=Math.max(0,Math.min(100,p||0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${nf.format(Math.round(v))}%">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--ink)" stroke-opacity=".09" stroke-width="${sw}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(c*v/100).toFixed(1)} ${c.toFixed(1)}"/></svg><b>${nf.format(Math.round(v))}%</b></div>`;
}
function kpi(l, v, s, tone, o={}){
  const t = tone===true ? 'bad' : (tone||'');
  const val = o.count!=null ? `<div class="v" data-count="${o.count}" data-fmt="${o.fmt||'money'}">${v}</div>` : `<div class="v">${v}</div>`;
  return `<div class="card kpi ${o.hero?'hero':''} ${t?'t-'+t:''}"><div class="l">${l}</div>${val}<div class="s">${s||''}</div>
    ${o.meter!=null?`<div class="meter"><i style="width:${Math.max(0,Math.min(100,o.meter))}%"></i></div>`:''}${o.spark?`<div class="sp">${spark(o.spark,{color:o.sparkColor,w:o.hero?170:92,h:o.hero?54:30})}</div>`:''}</div>`;
}
function hbars(items, color, fmt=money){
  const mx = Math.max(1, ...items.map(i=>Math.abs(i.value)));
  const rows = items.map(i=>{
    const tp = tipA(i.label, [{l:'Valor',v:fmt(i.value)}, ...(i.extra?[{l:'Detalle',v:i.extra}]:[]), ...(i.sub?[{l:'Nota',v:i.sub}]:[])]);
    return `<div class="bar" data-tip="${tp}"><div class="lb">${esc(i.label)}</div>
    <div class="t"><i style="width:${Math.max(0,Math.abs(i.value)/mx*100)}%;background:${i.color||color}"></i></div>
    <div class="n">${fmt(i.value)}${i.extra?` <span style="color:var(--mut)">· ${esc(i.extra)}</span>`:''}</div></div>`; }).join('');
  // linea de total (suma de valores y de las cantidades "N fact./pagos/viajes" cuando todas las filas la traen)
  const m = items.map(i=>String(i.extra||'').match(/^([\d.]+)\s+(.*)$/));
  const cant = items.length && m.every(Boolean) ? ` <span style="color:var(--mut)">· ${nf.format(m.reduce((s,x)=>s+parseInt(x[1].replace(/\./g,'')),0))} ${esc(m[0][2])}</span>` : '';
  const tot = items.length>1 ? `<div class="bar tot"><div class="lb"><b style="color:var(--ink)">Total</b></div><div></div><div class="n"><b>${fmt(items.reduce((s,i)=>s+i.value,0))}</b>${cant}</div></div>` : '';
  return rows + tot;
}
function stackBar(items, {thick=false}={}){
  const tot = items.reduce((s,i)=>s+Math.max(0,i.v),0);
  if(tot<=0) return `<div class="stack ${thick?'thick':''}"><i style="flex:1;background:color-mix(in srgb,var(--ink) 9%,transparent)"></i></div>`;
  return `<div class="stack ${thick?'thick':''}">`+items.filter(i=>i.v>0).map(i=>`<i style="flex:${i.v} 1 0;background:${i.color}" ${i.tip?`data-tip="${i.tip}"`:''}></i>`).join('')+`</div>`;
}
const meterCell = (f, tone) => `<div class="cell-meter" style="--tone:${tone||'var(--s1)'}"><div class="meter"><i style="width:${Math.max(0,Math.min(100,f))}%"></i></div><span>${nf.format(Math.round(f))}%</span></div>`;
const pillP = t => `<span class="pill ${PCLS(t)}">${esc(t)}</span>`;
// niveles de prioridad de pago (Plan de caja): 1 critico, 2 importante, 3 a programar, 4 al ritmo, 5 saldo antiguo, 0 sin saldo
const LVTONE = {1:'var(--crit)',2:'var(--serious)',3:'var(--warn)',4:'var(--mut)',5:'var(--s7)',0:'var(--mut)'};
const LVNAME = {1:'Crítico',2:'Importante',3:'A programar',4:'Al ritmo',5:'Saldo antiguo',0:'Sin saldo'};
const lvOf = n => (+String(n==null?0:n).charAt(0)) || 0;
const lvTxt = n => { const l=lvOf(n); return (l?l+' · ':'')+LVNAME[l]; };
const lvPill = n => `<span class="pill" style="--tone:${LVTONE[lvOf(n)]}">${esc(lvTxt(n))}</span>`;
const normN = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const intro = t => `<div class="brief">${ico('info')}<p>${t}</p></div>`;

let FIG = 0;
function figCard(o){
  const id = 'fig'+(++FIG);
  return `<div class="card fig" id="${id}"><div class="fh"><div><h2>${o.title}</h2>${o.sub?`<p class="note">${o.sub}</p>`:''}</div>${o.table?`<button class="mini" type="button" data-fig="${id}">Ver tabla</button>`:''}</div>
    <div class="fc">${o.chart}</div>${o.table?`<div class="ft" hidden>${o.table}</div>`:''}</div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-fig]'); if(!b) return; const f = document.getElementById(b.dataset.fig);
  const t = f.querySelector('.ft'), c = f.querySelector('.fc'), toTable = t.hidden; t.hidden = !toTable; c.hidden = toTable; b.textContent = toTable ? 'Ver gráfico' : 'Ver tabla'; });

function seg(el, opts, cb, init=0){
  el.className = 'seg';
  el.innerHTML = opts.map((o,i)=>`<button type="button" data-i="${i}" class="${i===init?'on':''}">${o}</button>`).join('');
  el.onclick = e => { const i=e.target.dataset.i; if(i==null) return;
    el.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.i===i)); cb(+i); };
  cb(init);
}
const cuenta = (rows,f) => { const r=rows.filter(f); return [r.length, r.reduce((s,x)=>s+(x.exigible||0),0)]; };

// descarga un CSV (separador ;, con BOM para Excel): enc = encabezados, filas = arreglos de valores
function descargarCSV(nombre, enc, filas){
  const q = v => '"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const blob = new Blob(['﻿'+[enc.map(q).join(';'),...filas.map(f=>f.map(v=>typeof v==='number'?v:q(v)).join(';'))].join('\r\n')],{type:'text/csv;charset=utf-8'}), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre+'_'+(D.meta.hoy||'').split('/').reverse().join('-')+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ---------- tabla con busqueda, filtro, orden y totales
function table(el, rows, cols, opt={}){
  const st = {q:'', f:opt.filterInit||'', sort:opt.sort||null, dir:-1};
  const prios = opt.filterKey ? [...new Set(rows.map(r=>r[opt.filterKey]))].sort() : [];
  el.innerHTML = `<div class="tools">
      <input placeholder="Buscar..." id="q" aria-label="Buscar en la tabla">
      ${opt.filterKey?`<select id="f" aria-label="Filtrar"><option value="">${opt.filterLabel||'Todos'}</option>${prios.map(p=>`<option>${esc(p)}</option>`).join('')}</select>`:''}
      <span class="cnt" id="cnt"></span></div><div class="tw"><table><thead><tr></tr></thead><tbody></tbody><tfoot></tfoot></table></div>`;
  if(opt.filterKey && st.f) el.querySelector('#f').value = st.f;
  const thead = el.querySelector('thead tr'), tbody = el.querySelector('tbody');
  thead.innerHTML = cols.map((c,i)=>`<th class="${c.num||c.money||c.pct?'num':''}" data-i="${i}">${c.l}</th>`).join('');
  function draw(){
    let r = rows;
    if(st.f) r = r.filter(x=>x[opt.filterKey]===st.f);
    if(st.q){ const q=st.q.toLowerCase(); r = r.filter(x=>cols.some(c=>{ const t=String(x[c.k]??''); return t.toLowerCase().includes(q) || (ISO_RE.test(t) && dmy(t).includes(q)); })); }
    if(st.sort){ const k=st.sort; r=[...r].sort((a,b)=>{ const x=a[k],y=b[k]; if(x==null) return 1; if(y==null) return -1;
      return (typeof x==='number'? x-y : String(x).localeCompare(String(y)))*st.dir; }); }
    const shown = r.slice(0, opt.max||500);
    tbody.innerHTML = shown.map(x=>'<tr>'+cols.map(c=>{
      const v = x[c.k]; let h;
      if(c.render) h = c.render(x);
      else if(c.pill) h = `<span class="pill ${PCLS(v)}">${esc(v)}</span>`;
      else if(c.money) h = `<span title="${full(v)}">${v==null||v===0?'':money(v)}</span>`;
      else if(c.date) h = fdate(v);
      else if(c.pct) h = v==null?'':nf1.format(v)+'%';
      else if(c.num) h = v==null?'':nf.format(v);
      else if(typeof v==='string' && ISO_RE.test(v)) h = dmy(v);
      else h = esc(v);
      return `<td class="${c.num||c.money||c.pct?'num':''} ${c.acc?'acc':''}">${h}</td>`; }).join('')+'</tr>').join('');
    el.querySelector('#cnt').textContent = `${nf.format(r.length)} filas${r.length>shown.length?` (se muestran ${shown.length})`:''}`;
    $$('th',thead).forEach((th,i)=>{ const on = cols[i].k===st.sort; th.classList.toggle('on',on); th.classList.toggle('asc',on&&st.dir===1); });
    // totales: sobre TODAS las filas filtradas (no solo las mostradas); con filtro activo se agrega el total general
    // la etiqueta ("Total (n)") ocupa todas las columnas de texto que van antes de la primera columna con total: asi nunca se parte en varias lineas
    // y las filas de total y subtotal miden lo mismo (si no, la de abajo tapa a la de arriba)
    const lead = (()=>{ const i=cols.findIndex(c=>c.ratio||((c.money||c.num)&&!c.nosum)); return i<0 ? cols.length : Math.max(i,1); })();
    const sumRow = (list, label) => '<tr>'+`<td colspan="${lead}">${label} (${nf.format(list.length)})</td>`+cols.slice(lead).map(c=>{
      if(c.ratio){ const sm=k=>list.reduce((a,x)=>a+(typeof x[k]==='number'?x[k]:0),0); const d=sm(c.ratio[1]); return `<td class="num">${d>0?nf1.format(sm(c.ratio[0])/d*100)+'%':''}</td>`; }
      if(!(c.money||c.num) || c.nosum) return '<td></td>';
      const s = list.reduce((a,x)=>a+(typeof x[c.k]==='number'?x[c.k]:0),0);
      return `<td class="num" title="${c.money?full(s):''}">${c.money?money(s):nf.format(s)}</td>`; }).join('')+'</tr>';
    const filtrado = (st.f||st.q);
    el.querySelector('tfoot').innerHTML = (filtrado ? sumRow(r,'Subtotal filtrado').replace('<tr>','<tr class="f2">') + sumRow(rows,'Total general') : sumRow(r,'Total'));
  }
  el.querySelector('#q').oninput = e=>{st.q=e.target.value;draw();};
  if(opt.filterKey) el.querySelector('#f').onchange = e=>{st.f=e.target.value;draw();};
  thead.onclick = e=>{ const th=e.target.closest('th'); if(!th) return; const k=cols[+th.dataset.i].k; st.dir = st.sort===k ? -st.dir : -1; st.sort=k; draw(); };
  draw();
}

// ---------- grafico de columnas apiladas por dia (marcas finas, separacion de 2px, tooltip por dia)
function dayChart(dias, series){
  const W=660,H=250,pl=54,pr=8,pb=26,pt=26, n=Math.max(dias.length,1), slot=(W-pl-pr)/n, bw=Math.min(24,slot*.72), base=H-pb;
  const tot = dias.map(d=>series.reduce((s,x)=>s+Math.max(0,d[x.k]||0),0)), mx = niceMax(Math.max(1,...tot)*1.05), Y = v=>pt+(base-pt)*(1-v/mx);
  const iMax = tot.indexOf(Math.max(...tot));
  let g = '';
  for(let i=0;i<=4;i++){ const v=mx*i/4, y=Y(v); g += `<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pl-8}" y="${y+3.5}" text-anchor="end">${i?money(v):'0'}</text>`; }
  dias.forEach((d,i)=>{
    const x0 = pl+slot*i, cx = x0+slot/2, x = cx-bw/2, wd = new Date(d.dia+'T12:00:00').getDay();
    if(wd===0||wd===6) g += `<rect x="${x0}" y="${pt}" width="${slot}" height="${base-pt}" fill="var(--ink)" opacity=".035"/>`;
    const segs = series.map(s=>({s,v:Math.max(0,d[s.k]||0)})).filter(o=>o.v>0); let top = base;
    segs.forEach((o,k)=>{ const h=o.v/mx*(base-pt), y=top-h, last=k===segs.length-1, gap=(k>0&&h>3)?2:0, hh=Math.max(1,h-gap);
      if(last && hh>6){ const r=Math.min(4,hh/2); g += `<path d="M${x},${y+hh}V${y+r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y+r}V${y+hh}Z" fill="${o.s.color}"/>`; }
      else g += `<rect x="${x}" y="${y}" width="${bw}" height="${hh}" fill="${o.s.color}"/>`;
      top = y; });
    const dd = d.dia.slice(8)+'/'+d.dia.slice(5,7), tp = tipA(dd, [...series.map(s=>({k:s.color,l:s.label+' ('+(d['n_'+s.k]||0)+')',v:full(d[s.k]||0)})), ...(series.length>1?[{l:'Total',v:full(tot[i])}]:[])]);
    g += `<rect class="hit" x="${x0}" y="${pt}" width="${slot}" height="${base-pt}" data-tip="${tp}" tabindex="0"/>`;
    g += `<text x="${cx}" y="${H-9}" text-anchor="middle">${d.dia.slice(8)}</text>`;
    if(i===iMax && tot[i]>0){ const tx=Math.min(Math.max(cx,pl+22),W-pr-22); g += `<text x="${tx}" y="${Y(tot[i])-7}" text-anchor="middle" style="fill:var(--ink);font-weight:650">${money(tot[i])}</text>`; }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pagos por día">${g}</svg>
    <div class="legend">${series.length>1?series.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join(''):''}<span style="color:var(--mut)">Pasa el cursor por cada día · fines de semana sombreados · se rotula solo el día de mayor valor</span></div>`;
}
