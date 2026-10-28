// ============================================================================
// PRIORIDADES DE ANALISTAS: lo que registraron en el Excel compartido + los afiliados por cliente para decidir a quien priorizar.
// El dashboard no guarda datos (es un archivo estatico): la captura se hace en el Excel y se ve aqui al actualizar.
// ============================================================================
(function(){
  const el=$('#s-prioridades'); if(!el) return;
  const {C,PRIO,PRIO_TXT,prioPill,CM,FAI,cliTxt,segAf}=MOTOR;
  const rows=D.prioridades||[], meta=D.prio_meta||{}, ok=rows.filter(p=>p.estado_match==='OK'||p.estado_match==='APROXIMADO'), malas=rows.filter(p=>p.estado_match==='NO ENCONTRADO'||p.estado_match==='AMBIGUO');
  const archivo=meta.archivo||'Prioridades de pago.xlsx', nombre=String(archivo).split('\\').pop();
  const planDe=a=>{ const cur=MOTOR.plan.cur, r=cur&&cur.rowsMap?cur.rowsMap.get(a):null; return r?r.asig:0; };

  el.innerHTML=intro('<b>Cómo funciona:</b> 1) los analistas abren el Excel compartido, ubican a sus afiliados por cliente y eligen la <b>prioridad</b>, el <b>motivo</b> y escriben las <b>observaciones</b> (por ejemplo, un acuerdo de que si se le paga, carga). 2) Se actualiza el dashboard (<code>ACTUALIZAR.bat</code>). 3) El plan <b>A quién pagar primero</b> las respeta y Carlos las ve en el <b>Flujo de caja</b>. El dashboard es un archivo de consulta: lo que se digita se guarda en el Excel.')
   +`<div class="card" style="margin-bottom:14px"><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:space-between">
       <div style="min-width:0"><div class="lab">Excel compartido donde se digita</div>
         <div style="font:500 13px/1.5 var(--mono);margin-top:6px;word-break:break-all">${esc(archivo)}</div>
         <div class="note">${meta.existe?`Última modificación: ${esc(meta.modificado||'—')} · ${nf.format(ok.length)} registros válidos`:'El archivo todavía no existe: se crea al actualizar el dashboard.'}${meta.creado_ahora?' · <b>Se acaba de crear</b> con los afiliados listados por cliente.':''}</div>
         ${meta.error?`<div class="warn" style="margin-top:6px">No se pudo leer el Excel (¿está bloqueado?): ${esc(meta.error)}</div>`:''}</div>
       <button class="mini" type="button" id="pcopy">Copiar ruta del Excel</button></div>
       <p class="note" style="margin-top:10px">Para que varios analistas digiten a la vez, mueve el archivo a una carpeta compartida de OneDrive (se abre en Excel en línea) y pon su ruta en <code>rutas.txt</code> (línea <code>PRIORIDADES =</code>). Para que Carlos y los analistas abran el dashboard sin pedírtelo, pon una carpeta compartida en <code>PUBLICAR_DASHBOARD_EN =</code>.</p></div>`
   +`<div class="strip" id="pk"></div><h3>Lo que registraron los analistas</h3><div id="pr"></div>
     ${malas.length?`<h3>Para revisar: nombres que no se encontraron</h3><div id="pm"></div>`:''}
     <h3>Afiliados por cliente: para decidir a quién priorizar</h3><div class="brief" style="margin-bottom:12px">${ico('info')}<p>Esta lista es la misma que trae el Excel, para que veas lo que se debe y cuánto mueve cada afiliado antes de decidir. Filtra por tu <b>cliente</b>. «Falta registrar» = nadie le ha puesto prioridad todavía.</p></div><div id="pl"></div>`;

  // ---------- resumen
  const deudaAlta=ok.filter(p=>p.prioridad===1).reduce((s,p)=>s+((CM.get(p.afiliado)||{}).venc_libre||0),0);
  $('#pk',el).innerHTML=`<div><b>${nf.format(ok.length)}</b><span>registros · Alta ${ok.filter(p=>p.prioridad===1).length} · Media ${ok.filter(p=>p.prioridad===2).length} · Baja ${ok.filter(p=>p.prioridad===3).length} · No pagar ${ok.filter(p=>p.prioridad===0).length}</span></div>
    <div><b>${money(deudaAlta)}</b><span>vencidos de los afiliados en Alta</span></div><div><b>${money(ok.reduce((s,p)=>s+(p.monto||0),0))}</b><span>montos que pidieron pagar</span></div>
    <div><b>${nf.format(ok.filter(p=>/^s[ií]/i.test(p.compromiso||'')).length)}</b><span>con compromiso de carga si se les paga</span></div>
    <div><b>${nf.format(malas.length)}</b><span>nombres sin coincidencia en los datos${meta.sin_prioridad?` · ${nf.format(meta.sin_prioridad)} filas del Excel sin prioridad (se ignoran)`:''}</span></div>`;

  // ---------- registrados
  function dibujarRegistrados(){
    if(!ok.length){ $('#pr',el).innerHTML=`<div class="card"><p class="note" style="margin:0">Todavía no hay prioridades registradas. Abre <b>${esc(nombre)}</b>, elige la prioridad de los afiliados que quieras priorizar y actualiza el dashboard.</p></div>`; return; }
    const dat=ok.map(p=>{ const c=CM.get(p.afiliado)||{}, fi=FAI.get(p.afiliado)||{};
      return {ptxt:PRIO_TXT[p.prioridad],prioridad:p.prioridad,afiliado:p.afiliado,cliente:p.cliente||cliTxt(p.afiliado).principal||'',seg:segAf(p.afiliado),motivo:p.motivo,obs:p.obs,comp:(p.compromiso||'')+(p.fecha_compromiso?' · '+p.fecha_compromiso:''),monto:p.monto||0,analista:p.analista,fecha:p.fecha,
        deuda:c.venc_libre||0,porv:fi.porVencer||0,venta30:c.venta30||0,nivel:c.nivel||'0-SIN SALDO',plan:planDe(p.afiliado),estado:p.estado_match,fila:p.fila}; })
      .sort((a,b)=>{ const ra=a.prioridad===0?9:a.prioridad, rb=b.prioridad===0?9:b.prioridad; return ra-rb||b.deuda-a.deuda; });
    $('#pr',el).innerHTML='<div id="prt"></div>';
    table($('#prt',el),dat,[{k:'ptxt',l:'Prioridad',nosum:1,render:r=>prioPill(r.afiliado)||esc(r.ptxt)},{k:'afiliado',l:'Afiliado'},{k:'cliente',l:'Cliente',nosum:1},{k:'seg',l:'Operación (Ajover)',nosum:1},{k:'motivo',l:'Motivo',nosum:1},
      {k:'obs',l:'Observaciones',nosum:1,acc:1},{k:'comp',l:'¿Va a cargar si le pagan?',nosum:1},{k:'monto',l:'Monto solicitado',money:1},{k:'analista',l:'Analista',nosum:1},{k:'fecha',l:'Registrada',nosum:1},
      {k:'deuda',l:'Se le debe vencido',money:1},{k:'porv',l:'Por vencer (15 d)',money:1},{k:'venta30',l:'Venta 30 d',money:1},{k:'nivel',l:'Prioridad del sistema',nosum:1,render:r=>lvPill(r.nivel)},{k:'plan',l:'Plan: pagar ahora',money:1}],
      {sort:null,filterKey:'ptxt',filterLabel:'Todas las prioridades'});
  }
  dibujarRegistrados();
  document.addEventListener('plan:update',()=>{ if(el.classList.contains('on')) dibujarRegistrados(); });
  if(malas.length){ $('#pm',el).innerHTML='<div id="pmt"></div>'; table($('#pmt',el),malas.map(p=>({fila:p.fila,digitado:p.afiliado_digitado,estado:p.estado_match,prioridad:PRIO_TXT[p.prioridad],analista:p.analista,obs:p.obs})),
    [{k:'fila',l:'Fila del Excel',num:1,nosum:1},{k:'digitado',l:'Nombre digitado'},{k:'estado',l:'Resultado',nosum:1},{k:'prioridad',l:'Prioridad',nosum:1},{k:'analista',l:'Analista',nosum:1},{k:'obs',l:'Observaciones',nosum:1,acc:1}],{sort:null}); }

  // ---------- afiliados por cliente (espejo de la lista del Excel)
  const lista=C.filter(x=>(x.lv>=1&&x.lv<=4)||(x.lv===5&&x.venc_libre>=2e6)).map(x=>{ const t=cliTxt(x.afiliado), fi=FAI.get(x.afiliado)||{}, p=PRIO.get(x.afiliado);
    return {cliente:t.principal||'(sin viajes en 30 días)',afiliado:x.afiliado,seg:segAf(x.afiliado),nivel:x.nivel,nivelTxt:x.nivelTxt,deuda:x.venc_libre,porv:Math.round(fi.porVencer||0),venta30:x.venta30,v15:x.v15,
      reg:p?(PRIO_TXT[p.prioridad]+(p.analista?' · '+p.analista:'')):'Falta registrar',obs:p?(p.motivo+(p.obs?' — '+p.obs:'')):'',porque:x.motivo}; })
    .sort((a,b)=>(a.cliente.startsWith('(')-b.cliente.startsWith('('))||a.cliente.localeCompare(b.cliente)||b.deuda-a.deuda);
  table($('#pl',el),lista,[{k:'cliente',l:'Cliente'},{k:'afiliado',l:'Afiliado'},{k:'seg',l:'Operación (Ajover)',nosum:1},{k:'nivelTxt',l:'Prioridad del sistema',nosum:1,render:r=>lvPill(r.nivel)},{k:'deuda',l:'Se le debe vencido',money:1},{k:'porv',l:'Por vencer (15 d)',money:1},
    {k:'venta30',l:'Venta 30 d',money:1},{k:'v15',l:'Viajes 15 d',num:1},{k:'reg',l:'Prioridad del analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">Falta registrar</span>'},{k:'obs',l:'Motivo y observaciones',nosum:1,acc:1},{k:'porque',l:'Por qué el sistema lo ubica así',nosum:1,acc:1}],
    {sort:null,filterKey:'cliente',filterLabel:'Todos los clientes',max:600});

  $('#pcopy',el).onclick=async()=>{ const b=$('#pcopy',el); try{ await navigator.clipboard.writeText(archivo); b.textContent='Ruta copiada ✓'; }catch(e){ const t=document.createElement('textarea'); t.value=archivo; document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); b.textContent='Ruta copiada ✓'; }catch(_){ b.textContent='No se pudo copiar'; } t.remove(); } setTimeout(()=>b.textContent='Copiar ruta del Excel',2200); };
})();
