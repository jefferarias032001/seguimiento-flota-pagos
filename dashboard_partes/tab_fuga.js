// ============================================================================
// AFILIADOS QUE FRENARON: tenian 3 o mas viajes entre hace 51 y 21 dias y en los ultimos 21 dias su ritmo semanal cayo a 40% o menos (o a cero).
// Es una alerta de retencion, separada de la prioridad de pago: en los datos la caida no se explica por la deuda, asi que se llama aunque no deban nada.
// ============================================================================
(function(){
  const el=$('#s-fuga'); if(!el) return;
  const rows=(D.fuga||[]).map(r=>({...r,dejado:(r.compra_sem_antes||0)-(r.compra_sem_ahora||0),alerta:r.v_ahora===0?'Rojo: sin viajes en 21 días':'Amarillo: bajó su ritmo',dsv:r.dias_sin_viaje==null?'':r.dias_sin_viaje,dss:r.dias_sin_saldo==null?'':r.dias_sin_saldo}));
  const rojos=rows.filter(r=>r.v_ahora===0), dej=sumBy(rows,'dejado'), venc=sumBy(rows,'venc_libre'), conV=rows.filter(r=>r.venc_libre>=1e6);
  el.innerHTML=intro(`Son afiliados que <b>cargaban</b> (3 o más viajes entre hace 51 y 21 días) y <b>frenaron</b>: en los últimos 21 días su ritmo bajó a 40% o menos de lo que hacían, o a cero. <b>Llámalos antes de perderlos</b> y ofréceles carga y una fecha firme de pago. Esta alerta es aparte de la prioridad de pago: en los datos la caída no se explica por la deuda, así que vale la pena llamar aunque no tengan vencido. Es una señal, no una pérdida segura: pueden haber cambiado de ruta o de cliente.`)
   +`<div class="strip">
      <div><b>${nf.format(rows.length)}</b><span>afiliados que frenaron · ${nf.format(rojos.length)} en rojo (sin viajes en 21 días)</span></div>
      <div><b>${money(dej)}</b><span>de compra por semana que dejaron de mover</span></div>
      <div><b>${money(venc)}</b><span>se les debe vencido en total · ${nf.format(conV.length)} tienen $1 M o más</span></div>
      <div><b>${nf.format(rows.filter(r=>lvOf(r.nivel)===4).length)}</b><span>están en «Al ritmo» y por eso la prioridad de pago no los ve</span></div></div>
    <div class="tools"><button class="mini" type="button" id="ffx">Descargar lista (CSV)</button></div><div id="ffl"></div>`;
  table($('#ffl',el),rows,[{k:'alerta',l:'Alerta',nosum:1,render:r=>`<span class="pill" style="--tone:${r.v_ahora===0?'var(--crit)':'var(--warn)'}">${r.alerta}</span>`},{k:'afiliado',l:'Afiliado'},{k:'cliente',l:'Cliente principal',nosum:1},
    {k:'v_antes',l:'Viajes (30 d antes)',num:1},{k:'v_ahora',l:'Viajes (últimos 21 d)',num:1},{k:'compra_sem_antes',l:'Compra semanal antes',money:1},{k:'compra_sem_ahora',l:'Compra semanal ahora',money:1},
    {k:'dejado',l:'Dejó de mover por semana',money:1,render:r=>`<b title="${full(r.dejado)}">${money(r.dejado)}</b>`},{k:'venc_libre',l:'Se le debe vencido',money:1},{k:'dss',l:'Días sin saldo',nosum:1},{k:'dsv',l:'Días sin viaje',nosum:1},
    {k:'nivel',l:'Prioridad de pago',nosum:1,render:r=>lvPill(r.nivel)}],{sort:'dejado',filterKey:'alerta',filterLabel:'Todas las alertas'});
  $('#ffx',el).onclick=()=>descargarCSV('afiliados_que_frenaron',['Alerta','Afiliado','Cliente principal','Viajes 30 d antes','Viajes últimos 21 d','Compra semanal antes','Compra semanal ahora','Dejó de mover por semana','Se le debe vencido','Días sin saldo','Días sin viaje','Prioridad de pago'],
    rows.slice().sort((a,b)=>b.dejado-a.dejado).map(r=>[r.alerta,r.afiliado,r.cliente,r.v_antes,r.v_ahora,Math.round(r.compra_sem_antes),Math.round(r.compra_sem_ahora),Math.round(r.dejado),Math.round(r.venc_libre),r.dss,r.dsv,lvTxt(r.nivel)]));
})();
