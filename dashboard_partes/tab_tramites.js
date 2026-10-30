// ============================================================================
// TRAMITES ATASCADOS: dinero que ya se debe a los afiliados pero no se puede pagar por papeles.
//  - saldo de viajes terminados (mas de 7 dias) sin factura de saldo: con cumplido SI -> Contabilidad crea la factura; sin cumplir -> Operaciones cierra el cumplido
//  - facturas retenidas (con motivo y dias)
// No cuesta caja destrabarlo, pero al destrabarlo sube lo que hay que pagar.
// ============================================================================
(function(){
  const el=$('#s-tramites'); if(!el) return;
  const accion=r=>{ const a=[];
    if(r.liq_si>0) a.push(`Contabilidad: crear la factura de saldo de ${nf.format(r.n_si)} viaje${r.n_si===1?'':'s'}`);
    if(r.liq_pend>0) a.push(`Operaciones: cerrar el cumplido de ${nf.format(r.n_pend)} viaje${r.n_pend===1?'':'s'}`);
    if(r.retenido>0) a.push(/DIRECTAMENTE/i.test(r.mot_ret)?'Retenido: el cliente paga directo a los afiliados (no depende de la caja)':`Liberar retención (${r.mot_ret||'sin motivo'}${r.dias_ret?`, ${nf.format(r.dias_ret)} días`:''})`);
    return a.join(' · '); };
  const rows=(D.tramites||[]).map(r=>({...r,grupo:r.activo?'Los que cargan':'Los demás',accion:accion(r)}));
  const act=rows.filter(r=>r.activo), s=(a,k)=>sumBy(a,k);
  el.innerHTML=intro(`Es plata que <b>ya se les debe</b> a los afiliados pero <b>no se puede pagar</b> por papeles. No cuesta caja destrabarla (al destrabarla sube lo que hay que pagar, pero se arregla la relación con el afiliado y se puede ordenar). Tres causas: <b>facturas de saldo que faltan</b> aunque el viaje ya tiene cumplido (Contabilidad), <b>cumplidos pendientes</b> (Operaciones) y <b>retenciones</b> sobre facturas. Por defecto se ven los afiliados que cargan; el saldo es estimado (96% de la compra menos lo pagado) en viajes terminados hace más de 7 días.`)
   +`<div class="strip">
      <div><b>${money(s(act,'total'))}</b><span>atascado en los ${nf.format(act.length)} afiliados que cargan (todos: ${money(s(rows,'total'))})</span></div>
      <div><b>${money(s(act,'liq_si'))}</b><span>facturas de saldo por crear con cumplido SI · ${nf.format(s(act,'n_si'))} viajes (Contabilidad)</span></div>
      <div><b>${money(s(act,'liq_pend'))}</b><span>con cumplido pendiente · ${nf.format(s(act,'n_pend'))} viajes (Operaciones)</span></div>
      <div><b>${money(s(act,'retenido'))}</b><span>retenido en facturas de los que cargan</span></div></div>
    <div class="tools"><button class="mini" type="button" id="tcx">Descargar para Contabilidad y Operaciones (CSV)</button></div><div id="tcl"></div>`;
  table($('#tcl',el),rows,[{k:'afiliado',l:'Afiliado'},{k:'nivel',l:'Prioridad de pago',nosum:1,render:r=>lvPill(r.nivel)},{k:'total',l:'Dinero atascado',money:1,render:r=>`<b title="${full(r.total)}">${money(r.total)}</b>`},
    {k:'liq_si',l:'Saldo sin factura (cumplido SI)',money:1},{k:'n_si',l:'Viajes',num:1},{k:'liq_pend',l:'Saldo con cumplido pendiente',money:1},{k:'n_pend',l:'Viajes',num:1},
    {k:'retenido',l:'Retenido',money:1},{k:'mot_ret',l:'Motivo de retención',nosum:1},{k:'dias_ret',l:'Días retenido',nosum:1},{k:'accion',l:'Qué hacer',nosum:1,acc:1}],
    {sort:'total',filterKey:'grupo',filterLabel:'Todos los afiliados',filterInit:'Los que cargan'});
  $('#tcx',el).onclick=()=>descargarCSV('tramites_atascados',['Afiliado','Prioridad de pago','Dinero atascado','Saldo sin factura (cumplido SI)','Viajes cumplido SI','Saldo con cumplido pendiente','Viajes cumplido pendiente','Retenido','Motivo de retención','Días retenido','Qué hacer','Grupo'],
    rows.slice().sort((a,b)=>b.total-a.total).map(r=>[r.afiliado,lvTxt(r.nivel),Math.round(r.total),Math.round(r.liq_si),r.n_si,Math.round(r.liq_pend),r.n_pend,Math.round(r.retenido),r.mot_ret,r.dias_ret,r.accion,r.grupo]));
})();
