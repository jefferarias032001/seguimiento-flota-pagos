// ---------- ANTICIPOS POR OPERACIÓN (portada)
(function(){
  const el = $('#ant-op'); if(!el) return;
  const OPS = ['NACIONAL','CEDIS','IMPO','EXPO'], A = D.anticipos;
  const MESES = [...new Set(A.map(r=>r.mes))].sort();
  const mlabel = m => new Date(m+'-15').toLocaleDateString('es-CO',{month:'short',year:'numeric'}).replace('.','');
  const agg = rows => rows.reduce((s,r)=>{ for(const k of ['viajes','con_ant','compra','ant','saldo','pagado','falta']) s[k]=(s[k]||0)+(r[k]||0); return s; }, {});
  const pc = (a,b) => b>0 ? a/b*100 : null;
  const pcs = v => v==null ? '' : nf1.format(v)+'%';
  const heat = v => v==null ? '' : `style="background:color-mix(in srgb, var(--c1) ${Math.min(100,v)*0.45}%, transparent)"`;
  el.innerHTML = `<h3>Anticipos frente a lo que se le debe pagar al afiliado</h3>
    <div class="card"><p class="note" style="margin:0 0 10px">Solo viajes de afiliados (sin flota propia) con costo de compra cargado, agrupados por el mes en que se creó el viaje. El archivo de pagos empieza en ${D.meta.pagos_desde}, por eso no hay meses anteriores. <b>% anticipo</b> = anticipo dado ÷ lo que se le debe pagar (compra). "Con anticipo" = viajes a los que sí se les giró anticipo.</p>
      <div id="sg1" style="margin-bottom:10px"></div><div class="tw"><table id="t1"></table></div>
      <h3 style="margin-top:18px">Mes a mes</h3><div id="sg2" style="margin-bottom:10px"></div><div class="tw"><table id="t2"></table></div></div>`;

  // tabla 1: por operación (mes en curso o acumulado del año)
  seg($('#sg1',el), [mlabel(D.meta.mes)+' (mes en curso)', 'Acumulado '+D.meta.mes.slice(0,4)], i=>{
    const rows = i===0 ? A.filter(r=>r.mes===D.meta.mes) : A;
    const fila = (nom, rs, bold) => { const s=agg(rs), pa=pc(s.ant,s.compra), pt=pc(s.pagado,s.compra);
      return `<tr style="${bold?'font-weight:700':''}"><td>${nom}</td><td class="num">${nf.format(s.viajes||0)}</td><td class="num">${nf.format(s.con_ant||0)} <span style="color:var(--mut)">(${pcs(pc(s.con_ant,s.viajes))||'-'})</span></td>
        <td class="num" title="${full(s.compra)}">${money(s.compra||0)}</td><td class="num" title="${full(s.ant)}">${money(s.ant||0)}</td><td class="num" ${heat(pa)}><b>${pcs(pa)||'-'}</b></td>
        <td class="num" title="${full(s.saldo)}">${money(s.saldo||0)}</td><td class="num" title="${full(s.pagado)}">${money(s.pagado||0)}</td><td class="num">${pcs(pt)||'-'}</td>
        <td class="num" title="${full(s.falta)}">${money(s.falta||0)}</td></tr>`; };
    $('#t1',el).innerHTML = `<thead><tr>${['Operación','Viajes','Con anticipo','A pagar al afiliado','Anticipo dado','% anticipo','Saldo pagado','Total pagado','% pagado','Falta por pagar'].map((h,j)=>`<th class="${j?'num':''}">${h}</th>`).join('')}</tr></thead>
      <tbody>${OPS.map(o=>fila(o, rows.filter(r=>r.oper===o))).join('')}</tbody><tfoot>${fila('Total', rows, true)}</tfoot>`; });

  // tabla 2: mes a mes por operación
  const METR = [['% anticipo', rs=>pcs(pc(agg(rs).ant, agg(rs).compra)), rs=>pc(agg(rs).ant, agg(rs).compra)],
                ['Anticipo dado', rs=>money(agg(rs).ant), null], ['A pagar al afiliado', rs=>money(agg(rs).compra), null],
                ['% pagado (anticipo + saldo)', rs=>pcs(pc(agg(rs).pagado, agg(rs).compra)), null], ['Falta por pagar', rs=>money(agg(rs).falta), null], ['Viajes', rs=>nf.format(agg(rs).viajes||0), null]];
  seg($('#sg2',el), METR.map(m=>m[0]), i=>{
    const [,fmt,val] = METR[i];
    const celda = (rs,bold) => { const t = rs.length ? fmt(rs) : ''; return `<td class="num" ${val&&rs.length?heat(val(rs)):''} ${bold?'style="font-weight:700"':''}>${val?`<b>${t||'-'}</b>`:(t||'-')}</td>`; };
    const filas = MESES.map(m=>`<tr><td>${mlabel(m)}${m===D.meta.mes?' <span style="color:var(--mut)">(en curso)</span>':''}</td>${OPS.map(o=>celda(A.filter(r=>r.mes===m&&r.oper===o))).join('')}${celda(A.filter(r=>r.mes===m),true)}</tr>`).join('');
    $('#t2',el).innerHTML = `<thead><tr><th>Mes</th>${OPS.map(o=>`<th class="num">${o}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${filas}</tbody>
      <tfoot><tr><td>Acumulado ${D.meta.mes.slice(0,4)}</td>${OPS.map(o=>celda(A.filter(r=>r.oper===o))).join('')}${celda(A,true)}</tr></tfoot>`; });
})();


// ---------- TABLA DINÁMICA DE CUENTAS POR PAGAR (como el pivot del informe CXP)
function pivotCxp(el){
  const P = D.piv, R = P.rangos, nR = R.length;
  const st = {tipos:new Set(P.tipos), estado:'', ret:'', q:'', solo:false, grupo:0, sort:'total'};
  el.innerHTML = `<div class="card"><h2>Resumen de cuentas por pagar</h2>
    <p class="note" style="margin:0 0 10px">Igual que la tabla dinámica del informe CXP (corte ${P.corte}): saldo <b>impagado</b> por rango de antigüedad desde la fecha de factura. Marca o desmarca los tipos y combina los filtros.</p>
    <div class="tools" id="pf" style="gap:14px"></div>
    <div id="pg" style="margin-bottom:10px"></div>
    <div class="tw"><table id="pt"><thead></thead><tbody></tbody><tfoot></tfoot></table></div><p class="note" id="pn"></p></div>`;
  const tot = P.tipos.map(()=>0); P.rows.forEach(r=>tot[r[0]]+=r[5]);
  $('#pf',el).innerHTML = `<div id="chipsT" style="display:flex;gap:6px;flex-wrap:wrap">${P.tipos.map((t,i)=>`<label class="pchip on" data-i="${i}"><input type="checkbox" checked hidden>${esc(t)} <span>${money(tot[i])}</span></label>`).join('')}</div>
    <select id="fe"><option value="">Todos los estados de pago</option>${P.estados.map(e=>`<option>${esc(e)}</option>`).join('')}</select>
    <select id="fr"><option value="">Libres y retenidas</option><option value="0">Solo libres para pagar</option><option value="1">Solo retenidas</option></select>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fv"> Solo vencido (+15 días)</label>
    <input id="fq" placeholder="Buscar proveedor...">`;
  const rowsF = () => {
    const q = st.q.toLowerCase();
    return P.rows.filter(r => st.tipos.has(P.tipos[r[0]]) && (!st.estado || P.estados[r[3]]===st.estado) && (st.ret===''|| String(r[4])===st.ret)
      && (!st.solo || r[2]>0) && (!q || P.provs[r[1]].toLowerCase().includes(q)));
  };
  function draw(){
    const rs = rowsF(), g = {}; const gi = [1,0,3,6][st.grupo];
    rs.forEach(r=>{ const k = [P.provs, P.tipos, P.estados, P.clientes][st.grupo][r[gi]]; const o = g[k] || (g[k] = {k, v:new Array(nR).fill(0), t:0, n:0, ret:0});
      o.v[r[2]] += r[5]; o.t += r[5]; o.n++; if(r[4]) o.ret += r[5]; });
    let list = Object.values(g);
    list.sort((a,b)=> st.sort==='k' ? a.k.localeCompare(b.k) : st.sort>=0 && st.sort!=='total' ? b.v[st.sort]-a.v[st.sort] : b.t-a.t);
    const colT = new Array(nR).fill(0); let T=0, TR=0, TN=0; list.forEach(o=>{ o.v.forEach((x,i)=>colT[i]+=x); T+=o.t; TR+=o.ret; TN+=o.n; });
    const cell = v => v ? `<td class="num" title="${full(v)}">${money(v)}</td>` : '<td></td>';
    $('#pt thead',el).innerHTML = `<tr><th data-s="k">${['Proveedor','Tipo','Estado de pago','Cliente del viaje'][st.grupo]}</th>${R.map((r,i)=>`<th class="num" data-s="${i}" style="${i>0?'':'color:var(--good-ink)'}">${r===R[0]?'0-15':r}</th>`).join('')}<th class="num" data-s="total">Total general</th><th class="num">Vencido (+15 d)</th><th class="num">Retenido</th><th class="num">Facturas</th></tr>`;
    $('#pt tbody',el).innerHTML = list.slice(0,300).map(o=>`<tr><td>${esc(o.k)}</td>${o.v.map(cell).join('')}<td class="num"><b title="${full(o.t)}">${money(o.t)}</b></td>
      <td class="num">${money(o.t-o.v[0])}</td><td class="num">${o.ret?money(o.ret):''}</td><td class="num">${nf.format(o.n)}</td></tr>`).join('');
    $('#pt tfoot',el).innerHTML = `<tr><td>Total general (${nf.format(list.length)})</td>${colT.map(cell).join('')}<td class="num" title="${full(T)}">${money(T)}</td><td class="num">${money(T-colT[0])}</td><td class="num">${money(TR)}</td><td class="num">${nf.format(TN)}</td></tr>`;
    $('#pn',el).textContent = list.length>300 ? `Se muestran las 300 primeras filas de ${nf.format(list.length)}; el total incluye todas.` : '';
  }
  $('#chipsT',el).onclick = e => { const l = e.target.closest('.pchip'); if(!l) return; e.preventDefault(); const t=P.tipos[+l.dataset.i];
    if(st.tipos.has(t)) st.tipos.delete(t); else st.tipos.add(t); l.classList.toggle('on', st.tipos.has(t)); draw(); };
  $('#fe',el).onchange = e=>{st.estado=e.target.value;draw();};
  $('#fr',el).onchange = e=>{st.ret=e.target.value;draw();};
  $('#fv',el).onchange = e=>{st.solo=e.target.checked;draw();};
  $('#fq',el).oninput = e=>{st.q=e.target.value;draw();};
  $('#pt thead',el).onclick = e=>{ const s=e.target.dataset.s; if(s==null) return; st.sort = (s==='k'||s==='total') ? s : +s; draw(); };
  seg($('#pg',el), ['Por proveedor','Por tipo','Por estado de pago','Por cliente (afiliados)'], i=>{ st.grupo=i; draw(); });
}