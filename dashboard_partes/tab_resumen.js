// ============================================================================
// RESUMEN: pagado por dia, anticipos por dia y pendiente por antiguedad
// ============================================================================
// bandas de antiguedad: 0-15 al dia (verde) y, desde ahi, severidad creciente (estado: ambar -> naranja -> rojo)
const EDAD_COL = ['var(--good)','var(--warn)','var(--warn)','var(--serious)','var(--serious)','var(--crit)','var(--crit)','var(--crit)','var(--crit)'];
function agingBars(X){
  const items = X.rangos.map((r,i)=>({label: r.rango==='0-15' ? '0-15 días · al día' : r.rango+' días', value:r.saldo, color:EDAD_COL[i]||'var(--crit)',
    extra: nf.format(r.n)+' fact.', sub: r.ret ? 'Retenido: '+full(r.ret) : ''}));
  return hbars(items,'var(--s1)');
}
function agingCard(titulo, X, nota){
  const p = X.total ? X.vencido/X.total*100 : 0, alDia = Math.max(0,X.total-X.vencido);
  const tp = (l,v)=>tipA(l,[{l:'Importe',v:full(v)},{l:'Del total',v:pc(v,X.total)}]);
  return `<div class="card"><h2>${titulo}</h2>
    <div style="display:flex;gap:34px;flex-wrap:wrap;margin:10px 0 14px">
      <div><div class="lab">Pendiente total</div><div style="font-size:28px;font-weight:650;letter-spacing:-.02em;margin-top:4px">${money(X.total)}</div></div>
      <div><div class="lab">Vencido · más de 15 días</div><div style="font-size:28px;font-weight:650;letter-spacing:-.02em;margin-top:4px;display:flex;align-items:center;gap:10px">${money(X.vencido)}<span class="pill p1">${nf.format(Math.round(p))}% del pendiente</span></div></div>
    </div>
    ${stackBar([{v:alDia,color:'var(--good)',tip:tp('Al día (0-15 días)',alDia)},{v:X.vencido,color:'var(--crit)',tip:tp('Vencido (más de 15 días)',X.vencido)}],{thick:true})}
    <div class="legend"><span><i style="background:var(--good)"></i>Al día ${money(alDia)}</span><span><i style="background:var(--crit)"></i>Vencido ${money(X.vencido)}</span></div>
    <h3 style="margin-top:18px">Antigüedad desde la fecha de factura</h3>${agingBars(X)}
    <p class="note">Hasta 15 días = al día; más de 15 = vencido. El color de cada banda va del verde (al día) al rojo (más antigua).
      ${X.ret?`Incluye <b>${money(X.ret)}</b> retenido (aún no se puede pagar).`:''} ${nota||''}</p></div>`;
}
function diasTable(dias, series){
  const row = d => `<tr><td>${d.dia.slice(8)}/${d.dia.slice(5,7)}</td>${series.map(s=>`<td class="num">${d[s.k]?full(d[s.k]):''}</td><td class="num">${d['n_'+s.k]||''}</td>`).join('')}${series.length>1?`<td class="num"><b>${full(series.reduce((a,s)=>a+(d[s.k]||0),0))}</b></td>`:''}</tr>`;
  const tot = `<tr><td>Total</td>${series.map(s=>`<td class="num">${full(sumBy(dias,s.k))}</td><td class="num">${nf.format(sumBy(dias,'n_'+s.k))}</td>`).join('')}${series.length>1?`<td class="num">${full(series.reduce((a,s)=>a+sumBy(dias,s.k),0))}</td>`:''}</tr>`;
  return `<div class="tw" style="max-height:300px"><table><thead><tr><th>Día</th>${series.map(s=>`<th class="num">${s.label}</th><th class="num">N.°</th>`).join('')}${series.length>1?'<th class="num">Total</th>':''}</tr></thead><tbody>${dias.map(row).join('')}</tbody><tfoot>${tot}</tfoot></table></div>`;
}
(function(){
  const E = D.edad, dias = D.dias, el = $('#s-resumen');
  const totAnt=sumBy(dias,'ant'), totSal=sumBy(dias,'saldo'), nAnt=sumBy(dias,'n_ant'), nSal=sumBy(dias,'n_saldo');
  const dAnt = dias.filter(d=>d.ant>0).length, dPag = dias.filter(d=>d.ant+d.saldo>0).length;
  const pct = (a,b)=> b ? Math.round(a/b*100) : 0;
  const S2 = [{k:'ant',label:'Anticipos',color:'var(--s1)'},{k:'saldo',label:'Saldos',color:'var(--s3)'}], S1 = [{k:'ant',label:'Anticipos',color:'var(--s1)'}];
  el.innerHTML = `
  <div class="grid kpis">
    ${kpi('Pagado a afiliados en el mes', money(totAnt+totSal), `Anticipos ${money(totAnt)} · Saldos ${money(totSal)}`, 'acc', {hero:true,count:totAnt+totSal,spark:dias.map(d=>(d.ant||0)+(d.saldo||0))})}
    ${kpi('Anticipos del mes', money(totAnt), `${nf.format(nAnt)} pagos · ${money(totAnt/Math.max(1,dAnt))} en promedio por día con pagos`, 'acc', {count:totAnt,spark:dias.map(d=>d.ant||0)})}
    ${kpi('Pendiente a afiliados', money(E.afiliados.total), `Vencido ${money(E.afiliados.vencido)} (${pct(E.afiliados.vencido,E.afiliados.total)}%)`, 'bad', {count:E.afiliados.total,meter:pct(E.afiliados.vencido,E.afiliados.total)})}
    ${kpi('Pendiente a proveedores', money(E.proveedores.total), `Vencido ${money(E.proveedores.vencido)} (${pct(E.proveedores.vencido,E.proveedores.total)}%)`, 'serious', {count:E.proveedores.total,meter:pct(E.proveedores.vencido,E.proveedores.total)})}
  </div>
  <div class="grid two">
    ${figCard({title:'Pagado a afiliados por día', sub:`Total del mes ${money(totAnt+totSal)} · ${nf.format(nAnt+nSal)} pagos en ${dPag} días con pagos`, chart:dayChart(dias,S2), table:diasTable(dias,S2)})}
    ${figCard({title:'Anticipos pagados por día', sub:`Total del mes ${money(totAnt)} · ${nf.format(nAnt)} anticipos`, chart:dayChart(dias,S1), table:diasTable(dias,S1)})}
  </div>
  <div id="ant-op"></div>
  <h3>Lo que tengo pendiente por pagar</h3>
  <div class="grid two">
    ${agingCard('Afiliados', E.afiliados)}
    ${agingCard('Proveedores', E.proveedores, `Según la fecha de vencimiento real de cada factura (los proveedores tienen plazos de 0, 15, 30 o 60 días) el vencido sería <b>${money(E.proveedores.vencido_real)}</b>.`)}
  </div>
  <p class="note" style="margin-top:14px">Otros pendientes (impuestos, financiera, clientes, propio): ${money(E.otros.total)}, de los cuales ${money(E.otros.vencido)} con más de 15 días. Ver pestaña "Pendiente por pagar".</p>`;
})();
