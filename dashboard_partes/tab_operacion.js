// ---------- PAGOS DEL MES
(function(){
  const el=$('#s-pagos'), gt=D.pagos_tipo;
  const flota = gt.filter(t=>['ANTICIPO FLOTA','SALDO FLOTA','DESCUENTO PRONTO PAGO'].includes(t.tipo));
  el.innerHTML = `<div class="grid two">
    <div class="card"><h2>Qué se pagó en el mes</h2>${hbars(gt.map(t=>({label:t.tipo,value:t.importe,extra:nf.format(t.n)+' pagos'})),'var(--c1)')}
      <p class="note">ANT_ = anticipo · M+número = saldo · PP_M = descuento pronto pago. Lo que no empieza por ANT ni M son proveedores y gastos. "Negociable" cuenta como pagado.</p></div>
    <div class="card"><h2>Proveedores y gastos por categoría</h2>${hbars(D.prov_cat.map(t=>({label:t.categoria,value:t.importe,extra:nf.format(t.n)+' pagos'})),'var(--c2)')}
      <p class="note">Categoría inferida por el nombre del proveedor.</p></div></div>
    <div id="sg" style="margin:14px 0 4px"></div><div id="t"></div>`;
  const cols = [{k:'fecha',l:'Fecha',date:1},{k:'factura',l:'Factura'},{k:'tipo',l:'Tipo'},{k:'categoria',l:'Categoría'},{k:'proveedor',l:'Proveedor / beneficiario'},
    {k:'placa',l:'Placa'},{k:'importe',l:'Importe',money:1},{k:'estado',l:'Estado'}];
  seg($('#sg',el), ['Todos','Flota (afiliados)','Proveedores y otros'], i=>{
    const rows = i===0 ? D.pagos : D.pagos.filter(p=>p.grupo===(i===1?'Flota (afiliados)':'Proveedores y otros'));
    table($('#t',el), rows, cols, {filterKey:'tipo',filterLabel:'Todos los tipos',sort:'fecha'}); });
})();

// ---------- VIAJES DEL MES (NACIONAL, CEDIS, EXPO, IMPO)
(function(){
  const el=$('#s-viajes');
  el.innerHTML = intro('Viajes creados en el mes en las cuatro operaciones (NACIONAL, CEDIS, EXPO e IMPO). <b>A facturar</b> = venta; <b>A pagar</b> = compra a afiliados (la flota propia no se paga). '
      + 'En EXPO e IMPO la venta se reparte entre los envíos que comparten el mismo envío de venta, para no duplicarla.')
    + `<h3>Por operación</h3><div id="t1"></div><h3>Estado de pago de los viajes de afiliados</h3><div id="t2"></div><h3>Por afiliado</h3><div id="t3"></div>`;
  table($('#t1',el), D.viajes_op.map(o=>({...o, margen:o.venta? o.utilidad/o.venta*100:null})), [
    {k:'oper',l:'Operación'},{k:'viajes',l:'Viajes',num:1},{k:'propios',l:'De flota propia',num:1},{k:'venta',l:'A facturar',money:1},{k:'compra',l:'A pagar a afiliados',money:1},
    {k:'utilidad',l:'Utilidad',money:1},{k:'pagado',l:'Pagado a afiliados',money:1},{k:'pend',l:'Saldo abierto en cartera',money:1}]);
  $('#t1 .tools',el).remove();
  table($('#t2',el), D.viajes_estado, [{k:'estado',l:'Estado de pago'},{k:'n',l:'Viajes',num:1},{k:'compra',l:'A pagar',money:1}]);
  $('#t2 .tools',el).remove();
  table($('#t3',el), D.viajes_afil, [{k:'afiliado',l:'Afiliado'},{k:'ops',l:'Operación'},{k:'viajes',l:'Viajes',num:1},{k:'venta',l:'A facturar',money:1},{k:'compra',l:'A pagar',money:1},
    {k:'utilidad',l:'Utilidad',money:1},{k:'pagado',l:'Pagado',money:1},{k:'pend',l:'Saldo abierto',money:1},{k:'por_liquidar',l:'Por liquidar',money:1}],{sort:'compra'});
})();

// ---------- POR CLIENTE
(function(){
  const el=$('#s-clientes'), A=D.clientes;
  const meses=[...new Set(A.map(r=>r.mes))].sort(), ops=['NACIONAL','CEDIS','IMPO','EXPO'];
  const ml=m=>{ const s=new Date(m+'-15').toLocaleDateString('es-CO',{month:'long',year:'numeric'}); return s.charAt(0).toUpperCase()+s.slice(1); };
  el.innerHTML = intro('Información por cliente de los viajes de las cuatro operaciones. <b>Venta</b> = a facturar al cliente; <b>A pagar</b> = compra a afiliados (sin flota propia); <b>Anticipo</b> y <b>Falta por pagar</b> se miden sobre esa compra. '
      + `Hay <b>${nf.format(D.n_multi)}</b> viajes con órdenes de más de un cliente: la venta se asigna a cada cliente por línea y la compra, los anticipos y los pagos se reparten entre sus clientes según su venta. Un viaje con varios clientes cuenta una vez por cada cliente, por eso la suma de viajes puede superar los viajes reales. <b>Los pagos (anticipo, pagado, falta) solo existen desde ${D.meta.pagos_desde}</b>: en meses anteriores esas columnas salen en 0.`)
    + `<div class="tools"><select id="fm"><option value="">Todo ${meses[0].slice(0,4)}</option>${meses.map(m=>`<option value="${m}" ${m===D.meta.mes?'selected':''}>${ml(m)}</option>`).join('')}</select>
       <select id="fo"><option value="">Todas las operaciones</option>${ops.map(o=>`<option>${o}</option>`).join('')}</select></div>
       <div class="grid two" id="top"></div><div id="t" style="margin-top:14px"></div>`;
  const cols=[{k:'cliente',l:'Cliente'},{k:'viajes',l:'Viajes',num:1},{k:'propios',l:'De flota propia',num:1},{k:'venta',l:'A facturar (venta)',money:1},{k:'compra',l:'A pagar a afiliados',money:1},
    {k:'utilidad',l:'Utilidad',money:1},{k:'margen',l:'Margen',pct:1,ratio:['utilidad','venta']},{k:'ant',l:'Anticipo dado',money:1},{k:'pant',l:'% anticipo',pct:1,ratio:['ant','compra']},
    {k:'pagado',l:'Total pagado',money:1},{k:'falta',l:'Falta por pagar',money:1},{k:'pend',l:'Saldo abierto en cartera',money:1}];
  function draw(){
    const m=$('#fm',el).value, o=$('#fo',el).value, g={};
    A.filter(r=>(!m||r.mes===m)&&(!o||r.oper===o)).forEach(r=>{
      const x=g[r.cliente]||(g[r.cliente]={cliente:r.cliente,viajes:0,propios:0,venta:0,compra:0,costo:0,ant:0,pagado:0,falta:0,pend:0});
      for(const k of ['viajes','propios','venta','compra','costo','ant','pagado','falta','pend']) x[k]+=r[k]||0; });
    const list=Object.values(g).map(x=>({...x, utilidad:x.venta-x.costo, margen:x.venta>0?(x.venta-x.costo)/x.venta*100:null, pant:x.compra>0?x.ant/x.compra*100:null}));
    const top=(k,n=10)=>[...list].sort((a,b)=>b[k]-a[k]).slice(0,n).filter(x=>x[k]>0);
    $('#top',el).innerHTML = `<div class="card"><h2>A facturar: principales clientes</h2>${hbars(top('venta').map(x=>({label:x.cliente,value:x.venta,extra:nf.format(x.viajes)+' viajes'})),'var(--c1)')}</div>
      <div class="card"><h2>A pagar a afiliados: principales clientes</h2>${hbars(top('compra').map(x=>({label:x.cliente,value:x.compra,extra:nf.format(x.viajes)+' viajes'})),'var(--c2)')}</div>`;
    table($('#t',el), list, cols, {sort:'venta'});
  }
  $('#fm',el).onchange=draw; $('#fo',el).onchange=draw; draw();
})();
