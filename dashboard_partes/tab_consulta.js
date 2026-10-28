// ============================================================================
// AFILIADO / PLACA: pagos del mes, deuda (vencida y no vencida), viajes y prioridad en una sola hoja
// La prioridad es la de la hoja "A quién pagar primero" (estricta): rota + saldo vencido que pesa + no se le viene pagando al ritmo.
// ============================================================================
(function(){
  const el=$('#s-consulta'); if(!el) return;
  const N=normN;
  const F=D.facturas_af||[], P=(D.pagos||[]).filter(r=>r.grupo==='Flota (afiliados)'), V=D.viajes_mes_det||[];
  const CJ={}; (D.caja||[]).forEach(a=>CJ[N(a.afiliado)]=a);
  const AF={}; D.afiliados.forEach(a=>AF[N(a.afiliado)]=a); const PL={}; D.placas.forEach(a=>PL[a.placa]=a);
  const VENC=15;
  // resumen por afiliado
  const M={}; const get=(n)=>M[N(n)]||(M[N(n)]={k:N(n),afiliado:n,placas:new Set(),viajes:0,ant:0,saldo:0,pagado:0,debe:0,vencido:0,novenc:0,ret:0});
  F.forEach(r=>{ const x=get(r.afiliado); if(r.placa) x.placas.add(r.placa); x.debe+=r.importe; if(r.dfac>VENC) x.vencido+=r.importe; else x.novenc+=r.importe; if(r.ret_i) x.ret+=r.importe; });
  P.forEach(r=>{ const x=get(r.proveedor); if(r.placa) x.placas.add(r.placa); if(r.tipo==='ANTICIPO FLOTA') x.ant+=r.importe; else x.saldo+=r.importe; x.pagado+=r.importe; });
  V.filter(r=>!r.propia_i).forEach(r=>{ const x=get(r.afiliado); if(r.placa) x.placas.add(r.placa); x.viajes++; });
  const rows=Object.values(M).map(x=>{ const c=CJ[x.k]; const niv=c?c.nivel:'0-SIN SALDO'; return {...x,placas:x.placas.size,nivel:niv,prioridad:lvTxt(niv)}; });
  const sum=k=>rows.reduce((s,x)=>s+x[k],0), urg=rows.filter(r=>lvOf(r.nivel)===1||lvOf(r.nivel)===2);
  el.innerHTML=intro('Todo en una hoja: busca un <b>afiliado</b> o una <b>placa</b> y abajo aparece enseguida lo pagado en el mes, lo que se le debe (vencido = más de 15 días desde la fecha de factura), los viajes del mes y si <b>hay que priorizar</b> su pago. La prioridad es estricta: <b>rota</b> y su saldo vencido <b>pesa</b> frente a lo que carga; a quien se le viene pagando al ritmo no se le prioriza. Sin búsqueda ves la lista completa; haz clic en una fila para abrir su detalle.')
   +`<div class="grid kpis" id="ck"></div>
    <div class="tools"><input id="cq" list="cl" placeholder="Buscar afiliado o placa..." style="min-width:340px" aria-label="Buscar afiliado o placa"><button id="cx" class="mini" type="button">Ver todos</button></div>
    <datalist id="cl">${[...new Set(rows.map(r=>r.afiliado))].sort().map(x=>`<option value="${esc(x)}">`).join('')}${Object.keys(PL).sort().map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
    <div id="cd"></div><div id="cm" style="margin-top:14px"></div>`;
  $('#ck',el).innerHTML=kpi('Pagado a afiliados en el mes',money(sum('pagado')),`anticipos ${money(sum('ant'))} · saldos ${money(sum('saldo'))}`,'acc',{count:sum('pagado')})
    +kpi('Se les debe (cartera)',money(sum('debe')),nf.format(F.length)+' facturas abiertas','warn',{count:sum('debe')})
    +kpi('Vencido (+15 días)',money(sum('vencido')),pc(sum('vencido'),sum('debe'))+' de lo que se debe','bad',{count:sum('vencido'),meter:sum('debe')?sum('vencido')/sum('debe')*100:0})
    +kpi('Críticos + importantes',nf.format(urg.length),`${money(urg.reduce((s,r)=>s+r.vencido,0))} vencidos · ver A quién pagar primero`,'serious',{count:urg.length,fmt:'int'});
  const colsM=[{k:'prioridad',l:'Prioridad',render:r=>lvPill(r.nivel)},{k:'afiliado',l:'Afiliado'},{k:'placas',l:'Placas',num:1},{k:'viajes',l:'Viajes del mes',num:1},{k:'ant',l:'Anticipos pagados (mes)',money:1},{k:'saldo',l:'Saldos pagados (mes)',money:1},
    {k:'pagado',l:'Total pagado (mes)',money:1},{k:'debe',l:'Se le debe',money:1},{k:'vencido',l:'Vencido (+15 d)',money:1},{k:'novenc',l:'No vencido',money:1},{k:'ret',l:'De eso, retenido',money:1}];
  table($('#cm',el),rows,colsM,{sort:'vencido',filterKey:'prioridad',filterLabel:'Todas las prioridades'});
  function consigue(q){
    const Q=N(q); if(!Q) return null;
    if(PL[q.toUpperCase()]||P.some(r=>r.placa===q.toUpperCase())||F.some(r=>r.placa===q.toUpperCase())||V.some(r=>r.placa===q.toUpperCase())) return {modo:'placa',v:q.toUpperCase()};
    if(M[Q]) return {modo:'afiliado',v:Q};
    const c=Object.keys(M).filter(k=>k.includes(Q)); return c.length===1?{modo:'afiliado',v:c[0]}:(c.length>1?{modo:'varios',n:c.length}:{modo:'nada'});
  }
  const VERDICT={1:['SÍ: pagar primero','var(--crit)'],2:['SÍ: pagar esta semana','var(--serious)'],3:['Programar, sin urgencia','var(--warn)'],4:['NO priorizar: se le viene pagando al ritmo','var(--mut)'],5:['NO priorizar: saldo antiguo (sin viajes en 30 días)','var(--s7)'],0:['Sin saldo libre para pagar','var(--mut)']};
  function detalle(){
    const q=$('#cq',el).value.trim(), r=consigue(q), box=$('#cd',el);
    if(!r){ box.innerHTML=''; return; }
    if(r.modo==='nada'){ box.innerHTML='<div class="card">Sin resultados para esa búsqueda.</div>'; return; }
    if(r.modo==='varios'){ box.innerHTML=`<div class="card">Hay ${r.n} afiliados que coinciden; en la lista de abajo quedan filtrados. Escribe más del nombre o haz clic en uno.</div>`; $('#cm #q',el).value=q; $('#cm #q',el).dispatchEvent(new Event('input')); return; }
    const [f,p,v]=r.modo==='placa'?[F.filter(x=>x.placa===r.v),P.filter(x=>x.placa===r.v),V.filter(x=>x.placa===r.v)]:[F.filter(x=>N(x.afiliado)===r.v),P.filter(x=>N(x.proveedor)===r.v),V.filter(x=>N(x.afiliado)===r.v)];
    const vt=v.filter(x=>!x.propia_i);
    const nombres=[...new Set([...f.map(x=>x.afiliado),...p.map(x=>x.proveedor),...v.map(x=>x.afiliado)])];
    const nombre=r.modo==='placa'?nombres.join(' / '):(M[r.v]?M[r.v].afiliado:'');
    const key=r.modo==='placa'?N(nombres[0]||''):r.v, cj=CJ[key], info=r.modo==='placa'?PL[r.v]:AF[r.v];
    const debe=f.reduce((s,x)=>s+x.importe,0), venc=f.filter(x=>x.dfac>VENC).reduce((s,x)=>s+x.importe,0), ret=f.filter(x=>x.ret_i).reduce((s,x)=>s+x.importe,0);
    const ant=p.filter(x=>x.tipo==='ANTICIPO FLOTA'), sal=p.filter(x=>x.tipo!=='ANTICIPO FLOTA'), sa=(a)=>a.reduce((s,x)=>s+x.importe,0);
    const ult=p.map(x=>x.fecha).sort().pop();
    const lv=cj?lvOf(cj.nivel):0, ver=VERDICT[lv];
    const placas=r.modo==='placa'?r.v:[...new Set([...f.map(x=>x.placa),...p.map(x=>x.placa),...v.map(x=>x.placa)].filter(Boolean))].join(', ');
    const por=cj?`Rota: ${cj.rota?'sí':'no'} (${nf.format(cj.v15||0)} viajes en 15 d) · venta que sostiene (30 d) ${money(cj.venta30)} · pagado vs causado (30 d) ${cj.cobertura==null?'—':nf.format(Math.round(cj.cobertura*100))+'%'} · último pago ${cj.dias_sin_pago==null?'sin pagos en el archivo':'hace '+cj.dias_sin_pago+' d'}`:'';
    box.innerHTML=`<div class="card hdr" style="--tone:${ver[1]}"><div class="rowh"><h2>${esc(nombre||r.v)}</h2>${lvPill(cj?cj.nivel:'0-SIN SALDO')}<span class="ans">${ver[0]}</span></div>
      <div style="color:var(--mut);margin-top:6px">${r.modo==='placa'?'Placa':'Placas'}: ${esc(placas||'—')}</div>
      <p style="margin:10px 0 0;color:var(--ink2)">${esc(cj&&cj.motivo?cj.motivo:'Sin viajes ni saldo recientes: nada que priorizar.')}</p>
      ${por?`<p class="note" style="margin-top:6px">${por}</p>`:''}${(()=>{ const pr=MOTOR.PRIO.get(cj?cj.afiliado:''); return pr?`<div style="margin-top:12px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--accent) 7%,transparent)"><div class="lab">Prioridad del analista ${MOTOR.prioPill(cj.afiliado)}</div><p style="margin:6px 0 0;color:var(--ink2)">${esc(pr.motivo||'')}${pr.obs?' — '+esc(pr.obs):''}</p><p class="note" style="margin-top:4px">${pr.compromiso?esc(pr.compromiso)+(pr.fecha_compromiso?' · '+esc(pr.fecha_compromiso):'')+' · ':''}${pr.monto?'Monto solicitado '+money(pr.monto)+' · ':''}Registrada ${esc(pr.fecha||'—')}</p></div>`:''; })()}</div>
      <div class="grid kpis">
        ${kpi('Pagado en el mes',money(sa(p)),`anticipos ${money(sa(ant))} (${ant.length}) · saldos ${money(sa(sal))} (${sal.length})`+(ult?` · último ${fdate(ult)}`:''),'acc')}
        ${kpi('Se le debe',money(debe),nf.format(f.length)+' facturas abiertas'+(ret?` · retenido ${money(ret)}`:''),'warn')}
        ${kpi('Vencido (+15 días)',money(venc),`No vencido ${money(debe-venc)}`,venc>0?'bad':'good',{meter:debe?venc/debe*100:0})}
        ${kpi('Viajes del mes',nf.format(vt.length),info?`últimos 7 d: ${nf.format(info.v7||0)} · 15 d: ${nf.format(info.v15||0)} · 30 d: ${nf.format(info.v30||0)}`:(v.length-vt.length?v.length-vt.length+' de flota propia':''),'acc')}
      </div>
      <h3>Facturas pendientes (lo que se le debe)</h3><div id="d1"></div><h3>Pagos del mes</h3><div id="d2"></div><h3>Viajes del mes</h3><div id="d3"></div>`;
    const f2=f.map(x=>({...x,venc:x.dfac>VENC?x.importe:0,novenc:x.dfac>VENC?0:x.importe,estado:x.ret_i?'Retenida':'Libre',vigencia:x.dfac>VENC?'Vencida':'No vencida'}));
    table($('#d1',box),f2,[{k:'factura',l:'Factura'},{k:'placa',l:'Placa',nosum:1},{k:'fecha',l:'Fecha factura',nosum:1},{k:'dfac',l:'Días desde factura',nosum:1},{k:'importe',l:'Importe pendiente',money:1},
      {k:'venc',l:'Vencido (+15 d)',money:1},{k:'novenc',l:'No vencido',money:1},{k:'vigencia',l:'Vigencia',nosum:1,render:x=>`<span class="pill" style="--tone:${x.dfac>VENC?'var(--crit)':'var(--good)'}">${x.vigencia}</span>`},{k:'estado',l:'Pagable',nosum:1},{k:'mot',l:'Motivo de retención',nosum:1}],{sort:'importe'});
    table($('#d2',box),p,[{k:'fecha',l:'Fecha',nosum:1},{k:'factura',l:'Factura'},{k:'tipo',l:'Tipo',nosum:1},{k:'placa',l:'Placa',nosum:1},{k:'importe',l:'Importe',money:1},{k:'estado',l:'Estado',nosum:1}],{sort:'fecha'});
    const v2=v.map(x=>({...x,utilidad:x.venta-x.compra}));
    table($('#d3',box),v2,[{k:'eid',l:'Manifiesto'},{k:'fecha',l:'Fecha',nosum:1},{k:'oper',l:'Operación',nosum:1},{k:'placa',l:'Placa',nosum:1},{k:'cliente',l:'Cliente',nosum:1},{k:'ruta',l:'Ruta',nosum:1},{k:'estado',l:'Estado',nosum:1},
      {k:'venta',l:'Venta',money:1},{k:'compra',l:'Compra',money:1},{k:'utilidad',l:'Utilidad',money:1},{k:'ant',l:'Anticipo',money:1},{k:'saldo',l:'Saldo pagado',money:1},{k:'pagado',l:'Total pagado',money:1},{k:'estado_pago',l:'Estado del pago',nosum:1}],{sort:'fecha'});
  }
  $('#cq',el).oninput=detalle; $('#cx',el).onclick=()=>{ $('#cq',el).value=''; detalle(); };
  el.addEventListener('click',e=>{ const td=e.target.closest('td'); if(!td||!td.closest('#cm')) return; const tr=td.closest('tr'); const nm=tr.children[1]&&tr.children[1].textContent.trim();
    if(nm&&M[N(nm)]){ $('#cq',el).value=nm; detalle(); $('#cd',el).scrollIntoView({behavior:'smooth'}); } });
})();
