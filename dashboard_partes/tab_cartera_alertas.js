// ---------- PENDIENTE POR PAGAR
(function(){
  const el=$('#s-cartera'), C=D.cartera;
  el.innerHTML = `<div id="piv" style="margin-bottom:14px"></div><div class="grid two">
    <div class="card"><h2>Retenido en afiliados (no se puede pagar aún)</h2>${hbars(C.ret.map(r=>({label:r.motivo,value:r.saldo,extra:nf.format(r.n)+' fact.'})),'var(--c2)')}
      <p class="note">Retenida = tiene fecha de retención y todavía no fecha de liberación. Total retenido: <b>${money(C.ret_total)}</b>.</p></div>
    <div class="card"><h2>Otros pendientes (por tipo)</h2>${hbars(C.otros.map(r=>({label:r.tipo,value:r.impagado,extra:nf.format(r.n)+' fact.'})),'var(--mut)')}
      <p class="note">Tipo oficial del informe de cartera: impuestos, financiera, clientes, propio.</p></div></div>
    <div id="sg" style="margin:14px 0 4px"></div><div id="t"></div>`;
  const colsA=[{k:'prioridad',l:'Prioridad de pago',pill:1},{k:'afiliado',l:'Afiliado'},{k:'n',l:'Facturas',num:1},{k:'total',l:'Pendiente',money:1},
    {k:'vencido',l:'Vencido (+15 d)',money:1},{k:'v90',l:'Más de 90 d',money:1},{k:'retenido',l:'Retenido',money:1},{k:'max_dias',l:'Factura más vieja (días)',num:1,nosum:1}];
  const colsP=[{k:'tipo',l:'Tipo'},{k:'proveedor',l:'Proveedor'},{k:'n',l:'Facturas',num:1},{k:'total',l:'Pendiente',money:1},{k:'vencido',l:'Vencido (+15 d)',money:1},
    {k:'vreal',l:'Vencido por fecha real',money:1},{k:'retenido',l:'Retenido',money:1},{k:'max_dias',l:'Factura más vieja (días)',num:1,nosum:1}];
  pivotCxp($('#piv',el));
  seg($('#sg',el), ['Afiliados','Proveedores','Impuestos, financiera y otros'], i=>{
    if(i===0) table($('#t',el), D.pend_afiliados, colsA, {filterKey:'prioridad',filterLabel:'Todas las prioridades',sort:'vencido'});
    else table($('#t',el), D.pend_prov.filter(p=>(p.tipo==='PROVEEDORES')===(i===1)), colsP, i===2?{filterKey:'tipo',filterLabel:'Todos los tipos',sort:'vencido'}:{sort:'vencido'}); });
})();

// ---------- ALERTAS
(function(){
  const el=$('#s-alertas');
  const AYUDA = {
    'COMPLETADO >30d SIN FACTURA DE SALDO EN CXP':'El viaje terminó hace más de 30 días y no hay factura de saldo en cartera: revisar cumplido / liquidación.',
    'VIAJE COMPLETADO SIN COSTO DE COMPRA':'El viaje terminó pero no tiene costo de compra cargado, no se puede calcular el saldo.',
    'ANTICIPO SOBRE LO PAGADERO (no deja saldo)':'El anticipo ya cubre prácticamente toda la compra.',
    'SOBREPAGO':'Se ha pagado más que la compra del viaje.',
    'PAGO SIN VIAJE EN REPORTE NACIONAL':'Pago de flota cuyo envío no aparece en el reporte NACIONAL (viaje aún no cargado o fuera de rango).',
    'BENEFICIARIO DISTINTO AL AFILIADO':'Se pagó a alguien diferente del afiliado del viaje.',
    'POSIBLE PAGO DUPLICADO':'La misma factura aparece más de una vez con el mismo importe.'};
  el.innerHTML = `<div class="card" style="margin-bottom:12px"><h2>Qué significa cada alerta</h2>${D.alertas_res.map(a=>
    `<div class="bar" style="grid-template-columns:minmax(220px,360px) auto 1fr"><div class="lb" title="${esc(a.alerta)}"><b>${esc(a.alerta)}</b></div><div class="n"><b>${nf.format(a.n)}</b></div>
     <div style="color:var(--mut);font-size:12.5px">${esc(AYUDA[a.alerta]||'')}</div></div>`).join('')}</div><div id="t"></div>`;
  table($('#t',el), D.alertas, [{k:'alerta',l:'Alerta'},{k:'envio',l:'Envío'},{k:'placa',l:'Placa'},{k:'quien',l:'Afiliado / proveedor'},{k:'fecha',l:'Fecha',date:1},{k:'valor',l:'Valor',money:1},{k:'detalle',l:'Detalle',acc:1}],
    {filterKey:'alerta',filterLabel:'Todas las alertas',sort:'valor'});
})();