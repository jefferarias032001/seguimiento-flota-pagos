// ============================================================================
// A QUIEN PAGAR PRIMERO  (hoja unica: antes "Plan de caja" + "A quien pagar primero")
//
// Escribes cuanto tienes y la hoja dice a quien pagarle, cuanto y por que.
// Reglas (estrictas, calculadas en actualizar_seguimiento.py):
//   - solo es urgente quien ROTA y cuyo saldo vencido libre PESA frente a lo que carga al mes;
//   - a quien ya se le viene pagando al ritmo no se le prioriza; sin viajes en 30 dias = saldo antiguo.
// Reparto "amplio" (por defecto): una ESCALERA de pago. Primero se le paga a TODOS los prioritarios 3,5 dias de lo que
//   ganan, luego 1 semana, 2 semanas, 4 semanas y, al final, el saldo completo. En cada escalon se atiende por nivel
//   (critico -> importante -> a programar) y, si no alcanza, se reparte proporcional dentro del ultimo nivel atendido.
// Los analistas pueden subir (Alta), bajar (Baja) o sacar (No pagar por ahora) a un afiliado, o pedir un monto: ver motor.js.
// Dos lecturas del resultado:
//   ALCANCE      = a cuantos prioritarios les alcanza a pagar algo (sube rapido y se llena pronto);
//   PROFUNDIDAD  = que parte de lo vencido se les paga (sigue subiendo cuando ya se llego a todos).
// ============================================================================
(function(){
  const el=$('#s-caja'); if(!el) return;
  const {C,CC,CM,CMN,FAI,byAf,afTot,shareOf,CLIENTS,corto,cliTxt,ESC,asignar,costos,candidatos,PRIO,prioPill,prioTexto,reqOf}=MOTOR;
  if(!C.length){ el.innerHTML=intro('Esta actualización no trae datos para esta hoja.'); return; }
  const pv=MOTOR.pv;
  const act=C.filter(x=>x.viajes30>0), ant5=C.filter(x=>x.lv===5), cri=C.filter(x=>x.lv===1), imp=C.filter(x=>x.lv===2), prg=C.filter(x=>x.lv===3);
  const REGLA={1:'Rota (3+ viajes en 15 d, 2+ en 7 d o viaje activo) y su saldo vencido libre es de al menos $3 M y pesa medio mes de lo que carga (o un cuarto de mes con más de 10 días sin pago).',
    2:'Rota y su saldo vencido libre es de al menos $1 M y pesa un quinto de mes de lo que carga.',3:'Cargó en los últimos 30 días pero no rota; saldo vencido libre de al menos $1 M y medio mes de lo que carga.',
    4:'Cargó en 30 días y ya se le viene pagando al ritmo: su saldo es pequeño frente a lo que mueve.'};
  const st={B:200e6,est:'amplia',incl:3,respetar:true,focus:new Set(),view:'afiliado',ord:'pay',open:new Set()};
  let cur={rows:[],clientes:[]};

  // ---------- esqueleto (se construye una vez; luego solo se actualizan los valores)
  el.innerHTML=intro('Escribe cuánto tienes y te digo <b>a quién pagarle, cuánto y por qué</b>. Regla estricta: un saldo solo es urgente si el afiliado <b>rota</b> (carga seguido) y su <b>saldo vencido pesa</b> frente a lo que gana al mes; a quien ya se le viene pagando al ritmo <b>no se le prioriza</b>. Vencido = más de 15 días desde la factura; lo retenido no se puede pagar y no entra. <b>Cómo leer el resultado:</b> el <b>alcance</b> es a cuántos prioritarios les pagas algo y la <b>profundidad</b> es qué parte de lo que se les debe les pagas. Con poco dinero sube el alcance; cuando ya llegas a todos, más dinero sube la profundidad.')
   +`<div class="phead">
      <div class="card res" id="res"><span class="eyebrow" id="resEy"></span>
        <div class="duo">
          <div class="duoc"><div class="lab">Alcance ${qm('Alcance','A cuántos de los afiliados prioritarios alcanzas a pagarles algo. Con poco dinero sube rápido; cuando llegas a todos ya no puede subir más.')}</div>
            <div class="dbig"><b id="nA" data-fmt="int" data-count="0">0</b><span id="nAof"></span></div><div class="dsub" id="aSub"></div>
            <div class="meter big" style="--tone:var(--s1)"><i id="mA" style="width:0"></i></div></div>
          <div class="duoc"><div class="lab">Profundidad ${qm('Profundidad','Qué parte de lo que se les debe vencido alcanzas a pagarles. Cuando ya llegas a todos, más presupuesto sube esta barra: le pagas más a cada afiliado.')}</div>
            <div class="dbig"><b id="nP" data-fmt="pct0" data-count="0">0%</b><span>de lo vencido</span></div><div class="dsub" id="pSub"></div>
            <div class="meter big" style="--tone:var(--s2)"><i id="mP" style="width:0"></i></div></div>
        </div>
        <p class="expl" id="why"></p><p class="expl" id="anl" style="margin-top:8px"></p>
        <div class="stepbox"><div class="lab">Escalera de pago ${qm('Escalera de pago','El plan paga por escalones: primero a todos los prioritarios 3,5 días de lo que ganan, luego 1 semana, 2 semanas, 4 semanas y al final el saldo completo. Lo que gana un afiliado = su compra de los últimos 30 días ÷ 30, por día.')}</div>
          <div class="steps" id="steps"></div><p class="expl" id="stepNote"></p></div>
        <p class="example" id="ex"></p></div>
      <div class="card ctrl" id="ctrl">
        <div><label class="lab" for="bp">¿Cuánto tienes para pagar?</label>
          <div class="budget"><span>$</span><input id="bp" type="number" min="0" step="10" value="200" inputmode="decimal" aria-label="Presupuesto en millones de pesos"><span>M</span></div>
          <div class="presets">${[50,100,200,400,800].map(v=>`<button class="mini" type="button" data-p="${v}">$${v} M</button>`).join('')}</div></div>
        <label class="chk"><input type="checkbox" id="br" checked> Respetar las prioridades de los analistas <span class="cnt" style="margin-left:6px">${PRIO.size?PRIO.size+' registradas':'aún no hay'}</span></label>
        <div><span class="lab">Proteger primero a estos clientes (opcional) ${qm('Proteger primero','Marca uno o varios clientes y el plan les paga antes a los afiliados que los mueven (los que dedican al menos el 20% de su carga a ese cliente).')}</span><div class="fchips" id="bf"></div></div>
        <details class="opts"><summary>Opciones del reparto</summary><div class="cgrid">
          <div><label class="lab" for="be">Cómo repartir</label><select id="be"><option value="amplia">A todos los prioritarios, por escalones (recomendado)</option><option value="orden">Completo a los primeros de la lista</option></select></div>
          <div><label class="lab" for="bn">A quiénes incluir</label><select id="bn"><option value="3">Críticos, importantes y a programar</option><option value="2">Solo críticos e importantes</option><option value="1">Solo críticos</option><option value="4">Todos los que cargaron (incluye los que van al ritmo)</option></select></div></div></details>
      </div></div>
     <div class="viewbar" id="vb"></div><div id="out"></div>
     <h3>Análisis del plan</h3>
     <div class="card ins" id="ins"></div>
     <div class="grid two" id="viz"></div>
     <div class="strip" id="diag"></div>
     <details class="card how"><summary>Cómo calcula esta hoja</summary><ul>
       <li><b>Prioridad.</b> Crítico: rota y su saldo vencido libre es de al menos $3 M y pesa medio mes de lo que carga (o un cuarto de mes con más de 10 días sin pago). Importante: rota, al menos $1 M y un quinto de mes. A programar: cargó pero no rota. Al ritmo: ya se le viene pagando lo que causa. Saldo antiguo: sin viajes en 30 días.</li>
       <li><b>Prioridad de los analistas.</b> Alta: sube al afiliado al inicio del plan aunque el sistema no lo priorice (y si pidieron un monto, ese monto se paga primero). Media: lo incluye. Baja: lo deja al final. No pagar por ahora: lo saca del plan. Se digitan en el Excel compartido (ver la pestaña «Prioridades de analistas»).</li>
       <li><b>Lo que gana un afiliado</b> = su compra de los últimos 30 días ÷ 30, por día. Ejemplo: si carga $3 M al día, pagarle $21 M equivale a 7 días de su ingreso.</li>
       <li><b>Escalera.</b> A todos los prioritarios se les paga 3,5 días de lo que ganan, luego 1 semana, 2 semanas, 4 semanas y por último el saldo completo (nunca más de lo que se les debe vencido y libre). En cada escalón se atiende por nivel (analistas en Alta, crítico, importante, a programar) y los clientes protegidos primero; si el dinero no alcanza, se reparte proporcional dentro del último nivel atendido.</li>
       <li><b>Alcance</b> = a cuántos prioritarios les pagas algo. <b>Profundidad</b> = qué parte de su deuda vencida les pagas. Más presupuesto primero amplía el alcance; cuando ya llegas a todos, sube la profundidad.</li>
       <li><b>Por vencer y por facturar</b>: «Por vencer» son sus facturas libres con menos de 15 días (pasarán a vencidas si no se pagan); «Viajes por facturar» son sus viajes terminados o en ruta que aún no tienen factura. Ver «Flujo de caja» para proyectarlos semana a semana.</li>
       <li><b>Por cliente</b>: la deuda vencida y el pago de cada afiliado se reparten entre sus clientes según su venta de 30 días con cada uno.</li></ul></details>`;
  $('#diag',el).innerHTML=`<div><b>${nf.format(act.length)}</b><span>afiliados cargaron en 30 días · venta ${money(sumBy(act,'venta30'))}</span></div>
    <div><b>${pc(sumBy(act,'pagado30'),sumBy(act,'compra30'))}</b><span>de lo causado ya se les pagó en 30 días (${money(sumBy(act,'pagado30'))})</span></div>
    <div><b>${money(sumBy(C,'venc_libre'))}</b><span>saldo vencido libre total · ${nf.format(C.filter(x=>x.venc_libre>0).length)} afiliados</span></div>
    <div><b>${pc(sumBy(ant5,'venc_libre'),sumBy(C,'venc_libre'))}</b><span>de ese saldo es de afiliados sin viajes en 30 días (${money(sumBy(ant5,'venc_libre'))}): no frena la operación</span></div>
    <div><b>${money(sumBy(cri,'venc_libre')+sumBy(imp,'venc_libre'))}</b><span>urgente: ${cri.length} críticos + ${imp.length} importantes · a programar ${money(sumBy(prg,'venc_libre'))}</span></div>`;
  const drawChips=()=>{ $('#bf',el).innerHTML=CLIENTS.slice(0,10).map(c=>`<span class="pchip ${st.focus.has(c)?'on':''}" data-c="${esc(c)}" role="button" tabindex="0">${esc(corto(c))}</span>`).join('')+(st.focus.size?'<span class="pchip" data-c="" role="button" tabindex="0">Quitar</span>':''); };
  drawChips();

  // ---------- motor de reparto (reglas compartidas en motor.js)
  function presupuestoParaLlegar(cand){           // presupuesto minimo para pagarle algo a todos
    if(!cand.length) return 0; let lo=0, hi=cand.reduce((s,c)=>s+c.need,0);
    if(st.est==='orden') return hi;
    for(let i=0;i<26;i++){ const mid=(lo+hi)/2; if(asignar(cand,mid,st.est).paid.every(v=>v>1)) hi=mid; else lo=mid; }
    return hi;
  }
  const medir=(cand,paid,B)=>{ const rs=cand.map((c,i)=>({c,p:paid[i]})), pag=rs.filter(r=>r.p>1), venc=cand.reduce((s,c)=>s+c.need,0), asig=paid.reduce((s,v)=>s+v,0), si=pag.reduce((s,r)=>s+r.c.inc,0);
    return {N:cand.length,nPag:pag.length,ventaPag:pag.reduce((s,r)=>s+r.c.venta30,0),venc,asig,prof:venc>0?asig/venc*100:0,dias:si>0?pag.reduce((s,r)=>s+Math.min(r.p,r.c.need),0)/si:0,rest:Math.max(0,B-asig)}; };
  // campos que se agregan a cada afiliado para las tablas
  function extras(c){ const t=cliTxt(c.afiliado), fi=FAI.get(c.afiliado)||{porVencer:0,pv7:0}, p=PRIO.get(c.afiliado);
    return {clientes:t.corto,clientes_full:t.full,dias:c.dias_sin_pago==null?null:c.dias_sin_pago,por_vencer:Math.round(fi.porVencer),por_facturar:Math.round((c.por_liquidar||0)+(c.por_causar||0)),
      prio_txt:prioTexto(c.afiliado),porque:(p?`Analista${p.analista?' '+p.analista:''}: ${p.motivo||''}${p.obs?' — '+p.obs:''}. `:'')+(c.motivo||'')}; }

  // ---------- pintado
  function render(){
    const cand=candidatos({incl:st.incl,focus:st.focus,respetar:st.respetar}), {paid,rest}=asignar(cand,st.B,st.est);
    const rows=cand.map((c,i)=>{ const asig=paid[i];
      return {...c,...extras(c),entra:'Entran al plan',orden:i+1,prior:-i,asig:Math.round(asig),queda:Math.round(c.venc_libre-asig),pct:c.venc_libre>0?asig/c.venc_libre*100:0,dias_cub:asig/c.inc}; });
    const rowsMap=new Map(rows.map(r=>[r.afiliado,r])), M=medir(cand,paid,st.B);
    M.ventaTot=sumBy(act,'venta30');
    cur={cand,rows,rowsMap,rest,M,cs:costos(cand),reach:presupuestoParaLlegar(cand),clientes:porCliente(rowsMap),todos:filasTodos(rowsMap)};
    MOTOR.plan.st=st; MOTOR.plan.cur=cur;
    renderRes(); renderView(); renderAnalisis();
    document.dispatchEvent(new CustomEvent('plan:update'));
  }
  function filasTodos(rowsMap){
    const otros=C.filter(c=>!rowsMap.has(c.afiliado)).sort((a,b)=>b.venc_libre-a.venc_libre).map((c,j)=>{
      const entra=c.lv===4?'Al ritmo (no urgente)':c.lv===5?'Saldo antiguo (sin viajes en 30 d)':c.lv===0?'Sin saldo vencido libre':'Fuera por tu filtro "A quiénes incluir"';
      return {...c,...extras(c),entra,orden:null,prior:-1e6-j,asig:0,queda:Math.round(c.venc_libre),pct:0,dias_cub:0}; });
    return [...rowsMap.values(),...otros];
  }
  function renderRes(){
    const {M,cs,rows}=cur; const B=st.B;
    $('#resEy',el).textContent='Resultado con '+money(B);
    setNum($('#nA',el),M.nPag,FMT.int); $('#nAof',el).textContent=' de '+nf.format(M.N)+' afiliados';
    $('#aSub',el).innerHTML=`prioritarios a los que llegas. Mueven <b>${money(M.ventaPag)}</b> de venta al mes${M.ventaTot?` (${pc(M.ventaPag,M.ventaTot)} de la venta de todos los que cargaron)`:''}.`;
    $('#mA',el).style.width=(M.N?M.nPag/M.N*100:0)+'%';
    setNum($('#nP',el),M.prof,FMT.pct0);
    $('#pSub',el).innerHTML=`Pagas <b>${money(M.asig)}</b> de <b>${money(M.venc)}</b> que se les debe vencido: en promedio ≈ <b>${nf1.format(M.dias)} días</b> de lo que gana cada uno. Quedan debiéndose ${money(M.venc-M.asig)}.`;
    $('#mP',el).style.width=Math.min(100,M.prof)+'%';
    $('#why',el).innerHTML=M.N===0?'Con estos filtros no hay afiliados prioritarios.':M.nPag>=M.N
      ?`<b>¿Por qué el alcance ya no sube?</b> Con este presupuesto ya llegas a los ${nf.format(M.N)} afiliados prioritarios. Más dinero ya no suma afiliados: le paga más a cada uno (profundidad).`
      :`<b>Con este presupuesto llegas a ${nf.format(M.nPag)} de ${nf.format(M.N)}.</b> Más dinero suma afiliados; para llegar a todos hacen falta unos <b>${money(cur.reach)}</b>.`;
    // prioridades de analistas que se estan respetando
    const alta=rows.filter(r=>PRIO.get(r.afiliado)&&PRIO.get(r.afiliado).prioridad===1), req=rows.reduce((s,r)=>s+(r.req||0),0), nop=[...PRIO.values()].filter(p=>p.prioridad===0).length;
    $('#anl',el).innerHTML=st.respetar&&PRIO.size?`<b>Prioridades de analistas:</b> ${nf.format(alta.length)} afiliados en <b>Alta</b> van primero${req>0?` (con ${money(req)} pedidos que se pagan antes que todo)`:''}${nop?`; ${nf.format(nop)} marcados «No pagar por ahora» quedan fuera`:''}. Ver la pestaña «Prioridades de analistas».`:(PRIO.size?'<span style="color:var(--mut)">Las prioridades de los analistas están desactivadas.</span>':'');
    // escalera
    if(st.est==='orden'){ $('#steps',el).innerHTML=''; $('#stepNote',el).innerHTML='Pagando completo por orden de prioridad, el presupuesto alcanza para '+nf.format(M.nPag)+' afiliados (el último puede quedar parcial).'; }
    else{
      let k=0; while(k<5&&B>=cs[k]-1) k++;                              // escalones completos
      const base=k?cs[k-1]:0, frac=k<5?Math.max(0,Math.min(1,(B-base)/Math.max(1,cs[k]-base))):1;
      $('#steps',el).innerHTML=ESC.map((e,i)=>{ const p=i<k?100:i===k?Math.round(frac*100):0, tp=tipA('Escalón '+(i+1)+(e.m===Infinity?' · todo el saldo vencido':' · '+e.t+' de ingreso'),[{l:'Costo acumulado',v:full(cs[i])},{l:'Avance con tu presupuesto',v:p+'%'}]);
        return `<div class="step ${i<k?'done':i===k?'cur':''}" data-tip="${tp}"><div class="bar2"><i style="width:${p}%"></i></div><b>${e.t}</b><small>${money(cs[i])}</small></div>`; }).join('');
      // dentro del escalon en curso se atiende por nivel: se dice cual nivel ya quedo completo, cual va a medias y cual no ha empezado
      const nivelEstado=()=>{ if(k>=5) return ''; const e=ESC[k], prev=k?ESC[k-1]:null;
        const tgt=r=>Math.min(r.venc_libre,e.m===Infinity?r.venc_libre:r.inc*e.m), pre=r=>prev?Math.min(r.venc_libre,prev.m*r.inc):0;
        const partes=[1,2,3,4].map(l=>{ const rs=rows.filter(r=>r.lv===l); if(!rs.length) return null;
          return `${LVNAME[l].toLowerCase()}: <b>${rs.every(r=>r.asig>=tgt(r)-1)?'completo':rs.some(r=>r.asig>pre(r)+1)?'a medias':'aún no'}</b>`; }).filter(Boolean);
        return partes.length>1?` Dentro de ese escalón se atiende por nivel → ${partes.join(' · ')}.`:''; };
      $('#stepNote',el).innerHTML=M.N===0?'':k===0?`Estás en el <b>primer escalón</b> (${ESC[0].t} de ingreso para todos los prioritarios = ${money(cs[0])}): aún no lo completas.`+nivelEstado()
        :k<5?`Completas <b>${ESC[k-1].t}</b> de ingreso para todos los prioritarios y avanzas hacia <b>${ESC[k].t}</b> (${money(cs[k])} en total).`+nivelEstado()
        :`Cubres <b>todo el saldo vencido libre</b> de los prioritarios (${money(cs[4])}). Te sobran ${money(cur.rest)}.`;
    }
    const ex=[...rows].filter(r=>r.lv<=2).sort((a,b)=>b.v15-a.v15||b.venta30-a.venta30)[0]||rows[0];
    $('#ex',el).innerHTML=ex?`<b>Ejemplo con un afiliado real:</b> ${esc(ex.afiliado)} gana ≈ ${money(ex.inc)} al día y se le deben ${money(ex.venc_libre)} vencidos (${nf.format(Math.round(ex.venc_libre/ex.inc))} días de lo que gana). Con este presupuesto le pagas <b>${money(ex.asig)}</b>, es decir ${nf1.format(ex.dias_cub)} días de su ingreso.`:'';
  }
  function porCliente(rowsMap){
    const cl=new Map();
    CC.forEach(r=>{ const a=CM.get(r.afiliado); if(!a) return;
      const sh=shareOf(r.afiliado,r), v=pv(r), pr=rowsMap.get(r.afiliado), x=cl.get(r.cliente)||{cliente:r.cliente,venta:0,debt:0,pay:0,queda:0,nPlan:0,nPag:0,filas:[]};
      x.venta+=v;
      if(pr){ x.debt+=pr.venc_libre*sh; x.pay+=pr.asig*sh; x.queda+=(pr.venc_libre-pr.asig)*sh; x.nPlan++; if(pr.asig>1) x.nPag++; }
      x.filas.push({afiliado:r.afiliado,nivel:a.nivel,motivo:a.motivo,porque:(pr?pr.porque:extras(a).porque),prio_txt:prioTexto(r.afiliado),v,sh:sh*100,viajes:r.viajes,deuda:Math.round(a.venc_libre*sh),pay:Math.round((pr?pr.asig:0)*sh),pct:pr?pr.pct:null,dias_cub:pr?pr.dias_cub:null,pagoTot:pr?pr.asig:0});
      cl.set(r.cliente,x); });
    return [...cl.values()];
  }

  // ---------- vistas: por afiliado / por cliente / por placa / pagado sin rotar
  const ORD={pay:['Pago asignado',x=>x.pay],debt:['Deuda vencida de sus afiliados',x=>x.debt],queda:['Lo que queda debiéndose',x=>x.queda],venta:['Venta (30 d)',x=>x.venta]};
  const VISTAS=['afiliado','cliente','placa','sinrotar'];
  function renderView(){
    $('#vb',el).innerHTML=`<div class="seg" id="vs"></div><div class="grow"></div>${st.view==='cliente'?`<label class="lab" style="display:flex;gap:8px;align-items:center;margin:0">Ordenar clientes por <select id="vo" class="in">${Object.entries(ORD).map(([k,v])=>`<option value="${k}" ${k===st.ord?'selected':''}>${v[0]}</option>`).join('')}</select></label><button class="mini" type="button" id="vx">${st.open.size?'Contraer todo':'Expandir los 8 primeros'}</button>`:''}${st.view==='afiliado'||st.view==='cliente'?'<button class="mini" type="button" id="ve">Descargar plan (CSV)</button>':''}`;
    seg($('#vs',el),['Por afiliado','Por cliente','Por placa','Pagado sin rotar'],i=>{ if(VISTAS[i]!==st.view){ st.view=VISTAS[i]; renderView(); } },VISTAS.indexOf(st.view));
    if(st.view==='cliente') renderClientes(); else if(st.view==='afiliado') renderAfiliados(); else if(st.view==='placa') renderPlacas(); else renderSinRotar();
  }
  function renderAfiliados(){
    const cols=[{k:'orden',l:'#',num:1,nosum:1},{k:'afiliado',l:'Afiliado',render:r=>`<span style="display:inline-block;min-width:190px">${esc(r.afiliado)}</span>`},{k:'nivelTxt',l:'Prioridad',nosum:1,render:r=>lvPill(r.nivel)},
      {k:'prio_txt',l:'Analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">—</span>'},
      {k:'clientes',l:'Clientes que mueve (30 d)',nosum:1,render:r=>`<span title="${esc(r.clientes_full)}">${esc(r.clientes)}</span>`},
      {k:'venta30',l:'Venta que mueve (30 d)',money:1},{k:'v15',l:'Viajes 15 d',num:1},{k:'venc_libre',l:'Se le debe vencido',money:1},
      {k:'asig',l:'PAGAR AHORA',money:1,render:r=>r.asig>0?`<span class="pay" title="${full(r.asig)}">${money(r.asig)}</span>`:'<span style="color:var(--mut)">—</span>'},
      {k:'pct',l:'% de su deuda',nosum:1,render:r=>meterCell(r.pct,LVTONE[r.lv])},
      {k:'dias_cub',l:'Días de su ingreso',nosum:1,render:r=>r.dias_cub>0?nf1.format(r.dias_cub)+' d':'<span style="color:var(--mut)">—</span>'},
      {k:'queda',l:'Queda debiéndose',money:1},{k:'por_vencer',l:'Por vencer (15 d)',money:1},{k:'por_facturar',l:'Viajes por facturar',money:1},
      {k:'dias',l:'Días desde su último pago',nosum:1,num:1},{k:'porque',l:'Por qué',nosum:1,acc:1}];
    $('#out',el).innerHTML='<div id="ta"></div>';
    table($('#ta',el),cur.todos,cols,{sort:'prior',filterKey:'entra',filterLabel:'Todos los afiliados',filterInit:'Entran al plan'});
  }
  function renderClientes(){
    const f=ORD[st.ord][1], list=[...cur.clientes].sort((a,b)=>f(b)-f(a)), maxDebt=Math.max(1,...list.map(x=>x.debt));
    const T=list.reduce((s,x)=>({venta:s.venta+x.venta,debt:s.debt+x.debt,pay:s.pay+x.pay,queda:s.queda+x.queda}),{venta:0,debt:0,pay:0,queda:0});
    const barra=(x,w)=>`<div style="width:${w}%">${stackBar([{v:x.pay,color:'var(--s1)',tip:tipA(x.cliente,[{k:'var(--s1)',l:'Pagas',v:full(x.pay)},{l:'De su deuda vencida',v:pc(x.pay,x.debt)}])},{v:x.queda,color:'var(--s2)',tip:tipA(x.cliente,[{k:'var(--s2)',l:'Queda debiéndose',v:full(x.queda)}])}])}</div>`;
    const head=x=>{ const open=st.open.has(x.cliente), foc=st.focus.has(x.cliente);
      return `<div class="crow ${open?'open':''}" data-c="${esc(x.cliente)}"><button class="chead" type="button" aria-expanded="${open}"><span class="chev">▶</span>
        <span class="cname"><span class="t" title="${esc(x.cliente)}">${esc(x.cliente)}</span>${foc?'<span class="focus-tag">protegido</span>':''}</span>
        <span class="num">${money(x.venta)}<small>venta 30 d</small></span>
        <span class="cbar">${x.debt>0?barra(x,Math.max(4,x.debt/maxDebt*100)):''}<small>${x.debt>0?`${money(x.pay)} pagas · ${money(x.queda)} queda`:'sin deuda vencida de afiliados prioritarios'}</small></span>
        <span class="num cpct">${x.debt>0?nf.format(Math.round(x.pay/x.debt*100))+'%':'—'}<small>pagado</small></span>
        <span class="num pay cpay">${money(x.pay)}<small>de ${money(x.debt)} vencido</small></span>
        <span class="num caf">${nf.format(x.filas.length)}<small>${nf.format(x.nPag)} pagados</small></span></button><div class="cbody" ${open?'':'hidden'}></div></div>`; };
    $('#out',el).innerHTML=`<div class="legend" style="margin:0 0 10px"><span><i style="background:var(--s1)"></i>Lo que pagas</span><span><i style="background:var(--s2)"></i>Lo que queda debiéndose</span><span style="color:var(--mut)">El largo de la barra es la deuda vencida de los afiliados prioritarios de ese cliente</span></div>
      <div class="clist"><div class="clh"><span></span><span>Cliente</span><span style="text-align:right">Venta 30 d</span><span>Deuda vencida de sus afiliados</span><span style="text-align:right">% pagado</span><span style="text-align:right">Pago asignado</span><span style="text-align:right">Afiliados</span></div>
      ${list.map(head).join('')}
      <div class="chead" style="cursor:default;font-weight:700;background:var(--card2);border-bottom:0"><span></span><span>Total · ${nf.format(list.length)} clientes</span><span class="num">${money(T.venta)}</span><span class="cbar"><small>${money(T.pay)} pagas · ${money(T.queda)} queda</small></span><span class="num">${T.debt>0?nf.format(Math.round(T.pay/T.debt*100))+'%':'—'}</span><span class="num pay">${money(T.pay)}</span><span class="num">${nf.format(cur.rows.length)}</span></div></div>
      <p class="note" style="margin-top:10px">Un afiliado que mueve varios clientes se reparte entre ellos según su venta de 30 días con cada uno; por eso el “pago asignado” de todos los clientes suma lo que pagas (${money(cur.M.asig)}). Haz clic en un cliente para ver quiénes son.</p>`;
    $$('.crow.open',el).forEach(r=>llenarCliente(r));
  }
  function llenarCliente(row){
    const x=cur.clientes.find(c=>c.cliente===row.dataset.c); if(!x) return; const body=$('.cbody',row);
    const cols=[{k:'afiliado',l:'Afiliado'},{k:'nivel',l:'Prioridad',nosum:1,render:r=>lvPill(r.nivel)},{k:'prio_txt',l:'Analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">—</span>'},
      {k:'v',l:'Venta con este cliente (30 d)',money:1},{k:'sh',l:'% de su carga',pct:1,nosum:1},{k:'viajes',l:'Viajes',num:1},
      {k:'deuda',l:'Deuda vencida (atribuida)',money:1},{k:'pay',l:'Pagas (atribuido)',money:1,render:r=>r.pay>0?`<span class="pay">${money(r.pay)}</span>`:'<span style="color:var(--mut)">—</span>'},
      {k:'pagoTot',l:'Pago total al afiliado',money:1},{k:'pct',l:'% de su deuda',nosum:1,render:r=>r.pct==null?'<span style="color:var(--mut)">no entra al plan</span>':meterCell(r.pct,LVTONE[lvOf(r.nivel)])},{k:'porque',l:'Por qué',nosum:1,acc:1}];
    body.innerHTML='<div class="tbl"></div>'; table($('.tbl',body),x.filas,cols,{sort:'pay'});
  }
  function renderPlacas(){
    const P=D.placas.map(p=>{ const c=CMN.get(normN(p.afiliado)), r=c&&cur.rowsMap.get(c.afiliado); return {...p,nivel:c?c.nivel:'0-SIN SALDO',nivelTxt:c?c.nivelTxt:lvTxt(0),motivo:c?c.motivo:'',pagoAf:r?r.asig:0}; });
    const cols=[{k:'nivelTxt',l:'Prioridad',render:r=>lvPill(r.nivel)},{k:'placa',l:'Placa'},{k:'afiliado',l:'Afiliado'},{k:'ops',l:'Operación'},{k:'v15',l:'Viajes 15 d',num:1},{k:'dias_sin_viaje',l:'Días sin viaje',num:1,nosum:1},
      {k:'viajes_mes',l:'Viajes mes',num:1},{k:'utilidad_mes',l:'Utilidad mes',money:1},{k:'pagado_mes',l:'Pagado mes',money:1},{k:'exigible',l:'Saldo libre de la placa',money:1},{k:'pagoAf',l:'Pagas al afiliado (todas sus placas)',money:1},{k:'motivo',l:'Por qué (del afiliado)',acc:1,nosum:1}];
    $('#out',el).innerHTML='<div id="ta"></div>'; table($('#ta',el),P,cols,{sort:'exigible',filterKey:'nivelTxt',filterLabel:'Todas las prioridades',filterInit:lvTxt(1)});
  }
  function renderSinRotar(){
    const cols=[{k:'placa',l:'Placa'},{k:'afiliado',l:'Afiliado'},{k:'dias_sin_viaje',l:'Días sin viaje',num:1,nosum:1},{k:'ultimo_viaje',l:'Último viaje',date:1},{k:'ultimo_pago',l:'Último pago',date:1},
      {k:'ant_mes',l:'Anticipos mes',money:1},{k:'saldo_mes',l:'Saldos mes',money:1},{k:'pagado_mes',l:'Total pagado',money:1},{k:'exigible',l:'Saldo libre',money:1}];
    $('#out',el).innerHTML=`<div class="brief" style="margin-bottom:12px">${ico('info')}<p><b>Pagado sin rotar</b>: placas a las que se les pagó en el mes y llevan ${D.meta.dias_sin_rotar}+ días sin cargar. No conviene pagarles más hasta que vuelvan a cargar.</p></div><div id="ta"></div>`;
    table($('#ta',el),D.placas.filter(p=>p.pagado_sin_rotar),cols,{sort:'pagado_mes'});
  }

  // ---------- analisis: lectura, niveles, curva
  function renderAnalisis(){
    const {M,cs,rows,clientes}=cur;
    const b=[], top=[...clientes].filter(x=>x.queda>0).sort((a,b2)=>b2.queda-a.queda)[0], btn=v=>`<button class="mini" type="button" data-p="${Math.ceil(v/1e6)}">Usar ${money(v)}</button>`;
    b.push(`Con <b>${money(st.B)}</b> pagas a <b>${nf.format(M.nPag)} de ${nf.format(M.N)}</b> afiliados prioritarios y cubres el <b>${nf.format(Math.round(M.prof))}%</b> de lo que se les debe vencido.`+(M.nPag>=M.N?' Ya llegas a todos: más presupuesto le paga más a cada uno.':` Para llegar a todos hacen falta unos <b>${money(cur.reach)}</b> ${btn(cur.reach)}`));
    if(top) b.push(`Cliente al que más le quedas debiendo (por sus afiliados prioritarios): <b>${esc(top.cliente)}</b> — ${money(top.queda)} (${pc(top.queda,top.debt)} de su deuda).`+(st.focus.has(top.cliente)?'':' Márcalo en “Proteger primero” para pagarle antes a esos afiliados.'));
    if(st.est==='amplia') b.push(`Referencias: <b>1 semana</b> de ingreso a todos = ${money(cs[1])} ${btn(cs[1])} · <b>2 semanas</b> = ${money(cs[2])} ${btn(cs[2])} · <b>todo el saldo</b> = ${money(cs[4])} ${btn(cs[4])}`);
    const pf=sumBy(rows,'por_facturar'), pvv=sumBy(rows,'por_vencer');
    if(pf+pvv>0) b.push(`Además de lo vencido, a estos mismos afiliados se les viene: <b>${money(pvv)}</b> en facturas que vencen en los próximos 15 días y <b>${money(pf)}</b> en viajes terminados o en ruta sin factura. Mira la pestaña «Flujo de caja» para verlo semana a semana.`);
    $('#ins',el).innerHTML='<h2>Lectura del plan</h2><ul>'+b.map(x=>'<li><span>'+x+'</span></li>').join('')+'</ul>';
    // niveles: a donde va el dinero
    const lvs=[1,2,3,4].map(l=>{ const rs=rows.filter(r=>r.lv===l), venc=sumBy(rs,'venc_libre'), asig=sumBy(rs,'asig'); return {l,n:rs.length,pag:rs.filter(r=>r.asig>1).length,venc,asig,pct:venc>0?asig/venc*100:0}; }).filter(x=>x.n>0);
    const items=[...lvs.map(x=>({v:x.asig,color:LVTONE[x.l],tip:tipA(LVNAME[x.l],[{l:'Pagas',v:full(x.asig)},{l:'Afiliados pagados',v:x.pag+' de '+x.n},{l:'De su deuda vencida',v:pc(x.asig,x.venc)}])})),
      {v:cur.rest,color:'color-mix(in srgb,var(--ink) 20%,transparent)',tip:tipA('Sobrante',[{l:'Sin asignar',v:full(cur.rest)}])}];
    const a=`<div class="card"><h2>¿A dónde va el dinero?</h2><p class="note">${money(st.B)} repartidos por nivel de prioridad</p>
      <div style="margin:16px 0 4px">${stackBar(items,{thick:true})}</div>
      <div class="lvl">${lvs.map(x=>`<div>${lvPill(x.l)} ${qm(LVNAME[x.l],REGLA[x.l])}</div><div class="cell-meter" style="--tone:${LVTONE[x.l]}"><div class="meter"><i style="width:${x.pct}%"></i></div><span>${nf.format(Math.round(x.pct))}%</span></div>
        <div style="text-align:right"><b>${money(x.asig)}</b> <span style="color:var(--mut)">de ${money(x.venc)} · ${x.pag}/${x.n} afiliados</span></div>`).join('')}
        <div><span class="pill" style="--tone:var(--mut)">Sobrante</span></div><div></div><div style="text-align:right"><b>${money(cur.rest)}</b></div></div>
      <p class="note" style="margin-top:12px">La barra de cada nivel es el porcentaje de su deuda vencida que pagas.</p></div>`;
    // curva: que cambia al subir el presupuesto (alcance y profundidad)
    const xmax=Math.max(cs[4]*1.02,st.B*1.08,20e6), NP=44, pts=[];
    for(let i=0;i<=NP;i++){ const Bx=xmax*i/NP, r=asignar(cur.cand,Bx,st.est), m=medir(cur.cand,r.paid,Bx); pts.push({x:Bx,a:m.N?m.nPag/m.N*100:0,p:m.prof,n:m.nPag,d:m.dias}); }
    $('#viz',el).innerHTML=a+`<div class="card" id="cvCard"><h2>¿Qué cambia al subir el presupuesto?</h2><p class="note">Primero sube el <b>alcance</b> (a cuántos llegas); cuando ya llegas a todos, sube la <b>profundidad</b> (cuánto les pagas)</p>${curveSVG(pts,xmax,{x:st.B,a:M.N?M.nPag/M.N*100:0,p:M.prof})}</div>`;
    bindCurve($('#cvCard svg',el),pts,xmax,M.N);
  }
  const CV={W:620,H:270,pl:44,pr:16,pt:30,pb:32};
  function curveSVG(pts,xmax,cu){
    const {W,H,pl,pr,pt,pb}=CV, X=v=>pl+(W-pl-pr)*v/xmax, Y=v=>pt+(H-pt-pb)*(1-v/100); let g='';
    for(let i=0;i<=4;i++){ const v=i*25, y=Y(v); g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pl-8}" y="${y+3.5}" text-anchor="end">${v}%</text>`; }
    for(let i=0;i<=4;i++){ const v=xmax*i/4; g+=`<text x="${X(v)}" y="${H-10}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${i?money(v):'$0'}</text>`; }
    if(st.est==='amplia'){ let lastX=-99; cur.cs.slice(0,4).forEach((c,i)=>{ const x=X(c); if(c<xmax&&x-lastX>40){ g+=`<line x1="${x}" x2="${x}" y1="${pt}" y2="${Y(0)}" stroke="var(--line2)"/><text x="${x}" y="${pt-8}" text-anchor="middle" style="font-size:9.5px">${ESC[i].t}</text>`; lastX=x; } }); }
    const path=k=>'M'+pts.map(p=>X(p.x).toFixed(1)+','+Y(p[k]).toFixed(1)).join('L');
    g+=`<path d="${path('a')}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="${path('p')}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const i0=pts.findIndex(p=>p.a>=99.9), pa=pts[i0>0?i0:Math.floor(pts.length/4)], pp=pts[Math.floor(pts.length*.62)];
    g+=`<text x="${X(pa.x)+8}" y="${Y(pa.a)+16}" style="fill:var(--ink);font-weight:650">Alcance</text><text x="${X(pp.x)+8}" y="${Y(pp.p)+16}" style="fill:var(--ink);font-weight:650">Profundidad</text>`;
    g+=`<line x1="${X(cu.x)}" x2="${X(cu.x)}" y1="${pt}" y2="${Y(0)}" stroke="var(--accent)" stroke-opacity=".6"/><circle cx="${X(cu.x)}" cy="${Y(cu.a)}" r="5" fill="var(--s1)" stroke="var(--card)" stroke-width="2"/><circle cx="${X(cu.x)}" cy="${Y(cu.p)}" r="5" fill="var(--s2)" stroke="var(--card)" stroke-width="2"/>`;
    g+=`<line class="xh" y1="${pt}" y2="${Y(0)}" stroke="var(--ink)" stroke-opacity=".35" visibility="hidden"/><circle class="xa" r="5" fill="var(--s1)" stroke="var(--card)" stroke-width="2" visibility="hidden"/><circle class="xp" r="5" fill="var(--s2)" stroke="var(--card)" stroke-width="2" visibility="hidden"/><rect class="ov" x="${pl}" y="${pt}" width="${W-pl-pr}" height="${H-pt-pb}" fill="transparent" style="cursor:crosshair"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Alcance y profundidad según el presupuesto">${g}</svg>
      <div class="legend"><span><i style="background:var(--s1)"></i>Alcance: afiliados a los que llegas</span><span><i style="background:var(--s2)"></i>Profundidad: % de lo vencido que pagas</span><span><i style="background:var(--accent)"></i>Tu presupuesto (${money(cu.x)})</span></div>`;
  }
  function bindCurve(svg,pts,xmax,N){
    if(!svg) return; const {W,pl,pr,pt,H,pb}=CV, X=v=>pl+(W-pl-pr)*v/xmax, Y=v=>pt+(H-pt-pb)*(1-v/100);
    const ov=svg.querySelector('.ov'), xh=svg.querySelector('.xh'), xa=svg.querySelector('.xa'), xp=svg.querySelector('.xp');
    ov.addEventListener('pointermove',ev=>{ const r=svg.getBoundingClientRect(), px=(ev.clientX-r.left)/r.width*W, xv=(px-pl)/(W-pl-pr)*xmax;
      let b=0,bd=Infinity; pts.forEach((p,i)=>{ const d=Math.abs(p.x-xv); if(d<bd){bd=d;b=i;} }); const p=pts[b];
      xh.setAttribute('x1',X(p.x)); xh.setAttribute('x2',X(p.x)); xh.setAttribute('visibility','visible');
      xa.setAttribute('cx',X(p.x)); xa.setAttribute('cy',Y(p.a)); xa.setAttribute('visibility','visible'); xp.setAttribute('cx',X(p.x)); xp.setAttribute('cy',Y(p.p)); xp.setAttribute('visibility','visible');
      tipShow(tipH('Presupuesto '+money(p.x),[{k:'var(--s1)',l:'Alcance',v:nf.format(p.n)+' de '+nf.format(N)+' afiliados'},{k:'var(--s2)',l:'Profundidad',v:nf.format(Math.round(p.p))+'% de lo vencido'},{l:'Equivale a',v:nf1.format(p.d)+' días de su ingreso'}]),ev.clientX,ev.clientY); ev.stopPropagation(); });
    ov.addEventListener('pointerleave',()=>{ [xh,xa,xp].forEach(n=>n.setAttribute('visibility','hidden')); TIP.classList.remove('on'); });
  }

  // ---------- eventos
  el.addEventListener('click',e=>{
    const p=e.target.closest('[data-p]'); if(p){ $('#bp',el).value=p.dataset.p; st.B=+p.dataset.p*1e6; render(); return; }
    const ch=e.target.closest('#bf [data-c]'); if(ch){ const c=ch.dataset.c; if(!c) st.focus.clear(); else if(st.focus.has(c)) st.focus.delete(c); else st.focus.add(c); drawChips(); render(); return; }
    const hd=e.target.closest('.chead[aria-expanded]'); if(hd){ const row=hd.closest('.crow'), c=row.dataset.c, abre=!st.open.has(c); if(abre) st.open.add(c); else st.open.delete(c);
      row.classList.toggle('open',abre); hd.setAttribute('aria-expanded',abre); $('.cbody',row).hidden=!abre; if(abre) llenarCliente(row); return; }
    if(e.target.closest('#vx')){ if(st.open.size) st.open.clear(); else [...cur.clientes].sort((a,b)=>ORD[st.ord][1](b)-ORD[st.ord][1](a)).slice(0,8).forEach(x=>st.open.add(x.cliente)); renderClientes(); $('#vx',el).textContent=st.open.size?'Contraer todo':'Expandir los 8 primeros'; return; }
    if(e.target.closest('#ve')) exportar();
  });
  el.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&e.target.matches('#bf [data-c]')){ e.preventDefault(); e.target.click(); } });
  $('#bp',el).addEventListener('input',e=>{ st.B=Math.max(0,(+e.target.value||0))*1e6; render(); });
  $('#be',el).onchange=e=>{ st.est=e.target.value; render(); };
  $('#bn',el).onchange=e=>{ st.incl=+e.target.value; render(); };
  $('#br',el).onchange=e=>{ st.respetar=e.target.checked; render(); };
  el.addEventListener('change',e=>{ if(e.target.id==='vo'){ st.ord=e.target.value; renderClientes(); } });
  function exportar(){
    const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"', H=['Orden','Afiliado','Prioridad del sistema','Prioridad del analista','Se le debe vencido (libre)','Pagar ahora','% de su deuda','Días de su ingreso','Queda debiéndose','Por vencer (15 d)','Viajes por facturar','Clientes que mueve'];
    const L=cur.rows.map(r=>[r.orden,q(r.afiliado),q(lvTxt(r.nivel)),q((PRIO.get(r.afiliado)?MOTOR.PRIO_TXT[PRIO.get(r.afiliado).prioridad]:'')),Math.round(r.venc_libre),r.asig,Math.round(r.pct),nf1.format(r.dias_cub).replace('.',','),r.queda,r.por_vencer,r.por_facturar,q(r.clientes_full)].join(';'));
    const blob=new Blob(['﻿'+[H.join(';'),...L].join('\r\n')],{type:'text/csv;charset=utf-8'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='a_quien_pagar_primero_'+(D.meta.hoy||'').split('/').reverse().join('-')+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  render();
})();
