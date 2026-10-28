// ============================================================================
// FLUJO DE CAJA: adelantarse en el tiempo. Cuanto vas a deber vencido las proximas semanas y cuanto pagar por semana para ponerte al dia.
//
// Cada viaje se factura ~LAG dias despues (medido en los datos) y la factura tiene PLAZO (15) dias para pagarse; al dia 16 pasa a vencida.
// Lo que se suma a lo vencido cada semana sale de cuatro fuentes:
//   1) facturas que ya existen y cumplen 15 dias en esa semana (exacto, con su fecha)
//   2) viajes terminados que aun no tienen factura (estimado: se facturan LAG dias despues del viaje)
//   3) viajes en ruta (estimado)
//   4) viajes nuevos (estimado con lo que cada afiliado cargo en los ultimos 30 dias, sin la parte que se paga como anticipo)
// Cada semana se paga con el presupuesto segun la escalera de "A quien pagar primero"; lo que no se paga queda como vencido.
//
// Pantalla en tres niveles: (1) respuesta en una frase + tres numeros, (2) un solo grafico (deuda vencida con y sin tu presupuesto)
// y las metas, (3) "Mas detalle" plegado (origen de lo que se suma, calendario por afiliado, facturas por vencer, historico).
// ============================================================================
(function(){
  const el=$('#s-flujo'); if(!el) return;
  const {C,PRIO,PRIO_TXT,prioPill,PLAZO,LAG,semanaTxt,FAI,fmtD,dia,HOY}=MOTOR;
  // tu ritmo real: lo que pagas por semana en saldos a afiliados (promedio de las ultimas 8 semanas completas, con todo y los lotes grandes)
  const PS=(D.pagos_semana||[]), semOk=p=>new Date(p.sem+'T12:00:00').getTime()+6*864e5<HOY.getTime();      // semana completa: ya termino el domingo
  const U8=PS.filter(semOk).slice(-8), avgOf=(a,k)=>a.length?a.reduce((s,p)=>s+(p[k]||0),0)/a.length:0;
  const medOf=(a,k)=>{ const v=a.map(p=>p[k]||0).sort((x,y)=>x-y), n=v.length; return n?(n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2):0; };
  const RIT={act:avgOf(U8,'saldo_act'),tot:avgOf(U8,'saldo'),totMed:medOf(U8,'saldo'),vence:avgOf(U8.filter(p=>p.vence!=null),'vence'),ant:avgOf(U8,'ant'),prov:avgOf(U8,'prov'),n:U8.length};
  const st={W:RIT.act>0?Math.round(RIT.act/1e6)*1e6:250e6,W0:null,H:12,scope:'activos',est:'amplia',respetar:true}, HMAX=30;
  const ritmo=()=>Math.round((st.scope==='activos'?RIT.act:RIT.tot)/1e6)*1e6;    // en millones enteros, igual que el presupuesto
  const veces=x=>x>=1.9&&x<=2.1?'el doble de':`${nf1.format(x)} veces`;
  const KS3=[{k:'fact',label:'Facturas que ya existen',color:'var(--s1)'},{k:'viajes',label:'Viajes ya hechos o en ruta, sin factura',color:'var(--s2)'},{k:'nuevo',label:'Viajes nuevos (estimado)',color:'var(--s5)'}];
  const prepCache=new Map(), baseCache=new Map(), habCache=new Map(), needCache=new Map();
  let cur={};
  const fmtDY=d=>fmtD(d)+(d.getFullYear()!==HOY.getFullYear()?' '+d.getFullYear():'');
  const scopeTxt=()=>st.scope==='activos'?'afiliados que cargan':'todos los afiliados';
  const DET=[
    {k:'sin',t:'Viajes terminados sin factura de saldo: qué son y cuáles son',s:'Ya terminaron y se les pagó el anticipo, pero el saldo no tiene factura · hay que revisarlos'},
    {k:'orig',t:'¿De dónde sale lo que se suma cada semana?',s:'Facturas que ya existen, viajes hechos sin factura y viajes nuevos estimados'},
    {k:'cal',t:'Calendario de pagos por afiliado y semana',s:'Cuánto pagarle a cada afiliado cada semana · se descarga en CSV'},
    {k:'pv',t:'Facturas que cumplen 15 días en los próximos 7 días',s:'Si las pagas esta semana no se suman a lo vencido'},
    {k:'hist',t:'Todo lo que pagas por semana',s:'Anticipos, saldos, proveedores y gastos de las últimas semanas'},
    {k:'how',t:'Cómo calcula esta hoja',s:''}];

  el.innerHTML=intro(`Cada viaje se factura unos <b>${LAG} días</b> después y la factura se paga en <b>${PLAZO} días</b>; después queda <b>vencida</b>. Aquí ves cuánta deuda vencida vas a tener las próximas semanas y cuánto pagar cada semana para ponerte al día.`)
   +`<div class="phead"><div class="card res" id="fhero" style="margin:0"></div>
      <div class="card ctrl" id="fctrl">
        <div><label class="lab" for="fw">¿Cuánto puedes pagar por semana?</label>
          <div class="budget"><span>$</span><input id="fw" type="number" min="0" step="10" value="${Math.round(st.W/1e6)}" inputmode="decimal" aria-label="Presupuesto semanal en millones de pesos"><span>M</span></div>
          <div class="presets">${RIT.act>0?`<button class="mini" type="button" data-ritmo="1" id="fritmo" title="Lo que pagas hoy en saldos a afiliados, promedio de las últimas ${RIT.n} semanas"></button>`:''}${[100,200,300,500,800].map(v=>`<button class="mini" type="button" data-w="${v}">$${v} M</button>`).join('')}</div></div>
        <div><span class="lab">Semanas a mirar</span><div class="seg" id="fh">${[4,8,12].map(h=>`<button type="button" data-h="${h}" class="${h===st.H?'on':''}">${h} semanas</button>`).join('')}</div></div>
        <label class="chk"><input type="checkbox" id="fr" checked> Respetar las prioridades de los analistas <span class="cnt" style="margin-left:6px">${PRIO.size?PRIO.size+' registradas':'aún no hay'}</span></label>
        <details class="opts"><summary>Más opciones</summary>
          <div class="cgrid" style="margin-top:12px">
            <div><label class="lab" for="fs">Quiénes entran</label><select id="fs"><option value="activos">Los que cargan (recomendado)</option><option value="todos">Todos, incluso saldo antiguo</option></select></div>
            <div><label class="lab" for="fe">Cómo repartir</label><select id="fe"><option value="amplia">A todos, por escalones (recomendado)</option><option value="orden">Completo a los primeros</option></select></div></div>
          <div style="margin-top:10px"><label class="lab" for="f0">Presupuesto de la semana 1 (si es distinto)</label><input id="f0" class="in" type="number" min="0" step="10" placeholder="igual" style="width:100%"></div></details>
      </div></div>
     <div class="grid fgrid"><div id="fcA"></div><div class="card" id="fneed"></div></div>
     <div id="fhab" style="margin-bottom:14px"></div>
     <h3>Esta semana: a quién pagar</h3><div id="fnow"></div>
     <h3>Prioridades de los analistas</h3><div id="fprio"></div>
     <h3>Más detalle</h3>
     <div class="dts">${DET.map(d=>`<details class="card dt" data-k="${d.k}"><summary><span>${d.t}${d.s?`<small>${d.s}</small>`:''}</span></summary><div class="dtb" id="d-${d.k}">${d.k==='how'?HOW():''}</div></details>`).join('')}</div>`;

  function HOW(){
    return `<ul class="hw"><li><b>Plazo.</b> Una factura de afiliado tiene ${PLAZO} días desde su fecha para pagarse; al día ${PLAZO+1} pasa a vencida. Los viajes se facturan en promedio ${LAG} días después de crearse (mediana medida en las facturas actuales).</li>
      <li><b>Lo que se suma a lo vencido cada semana</b> = facturas que ya existen y cumplen ${PLAZO} días esa semana (dato exacto) + viajes terminados sin factura y en ruta (estimado según su fecha) + viajes nuevos (estimado: lo que cada afiliado compró en 30 días × la parte que queda como saldo después del anticipo).</li>
      <li><b>Viajes terminados hace más de ${LAG+PLAZO} días sin factura</b> (${LAG} días normales para facturar + ${PLAZO} de plazo): por su fecha ya deberían estar vencidos. Se cuentan en la semana 1 porque ya se los debes a los afiliados, pero para poder pagarlos primero hay que generar la factura del saldo. La lista está en «Más detalle».</li>
      <li><b>Lo que pagas cada semana</b>: con el presupuesto de la semana se paga a lo que esté vencido, con la misma escalera de «A quién pagar primero» (analistas en Alta primero, luego críticos, importantes y a programar). Lo que no se paga queda como vencido y pasa a la semana siguiente.</li>
      <li><b>Para ponerte al día</b> se busca el presupuesto semanal constante que deja el vencido en cero al final de las semanas elegidas; «que tu deuda no crezca» es el mínimo para que no suba en 8 semanas.</li>
      <li><b>Tu ritmo actual</b> es el promedio de lo que pagaste por semana en saldos a afiliados en las últimas ${RIT.n} semanas completas, con todo y los lotes grandes (en el flujo solo cuenta lo que llega a los afiliados que cargan o a quienes entran en el cálculo). Lo que «se te venció» cada semana es un estimado: el saldo de cada viaje (96% de la compra menos el anticipo) ${LAG+PLAZO} días después de crearse. El plazo real de pago se mide desde la fecha del viaje hasta la fecha en que se pagó su saldo.</li>
      <li><b>Anticipos y proveedores</b>: los viajes nuevos también piden anticipos (≈ 85% de la compra) que se giran al crear el viaje, y se paga a proveedores y gastos. No están en la proyección, que es solo la de saldos a afiliados; se muestran como referencia en «Cómo vienes pagando». Tampoco están los cobros a clientes.</li></ul>`;
  }

  const necesario=Hn=>{ const k=`${Hn}|${st.scope}|${st.est}|${st.respetar}`; if(!needCache.has(k)) needCache.set(k,MOTOR.presupuestoNecesario(Hn,{scope:st.scope,est:st.est,respetar:st.respetar}).W); return needCache.get(k); };
  const noEmpeorar=()=>{ const k=`ne|${st.scope}|${st.est}|${st.respetar}`; if(!needCache.has(k)) needCache.set(k,MOTOR.presupuestoParaNoEmpeorar(MOTOR.prepararFlujo({H:8,scope:st.scope,respetar:st.respetar}),{est:st.est,respetar:st.respetar})); return needCache.get(k); };

  // una sola simulacion de HMAX semanas; el horizonte que se ve (4, 8 o 12) es solo un recorte
  function calc(){
    const pk=`${st.scope}|${st.respetar}`; if(!prepCache.has(pk)) prepCache.set(pk,MOTOR.prepararFlujo({H:HMAX,scope:st.scope,respetar:st.respetar}));
    const P=prepCache.get(pk), H=st.H, bk=`${pk}|${st.est}`;
    if(!baseCache.has(bk)) baseCache.set(bk,MOTOR.simular(P,{W:0,est:st.est,respetar:st.respetar}));
    const r30=MOTOR.simular(P,{W:st.W,W0:st.W0,est:st.est,respetar:st.respetar}), b30=baseCache.get(bk), U=r30.U;
    const np0=U.reduce((s,c)=>{ const p=st.respetar?PRIO.get(c.afiliado):null; return s+((p&&p.prioridad===0)?(c.venc_libre||0):0); },0);   // marcados "No pagar por ahora": no se pagan
    const S0=r30.S0-np0, tol=Math.max(1e6,.002*S0), alDia=r30.weeks.findIndex(w=>w.stockPagable<=tol)+1;                                  // 0 = no llega en HMAX semanas
    // que pasaria si sigues pagando como vienes (tu ritmo actual)
    const rt=Math.round(ritmo()/1e6)*1e6, hk=`${bk}|${rt}`; let hab=null, habAl=0;
    if(rt>0){ if(!habCache.has(hk)) habCache.set(hk,MOTOR.simular(P,{W:rt,est:st.est,respetar:st.respetar})); const hs=habCache.get(hk);
      habAl=hs.weeks.findIndex(w=>w.stockPagable<=tol)+1; if(Math.abs(st.W-rt)>.03*rt) hab={weeks:hs.weeks.slice(0,H)}; }
    cur={H,S0,np0,tol,alDia,hab,habAl,idx:new Map(U.map((c,i)=>[c.afiliado,i])),run:{U,sched:r30.sched,weeks:r30.weeks.slice(0,H)},base:{weeks:b30.weeks.slice(0,H)}};
  }
  const avgIn=()=>cur.run.weeks.reduce((s,w)=>s+w.inflowTotal,0)/cur.H;

  function render(){
    const rb=$('#fritmo',el); if(rb) rb.textContent='Mi ritmo '+money(ritmo());
    calc(); renderHero(); renderMain(); renderNeed(); renderHab(); renderNow(); renderPrio();
    $$('.dt[open]',el).forEach(d=>{ const f=DETF[d.dataset.k]; if(f) f(); });
  }

  // ---------- 1) la respuesta
  function renderHero(){
    const {run,base,S0,np0,alDia,H}=cur, wk=run.weeks, W=st.W, ai=avgIn(), endBase=base.weeks[H-1].stockPagable, end=wk[H-1].stockPagable, ne=noEmpeorar();
    const viejo=sumBy(C,'venc_libre')-(S0+np0), nPay=run.U.reduce((n,c,i)=>n+(run.sched[i][1]>1?1:0),0);
    const rt=ritmo(), esRit=rt>0&&Math.abs(W-rt)<=.03*rt, quien=esRit?`A tu ritmo actual (<b>${money(W)} por semana</b>)`:`Con <b>${money(W)} por semana</b>`;
    const vsRit=(!esRit&&rt>0)?` Eso es ${veces(W/rt)} tu ritmo actual (${money(rt)} por semana), con el que ${cur.habAl>0?`te pondrías al día en ${cur.habAl} semanas`:`no llegas a cero en ${HMAX} semanas`}.`:'';
    let head,sub;
    if(S0<=cur.tol){ head='Hoy no tienes deuda vencida con estos afiliados'; sub=`Cada semana se suman ≈ ${money(ai)} a lo vencido. Mientras los pagues a tiempo te mantienes al día.`; }
    else if(!(W>0)){ head='Escribe cuánto puedes pagar por semana'; sub=`Si no pagas nada, tu deuda vencida sube de ${money(S0)} a ${money(endBase)} en ${H} semanas.`; }
    else if(alDia>0){ head=`${quien} te pones al día ${alDia===1?'<b>esta misma semana</b>':`en <b>${alDia} semanas</b>`}`;
      sub=`Hacia el ${fmtDY(dia(7*alDia))}. Si no pagas nada, tu deuda vencida sube de ${money(S0)} a ${money(endBase)} en ${H} semanas.${vsRit}${alDia>H&&H<12?' Elige más semanas para verlo en el gráfico.':''}`; }
    else if(end>=S0-1e6){ head=`${quien} tu deuda vencida <b>no baja</b>`; sub=`Cada semana se suman ≈ ${money(ai)} a lo vencido. Necesitas al menos ${money(ne)} por semana solo para no atrasarte más, y ${money(necesario(8))} para ponerte al día en 8 semanas.${vsRit}`; }
    else { head=`${quien} tu deuda baja despacio y <b>no llegas a cero</b> en ${HMAX} semanas`; sub=`En ${H} semanas pasa de ${money(S0)} a ${money(end)}. Para ponerte al día en 8 semanas necesitas ${money(necesario(8))} por semana${rt>0?` (${veces(necesario(8)/rt)} tu ritmo actual)`:''}.${vsRit}`; }
    const al=[], f1=wk[0].inflow.fact, oc=wk.reduce((s,w)=>s+w.inflow.oculto,0), alta=st.respetar?[...PRIO.values()].filter(p=>p.prioridad===1):[];
    if(f1>0) al.push(`<b>${money(f1)}</b> en facturas cumplen ${PLAZO} días en los próximos 7 días. Si las pagas esta semana, no se suman a lo vencido.`);
    if(oc>0) al.push(`<b>${money(oc)}</b> son saldos de viajes que terminaron hace más de ${LAG+PLAZO} días y todavía no tienen factura. Ya se los debes a los afiliados, pero no aparecen como vencidos y no se pueden pagar hasta que exista la factura. <button class="mini" type="button" data-open="sin">Ver cuáles son</button>`);
    if(alta.length) al.push(`Los analistas pusieron <b>Alta</b> a ${nf.format(alta.length)} afiliados (${money(alta.reduce((s,p)=>s+((MOTOR.CM.get(p.afiliado)||{}).venc_libre||0),0))} vencidos${alta.some(p=>p.monto>0)?`; piden ${money(alta.reduce((s,p)=>s+(p.monto||0),0))}`:''}). Se pagan primero.`);
    $('#fhero',el).innerHTML=`<span class="eyebrow">Tu agente de pagos</span><h2 class="hl">${head}</h2><p class="hsub">${sub}</p>
      <div class="trio"><div><span>Hoy debes</span><b>${money(S0)}</b><small>vencido a ${scopeTxt()}${st.scope==='activos'&&viejo>1?` · aparte ${money(viejo)} de saldo antiguo (sin viajes en 30 días)`:''}${np0>1?` · ${money(np0)} marcados «No pagar por ahora»`:''}</small></div>
        <div><span>Se suma cada semana</span><b>≈ ${money(ai)}</b><small>a lo vencido: facturas que cumplen ${PLAZO} días, viajes por facturar y viajes nuevos (promedio de ${H} semanas)</small></div>
        <div><span>${esRit?'Tu ritmo actual':'Tú pagas por semana'}</span><b>${money(W)}</b><small>${esRit?`lo que pagas en saldos por semana (promedio de ${RIT.n} semanas) · `:(rt>0?`${veces(W/rt)} tu ritmo actual (${money(rt)}) · `:'')}${nf.format(nPay)} afiliados reciben pago la semana 1${st.W0!=null?` · semana 1: ${money(st.W0)}`:''}</small></div></div>`
      +(al.length?`<ul class="alerts">${al.map(a=>`<li><span>${a}</span></li>`).join('')}</ul>`:'');
  }

  // ---------- 2) el grafico: la deuda vencida con y sin tu presupuesto
  function renderMain(){
    const {run,base,hab,S0,alDia,H}=cur, wk=run.weeks, bw=base.weeks, W=st.W, ai=avgIn();
    const pts=[{label:'Hoy',sub:fmtD(HOY),a:S0,b:S0,c:S0,tip:'Hoy · '+fmtD(HOY)},
      ...wk.map((w,i)=>({label:'Sem '+w.w,sub:fmtD(dia(7*w.w)),a:bw[i].stockPagable,b:w.stockPagable,c:hab?hab.weeks[i].stockPagable:0,tip:`Fin de la semana ${w.w} · ${fmtD(dia(7*w.w))}`,
        extra:[{l:'Se suma esa semana',v:full(w.inflowTotal)},{l:'Pagas esa semana',v:full(w.paid)}]}))];
    const lineas=[{k:'a',label:'Si no pagas nada',color:'var(--s2)'},...(hab?[{k:'c',label:'Como vienes (tu ritmo)',color:'var(--mut)'}]:[]),{k:'b',label:'Con tu presupuesto',color:'var(--s1)'}];
    const lc=lineCols(pts,lineas,{marca:(alDia>0&&alDia<=H)?{i:alDia,label:'Al día'}:null,inicio:true});
    const fila=(a,b,c,d,e,bold)=>`<tr><td style="white-space:nowrap">${a}</td><td class="num">${b}</td><td class="num">${c}</td><td class="num">${bold?'<b>'+d+'</b>':d}</td><td class="num">${e}</td></tr>`;
    const tab=`<div class="tw" style="max-height:360px"><table><thead><tr><th>Semana</th><th class="num">Se suma a lo vencido</th><th class="num">Pagas</th><th class="num">Debes al cierre</th><th class="num">Si no pagas nada</th></tr></thead><tbody>`
      +fila('Hoy · '+fmtD(HOY),'','',full(S0),full(S0),true)
      +wk.map((w,i)=>fila(`Sem ${w.w} · ${semanaTxt(w.w)}`,full(w.inflowTotal),full(w.paid),full(w.stockPagable),full(bw[i].stockPagable),true)).join('')
      +`</tbody><tfoot><tr><td>Total (${H} semanas)</td><td class="num">${full(wk.reduce((s,w)=>s+w.inflowTotal,0))}</td><td class="num">${full(wk.reduce((s,w)=>s+w.paid,0))}</td><td></td><td></td></tr></tfoot></table></div>`;
    const lectura=W>0?(W>ai?`Cada semana pagas <b>${money(W)}</b> y se suman ≈ <b>${money(ai)}</b> a lo vencido: tu deuda baja ≈ <b>${money(W-ai)}</b> por semana.`
      :`Cada semana pagas <b>${money(W)}</b> y se suman ≈ <b>${money(ai)}</b> a lo vencido: tu deuda <b>no baja</b>.`):'';
    $('#fcA',el).innerHTML=figCard({title:'Tu deuda vencida, semana a semana',sub:`Lo que debes vencido al cierre de cada semana · ${scopeTxt()}`,chart:lc.html+(lectura?`<p class="expl" style="margin-top:10px">${lectura}</p>`:''),table:tab});
    lc.bind($('#fcA',el));
  }

  // ---------- metas: cuanto necesitas por semana
  function renderNeed(){
    const ne=noEmpeorar(), rt=ritmo(), filas=[['Que tu deuda no crezca','solo cubres lo que se va sumando',ne,0],...[4,8,12].map(h=>[`Ponerte al día en ${h} semanas`,'',necesario(h),h])];
    const vs=w=>rt>0?(w<=rt*1.02?'tu ritmo actual ya lo cubre':`${veces(w/rt)} tu ritmo actual`):'';
    $('#fneed',el).innerHTML=`<h2>¿Cuánto necesitas por semana?</h2><p class="note">Elige una meta y el tablero usa ese presupuesto${rt>0?`. Hoy pagas ≈ ${money(rt)} por semana`:''}.</p><div class="need">`
      +filas.map(([t,h,w,n])=>`<div class="nr"><div><b>${t}</b><small>${h||('en total '+money(w*n))}${vs(w)?' · '+vs(w):''}</small></div><div class="nv">${money(w)}<small>por semana</small></div>${st.W>=w-1e6?'<span class="pill" style="--tone:var(--good)">Alcanza</span>':`<button class="mini" type="button" data-use="${Math.ceil(w/1e6)}">Usar</button>`}</div>`).join('')+`</div>`;
  }

  // ---------- como vienes pagando: lo que pagas por semana en saldos frente a lo que se te vence (datos reales del archivo de pagos)
  function renderHab(){
    const box=$('#fhab',el); if(!PS.length){ box.innerHTML=''; return; }
    const pl=D.plazo_pago, lo=D.lotes_saldo||{}, al=D.alcance_pago;
    const cols=PS.map(p=>{ const d=new Date(p.sem+'T12:00:00'), par=!semOk(p); return {label:fmtD(d),sub:par?'(parcial)':'',v:p.saldo,l:p.vence,parcial:par,tip:'Semana del '+fmtD(d)+(par?' (hasta hoy)':''),
      extra:[{l:'De eso, a los que cargan',v:full(p.saldo_act)},{l:'Afiliados que cobraron',v:nf.format(p.afil_saldo)},{l:'Anticipos de la semana',v:full(p.ant)}]}; });
    const sv=PS.filter(p=>p.vence!=null);
    const tab=`<div class="tw" style="max-height:340px"><table><thead><tr><th>Semana del</th><th class="num">Saldos pagados</th><th class="num">De eso, a los que cargan</th><th class="num">Se te venció (estimado)</th><th class="num">Pagaste de más (+) o de menos (−)</th></tr></thead><tbody>`
      +PS.map(p=>`<tr><td style="white-space:nowrap">${fmtD(new Date(p.sem+'T12:00:00'))}${semOk(p)?'':' (parcial)'}</td><td class="num">${full(p.saldo)}</td><td class="num">${full(p.saldo_act)}</td><td class="num">${p.vence!=null?full(p.vence):''}</td><td class="num">${p.vence!=null?full(p.saldo-p.vence):''}</td></tr>`).join('')
      +`</tbody><tfoot><tr><td>Total (${PS.length} semanas)</td><td class="num">${full(sumBy(PS,'saldo'))}</td><td class="num">${full(sumBy(PS,'saldo_act'))}</td><td class="num">${full(sumBy(sv,'vence'))}</td><td class="num">${full(sumBy(sv,'saldo')-sumBy(sv,'vence'))}</td></tr></tfoot></table></div>`;
    const top2=(lo.top||[]).slice(0,2), pct2=(lo.total>0&&top2.length===2)?(top2[0].importe+top2[1].importe)/lo.total:0, cells=[];
    if(pl) cells.push(`<div><b>${nf.format(Math.round(pl.p50))} días</b><span>tardas en pagar un saldo, contando desde el viaje (lo normal son ${pl.normal}). Solo el ${Math.round(pl.pct_normal*100)}% se paga a tiempo.</span></div>`);
    cells.push(`<div><b>${money(RIT.tot)}</b><span>pagas por semana en saldos (promedio de ${RIT.n} semanas; una semana típica son ${money(RIT.totMed)}). Se te vencen ≈ ${money(RIT.vence)}.</span></div>`);
    if(pct2>=.2) cells.push(`<div><b>${Math.round(pct2*100)}%</b><span>de lo pagado en saldos desde agosto salió en solo 2 días (${top2.map(x=>fmtD(new Date(x.fecha+'T12:00:00'))).join(' y ')}): pagas por lotes.</span></div>`);
    if(al&&al.con_vencido>0) cells.push(`<div><b>${nf.format(al.pagados)} de ${nf.format(al.con_vencido)}</b><span>afiliados que cargan y tienen vencido recibieron algún saldo en las últimas 4 semanas; ${nf.format(al.sin_pago)} no recibieron nada (${money(al.venc_sin_pago)}).</span></div>`);
    box.innerHTML=figCard({title:'Cómo vienes pagando',sub:'Saldos pagados a afiliados cada semana frente a lo que se te venció (estimado) · datos reales del archivo de pagos',
      chart:barsLine(cols,{barLabel:'Saldos que pagaste',lineLabel:'Lo que se te venció (estimado)'})+`<div class="strip" style="margin:12px 0 0">${cells.join('')}</div>`
        +`<p class="note" style="margin:10px 0 0">Aparte pagas ≈ <b>${money(RIT.ant)}</b> por semana en anticipos y ≈ <b>${money(RIT.prov)}</b> a proveedores y gastos. El detalle semana a semana está en «Más detalle».</p>`,table:tab});
  }

  // ---------- esta semana: a quien pagar (los 10 que mas reciben; el total es de todos)
  function renderNow(){
    const {run}=cur, rows=[];
    run.U.forEach((c,i)=>{ const v=run.sched[i][1]; if(v<=1) return; rows.push({afiliado:c.afiliado,nivel:c.nivel,prio_txt:MOTOR.prioTexto(c.afiliado),clientes:MOTOR.cliTxt(c.afiliado).corto,venc:Math.round(c.venc_libre||0),pay:Math.round(v)}); });
    const hay=PRIO.size>0&&st.respetar;
    $('#fnow',el).innerHTML=`<p class="note" style="margin:0 0 10px">Así se reparten los <b>${money(run.weeks[0].budget)}</b> de la semana 1 (${semanaTxt(1)}). Se ven los 10 que más reciben, el total es de todos; busca a cualquiera en el cuadro. El calendario de todas las semanas está en «Más detalle».</p><div id="fnt"></div>`;
    table($('#fnt',el),rows,[{k:'afiliado',l:'Afiliado'},{k:'nivel',l:'Prioridad',nosum:1,render:r=>lvPill(r.nivel)},
      ...(hay?[{k:'prio_txt',l:'Analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">—</span>'}]:[]),
      {k:'clientes',l:'Clientes que mueve',nosum:1},{k:'venc',l:'Se le debe vencido',money:1},{k:'pay',l:'Pagas esta semana',money:1,render:r=>`<b title="${full(r.pay)}">${money(r.pay)}</b>`}],{sort:'pay',max:10});
  }

  // ---------- prioridades de los analistas (para Carlos)
  function renderPrio(){
    const rows=(D.prioridades||[]), meta=D.prio_meta||{}, ok=rows.filter(p=>p.estado_match==='OK'||p.estado_match==='APROXIMADO');
    if(!ok.length){ $('#fprio',el).innerHTML=`<div class="card"><p class="note" style="margin:0">Aún no hay prioridades registradas por los analistas. Se digitan en el Excel compartido <b>${esc((meta.archivo||'Prioridades de pago.xlsx').split('\\').pop())}</b> y se ven aquí después de actualizar el dashboard. Mira la pestaña «Prioridades de analistas».</p></div>`; return; }
    const por=new Map(); ok.forEach(p=>{ const k=p.analista||'(sin nombre)'; por.set(k,(por.get(k)||0)+1); });
    const dat=ok.map(p=>{ const c=MOTOR.CM.get(p.afiliado)||{}, i=cur.idx.get(p.afiliado), fi=FAI.get(p.afiliado)||{};
      return {ptxt:PRIO_TXT[p.prioridad],prioridad:p.prioridad,afiliado:p.afiliado,cliente:p.cliente||(MOTOR.cliTxt(p.afiliado).principal),motivo:p.motivo,obs:p.obs,comp:(p.compromiso||'')+(p.fecha_compromiso?' · '+p.fecha_compromiso:''),monto:p.monto||0,analista:p.analista,fecha:p.fecha,
        deuda:c.venc_libre||0,porv:fi.porVencer||0,sem1:i!=null?Math.round(cur.run.sched[i][1]):0,nivel:c.nivel||'0-SIN SALDO'}; }).sort((a,b)=>{ const ra=a.prioridad===0?9:a.prioridad, rb=b.prioridad===0?9:b.prioridad; return ra-rb||b.deuda-a.deuda; });
    $('#fprio',el).innerHTML=`<div class="strip" style="margin-bottom:12px"><div><b>${nf.format(ok.length)}</b><span>afiliados con prioridad de analista · Alta ${ok.filter(p=>p.prioridad===1).length} · Media ${ok.filter(p=>p.prioridad===2).length} · Baja ${ok.filter(p=>p.prioridad===3).length} · No pagar ${ok.filter(p=>p.prioridad===0).length}</span></div>
      <div><b>${money(dat.filter(d=>d.prioridad===1).reduce((s,d)=>s+d.deuda,0))}</b><span>vencidos de los afiliados en Alta</span></div><div><b>${money(dat.reduce((s,d)=>s+d.monto,0))}</b><span>montos que pidieron pagar</span></div>
      <div><b>${money(dat.reduce((s,d)=>s+d.sem1,0))}</b><span>que el plan paga en la semana 1 a estos afiliados</span></div>
      <div><span>Por analista</span><b style="font-size:14px;font-weight:600">${[...por.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${esc(k)} (${v})`).join(' · ')}</b></div></div><div id="fpt"></div>`;
    table($('#fpt',el),dat,[{k:'ptxt',l:'Prioridad',nosum:1,render:r=>prioPill(r.afiliado)||esc(r.ptxt)},{k:'afiliado',l:'Afiliado'},{k:'cliente',l:'Cliente',nosum:1},{k:'motivo',l:'Motivo',nosum:1},{k:'obs',l:'Observaciones',nosum:1,acc:1},
      {k:'comp',l:'¿Va a cargar si le pagan?',nosum:1},{k:'monto',l:'Monto solicitado',money:1},{k:'deuda',l:'Se le debe vencido',money:1},{k:'porv',l:'Por vencer (15 d)',money:1},{k:'sem1',l:'Plan: semana 1',money:1},{k:'analista',l:'Analista',nosum:1},{k:'fecha',l:'Registrada',nosum:1}],{sort:null,filterKey:'ptxt',filterLabel:'Todas las prioridades'});
  }

  // ---------- 3) mas detalle (se dibuja al abrir cada seccion)
  // viajes terminados que aun no tienen factura de saldo en cuentas por pagar (la lista detras de la alerta "ya se los debes")
  function renderSin(){
    const oculto=LAG+PLAZO+1, lim=LAG+PLAZO;
    const GRUPO={a:'ya tienen cumplido: deberían tener factura',b:'sin cumplir: falta el cumplido para poder facturar',c:'cumplido sin soporte: suelen quedar retenidos',d:'sin dato del cumplido'};
    const CUMP={SI:'Sí (con soporte)',NUEVO:'Nuevo (sin cumplir)',PEND:'Pendiente',VIRTUAL:'Virtual (sin soporte)',SIN_DOC:'Sin documento'};
    const gk=c=>{ const k=String(c||'').toUpperCase(); return k==='SI'?'a':(k==='NUEVO'||k==='PEND')?'b':(k==='VIRTUAL'||k==='SIN_DOC')?'c':'d'; };
    const rows=[];
    MOTOR.PIPE.forEach(p=>{ if(p.tipo!=='liquidar') return; const c=MOTOR.CAFN.get(p.afn); if(!c||!cur.idx.has(c.afiliado)) return;
      rows.push({eid:p.eid,placa:p.placa,afiliado:c.afiliado,cliente:p.cliente||'',ruta:`${p.origen||''} → ${p.destino||''}`,fecha:p.fecha,fcump:p.fcump||'',dias:p.edad,cump:CUMP[String(p.cumplido||'').toUpperCase()]||'Sin dato',g:gk(p.cumplido),
        compra:Math.round(p.compra||0),pagado:Math.round(p.pagado||0),saldo:Math.round(p.monto||0),grupo:p.edad>=oculto?`Más de ${lim} días`:`Menos de ${lim} días`}); });
    const old=rows.filter(r=>r.dias>=oculto), sp=old.filter(r=>r.pagado<1); cur.sinRows=old;
    const cell=k=>{ const xs=old.filter(r=>r.g===k); return xs.length?`<div><b>${money(sumBy(xs,'saldo'))}</b><span>${nf.format(xs.length)} viajes · ${GRUPO[k]}</span></div>`:''; };
    $('#d-sin',el).innerHTML=`<div class="brief" style="margin-bottom:12px">${ico('info')}<p><b>Qué son.</b> A un afiliado se le paga en dos partes: el <b>anticipo</b> cuando sale el viaje y el <b>saldo</b> cuando el viaje termina y se entregan los documentos (el cumplido). El saldo se paga contra una <b>factura</b> en cuentas por pagar, y esa factura tiene ${PLAZO} días para pagarse. Estos viajes ya terminaron (casi todos ya recibieron su anticipo), pero <b>la factura del saldo todavía no existe</b>.<br>
      <b>Por qué importa.</b> Ese saldo ya se lo debes al afiliado, pero no cuenta como vencido (solo cuentan las facturas que existen) y no se puede pagar. Si la factura hubiera salido a tiempo (${LAG} días), a los ${lim} días ya estaría vencida.<br>
      <b>Qué hacer.</b> En los que ya tienen cumplido, pedir que generen la factura del saldo; en los demás, gestionar primero el cumplido. Si alguno ya se pagó por otro medio, avísame y lo saco del cálculo. El saldo es el 96% de la compra menos lo que ya se pagó. <button class="mini" type="button" id="fexps" style="margin-left:6px">Descargar los de más de ${lim} días (CSV)</button></p></div>
      <div class="strip" style="margin-bottom:12px"><div><b>${money(sumBy(old,'saldo'))}</b><span>${nf.format(old.length)} viajes terminados hace más de ${lim} días, sin factura</span></div>${cell('a')}${cell('b')}${cell('c')}${cell('d')}</div>${sp.length?`<p class="note" style="margin:-4px 0 12px">De esos, <b>${nf.format(sp.length)}</b> viajes (${money(sumBy(sp,'saldo'))}) no tienen ningún pago registrado, ni siquiera el anticipo: revísalos primero, puede que no se hayan pagado o que se pagaran por otra vía.</p>`:''}<div id="fsin"></div>`;
    table($('#fsin',el),rows,[{k:'eid',l:'Manifiesto'},{k:'placa',l:'Placa',nosum:1},{k:'afiliado',l:'Afiliado',nosum:1},{k:'cliente',l:'Cliente',nosum:1},{k:'fecha',l:'Fecha del viaje',nosum:1},{k:'dias',l:'Días desde el viaje',num:1,nosum:1},
      {k:'cump',l:'Cumplido',nosum:1},{k:'compra',l:'Compra del viaje',money:1},{k:'pagado',l:'Ya pagado',money:1},{k:'saldo',l:'Saldo sin factura',money:1,render:r=>`<b title="${full(r.saldo)}">${money(r.saldo)}</b>`}],
      {sort:'saldo',filterKey:'grupo',filterInit:`Más de ${lim} días`,filterLabel:'Todos los terminados sin factura'});
  }
  function renderOrig(){
    const {run}=cur, wk=run.weeks, T=[['fact','Facturas que cumplen 15 días'],['liq','Viajes terminados sin factura'],['oculto',`Terminados hace más de ${LAG+PLAZO} días sin factura`],['causar','Viajes en ruta'],['nuevo','Viajes nuevos (estimado)']];
    const cols=wk.map(w=>({label:'Sem '+w.w,sub:fmtD(dia(7*(w.w-1)+1)),v:{fact:w.inflow.fact,viajes:w.inflow.liq+w.inflow.oculto+w.inflow.causar,nuevo:w.inflow.nuevo},tip:`Semana ${w.w} · ${semanaTxt(w.w)}`}));
    const sm=k=>wk.reduce((s,w)=>s+w.inflow[k],0);
    const tab=`<div class="tw" style="max-height:340px"><table><thead><tr><th>Semana</th>${T.map(t=>`<th class="num">${t[1]}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>`
      +wk.map(w=>`<tr><td style="white-space:nowrap">${w.w} · ${semanaTxt(w.w)}</td>${T.map(t=>`<td class="num">${w.inflow[t[0]]?full(w.inflow[t[0]]):''}</td>`).join('')}<td class="num"><b>${full(w.inflowTotal)}</b></td></tr>`).join('')
      +`</tbody><tfoot><tr><td>Total (${cur.H} semanas)</td>${T.map(t=>`<td class="num">${full(sm(t[0]))}</td>`).join('')}<td class="num">${full(wk.reduce((s,w)=>s+w.inflowTotal,0))}</td></tr></tfoot></table></div>`;
    $('#d-orig',el).innerHTML=figCard({title:'Lo que se suma a lo vencido cada semana',sub:'Por origen · sin contar tu presupuesto',chart:stackCols(cols,KS3,{}),table:tab});
  }
  function schedRows(){
    const {run,H}=cur, rows=[];
    run.U.forEach((c,i)=>{ const s=run.sched[i]; let tot=0; for(let w=1;w<=H;w++) tot+=s[w]; if(tot<=1) return;
      const o={afiliado:c.afiliado,nivel:c.nivel,lv:c.lv,tot,prio_txt:MOTOR.prioTexto(c.afiliado)}; for(let w=1;w<=H;w++) o['w'+w]=Math.round(s[w]); rows.push(o); });
    return rows;
  }
  function renderSched(){
    const {H}=cur, rows=schedRows();
    $('#d-cal',el).innerHTML=`<div class="brief" style="margin-bottom:12px">${ico('info')}<p>Cuánto pagarle a cada afiliado en cada semana con tu presupuesto de <b>${money(st.W)}</b> por semana. <b>Sem 1</b> son los próximos 7 días (${semanaTxt(1)}). <button class="mini" type="button" id="fexp" style="margin-left:8px">Descargar calendario (CSV)</button></p></div><div id="fst"></div>`;
    const cols=[{k:'afiliado',l:'Afiliado',render:r=>`<span style="display:inline-block;min-width:190px">${esc(r.afiliado)}</span>`},{k:'nivel',l:'Prioridad',nosum:1,render:r=>lvPill(r.nivel)},{k:'prio_txt',l:'Analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">—</span>'},{k:'tot',l:'Total',money:1,render:r=>`<b>${money(r.tot)}</b>`}];
    for(let w=1;w<=H;w++) cols.push({k:'w'+w,l:`Sem ${w}<br><small style="font-weight:500;text-transform:none;letter-spacing:0">${fmtD(dia(7*(w-1)+1))}</small>`,money:1});
    table($('#fst',el),rows,cols,{sort:'tot'});
  }
  function renderPv(){
    const rows=[...FAI.entries()].filter(([a,x])=>x.pv7>1).map(([a,x])=>{ const c=MOTOR.CM.get(a)||{}, i=cur.idx.get(a); return {afiliado:a,nivel:c.nivel||'0-SIN SALDO',pv7:Math.round(x.pv7),pv:Math.round(x.porVencer),sem1:i!=null?Math.round(cur.run.sched[i][1]):0,prio_txt:MOTOR.prioTexto(a)}; });
    $('#d-pv',el).innerHTML=`<p class="note" style="margin:0 0 10px">Pagarlas esta semana evita que se sumen a lo vencido: <b>${money(rows.reduce((s,r)=>s+r.pv7,0))}</b> en ${nf.format(rows.length)} afiliados.</p><div id="fpvt"></div>`;
    table($('#fpvt',el),rows,[{k:'afiliado',l:'Afiliado'},{k:'nivel',l:'Prioridad',nosum:1,render:r=>lvPill(r.nivel)},{k:'prio_txt',l:'Analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">—</span>'},{k:'pv7',l:'Vence en 7 días',money:1},{k:'pv',l:'Por vencer (15 d)',money:1},{k:'sem1',l:'Plan: semana 1',money:1}],{sort:'pv7',max:100});
  }
  // todo lo que sale por semana: anticipos, saldos, proveedores y gastos
  function renderTodo(){
    const rows=PS.map(p=>({sem:p.sem,semHtml:`<span style="white-space:nowrap">${fmtD(new Date(p.sem+'T12:00:00'))}${semOk(p)?'':' (parcial)'}</span>`,ant:p.ant,saldo:p.saldo,act:p.saldo_act,prov:p.prov,otros:p.otros,tot:p.ant+p.saldo+p.prov+p.otros,afil:p.afil_saldo}));
    $('#d-hist',el).innerHTML=`<p class="note" style="margin:0 0 10px">Promedio de las últimas ${RIT.n} semanas completas: <b>${money(RIT.ant)}</b> en anticipos, <b>${money(RIT.tot)}</b> en saldos a afiliados y <b>${money(RIT.prov)}</b> a proveedores y gastos. «Otros» son facturas de afiliados, cruces y descuentos.</p><div id="fhist"></div>`;
    table($('#fhist',el),rows,[{k:'sem',l:'Semana del',render:r=>r.semHtml},{k:'ant',l:'Anticipos',money:1},{k:'saldo',l:'Saldos a afiliados',money:1},{k:'act',l:'De eso, a los que cargan',money:1},
      {k:'prov',l:'Proveedores y gastos',money:1},{k:'otros',l:'Otros',money:1},{k:'tot',l:'Total pagado',money:1},{k:'afil',l:'Afiliados con saldo',num:1,nosum:1}],{sort:'sem'});
  }
  const DETF={sin:renderSin,orig:renderOrig,cal:renderSched,pv:renderPv,hist:renderTodo};

  // ---------- eventos
  el.addEventListener('click',e=>{
    const rr=e.target.closest('[data-ritmo]'); if(rr){ const v=Math.round(ritmo()/1e6); $('#fw',el).value=v; st.W=v*1e6; render(); return; }
    const w=e.target.closest('[data-w]'); if(w){ $('#fw',el).value=w.dataset.w; st.W=+w.dataset.w*1e6; render(); return; }
    const u=e.target.closest('[data-use]'); if(u){ $('#fw',el).value=u.dataset.use; st.W=+u.dataset.use*1e6; render(); return; }
    const h=e.target.closest('[data-h]'); if(h){ st.H=+h.dataset.h; $$('#fh button',el).forEach(b=>b.classList.toggle('on',b===h)); render(); return; }
    const o=e.target.closest('[data-open]'); if(o){ const d=el.querySelector(`.dt[data-k="${o.dataset.open}"]`); if(d){ d.open=true; d.scrollIntoView({behavior:'smooth',block:'start'}); } return; }
    if(e.target.closest('#fexp')) exportar();
    if(e.target.closest('#fexps')) exportarSin();
  });
  $$('.dt',el).forEach(d=>d.addEventListener('toggle',()=>{ if(d.open){ const f=DETF[d.dataset.k]; if(f) f(); } }));
  $('#fw',el).addEventListener('input',e=>{ st.W=Math.max(0,(+e.target.value||0))*1e6; render(); });
  $('#f0',el).addEventListener('input',e=>{ st.W0=e.target.value===''?null:Math.max(0,+e.target.value)*1e6; render(); });
  $('#fs',el).onchange=e=>{ st.scope=e.target.value; render(); };
  $('#fe',el).onchange=e=>{ st.est=e.target.value; render(); };
  $('#fr',el).onchange=e=>{ st.respetar=e.target.checked; render(); };
  function descargar(nombre,enc,L){
    const blob=new Blob(['﻿'+[enc.join(';'),...L].join('\r\n')],{type:'text/csv;charset=utf-8'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=nombre+'_'+(D.meta.hoy||'').split('/').reverse().join('-')+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  function exportarSin(){
    const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    descargar('viajes_terminados_sin_factura',['Manifiesto','Placa','Afiliado','Cliente','Ruta','Fecha del viaje','Días desde el viaje','Cumplido','Fecha del cumplido','Compra del viaje','Ya pagado','Saldo sin factura'],
      (cur.sinRows||[]).slice().sort((a,b)=>b.saldo-a.saldo).map(r=>[q(r.eid),q(r.placa),q(r.afiliado),q(r.cliente),q(r.ruta),q(dmy(r.fecha)),r.dias,q(r.cump),q(dmy(r.fcump)),r.compra,r.pagado,r.saldo].join(';')));
  }
  function exportar(){
    const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"', H=cur.H, enc=['Afiliado','Prioridad del sistema','Prioridad del analista','Total',...Array.from({length:H},(_,i)=>`Sem ${i+1} (${fmtD(dia(7*i+1))})`)];
    const L=schedRows().map(r=>[q(r.afiliado),q(lvTxt(r.nivel)),q(PRIO.get(r.afiliado)?PRIO_TXT[PRIO.get(r.afiliado).prioridad]:''),Math.round(r.tot),...Array.from({length:H},(_,i)=>r['w'+(i+1)])].join(';'));
    const blob=new Blob(['\ufeff'+[enc.join(';'),...L].join('\r\n')],{type:'text/csv;charset=utf-8'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='calendario_de_pagos_'+(D.meta.hoy||'').split('/').reverse().join('-')+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  render();
})();
