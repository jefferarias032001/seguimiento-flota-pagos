// ============================================================================
// AJOVER Y NOUVELLE por operacion (segmentacion del query ESTADO AJOVER):
//   TRANSFERENCIAS, GRANELES, ENTREGA A CLIENTES y otras (zorros y fijos Cali, fijos Medellin, sencillos Madrid, transferencias Cali y Alamo).
// Para cada operacion: viajes, venta, margen, quienes la mueven, cuanto se les debe vencido, lo que va a pasar a vencido y a quien pagar primero.
// La deuda de cada afiliado se reparte entre las operaciones segun lo que cargo en los ultimos 30 dias.
// ============================================================================
(function(){
  const el=$('#s-ajover'); if(!el) return;
  const {CM,CMN,FAI,prioPill,prioTexto,HOY,fmtD}=MOTOR;
  const M=D.flota_manif||[];
  if(!M.length){ el.innerHTML=intro('Esta actualización no trae viajes de Ajover y Nouvelle.'); return; }
  M.forEach(r=>{ r._t=new Date(r.fecha+'T12:00:00').getTime(); r.afc=(CMN.get(normN(r.afiliado))||{}).afiliado||r.afiliado; });
  const MAIN=['TRANSFERENCIAS','GRANELES','ENTREGA A CLIENTES'], GR=[...MAIN,'OTRAS'], grupo=s=>MAIN.includes(s)?s:'OTRAS';
  const COL={'TRANSFERENCIAS':'var(--s1)','GRANELES':'var(--s2)','ENTREGA A CLIENTES':'var(--s3)','OTRAS':'var(--s4)'};
  const NOM={'TRANSFERENCIAS':'Transferencias','GRANELES':'Graneles','ENTREGA A CLIENTES':'Entrega a clientes','OTRAS':'Otras operaciones'};
  const DESC={'TRANSFERENCIAS':'Cartagena ↔ Madrid en patineta y sencillo','GRANELES':'Tractomula Cartagena → Madrid y Bogotá','ENTREGA A CLIENTES':'Distribución a clientes (resto de rutas)','OTRAS':'Zorros y fijos Cali, fijos Medellín, sencillos Madrid, transferencias Cali y Álamo'};
  const T30=HOY.getTime()-29*864e5, T7=HOY.getTime()-6*864e5;
  const meses=[...new Set(M.map(r=>r.fecha.slice(0,7)))].sort().reverse();
  const ml=m=>{ const s=new Date(m+'-15').toLocaleDateString('es-CO',{month:'long',year:'numeric'}); return s.charAt(0).toUpperCase()+s.slice(1); };
  const st={cli:'',per:'30',seg:'',otra:'',vista:'pagar'};

  el.innerHTML=intro('Los viajes de <b>Ajover</b> y <b>Nouvelle</b> separados por la operación que se les dio según su ruta y tipología (misma regla del query ESTADO AJOVER): <b>transferencias</b>, <b>graneles</b>, <b>entrega a clientes</b> y otras. Elige una operación para ver quiénes la mueven, cuánto se les debe, cuánto va a pasar a vencido y a quién pagar primero. La deuda de cada afiliado se reparte entre las operaciones según lo que cargó en los últimos 30 días.')
   +`<div class="tools"><select id="ac" aria-label="Cliente"><option value="">Ajover y Nouvelle</option><option value="AJOVER">Solo Ajover</option><option value="NOUVELLE">Solo Nouvelle</option></select>
      <select id="ap" aria-label="Período"><option value="30">Últimos 30 días</option>${meses.map(m=>`<option value="${m}">${ml(m)}</option>`).join('')}</select></div>
     <div class="segs" id="acards"></div><div class="fchips" id="aotras" style="margin:10px 0 0"></div>
     <div class="grid two" id="achart" style="margin:16px 0"></div>
     <div class="card hdr" id="ahead" style="--tone:var(--accent);margin-bottom:12px"></div>
     <div class="grid kpis" id="akp"></div><div id="avs" style="margin:6px 0 12px"></div><div id="aout"></div>`;

  // ---------- calculos
  const base=()=>M.filter(r=>(!st.cli||r.cliente_op===st.cli)&&(st.per==='30'?r._t>=T30:r.fecha.slice(0,7)===st.per));
  const enSeg=r=>!st.seg||(st.seg==='OTRAS'?(grupo(r.seg)==='OTRAS'&&(!st.otra||r.seg===st.otra)):r.seg===st.seg);
  const stats=rows=>{ const ter=rows.filter(r=>!r.propia_i), s={viajes:rows.length,propios:rows.length-ter.length,placas:new Set(rows.map(r=>r.placa)).size,afiliados:new Set(ter.map(r=>r.afc)).size,
      venta:sumBy(rows,'venta'),compra:sumBy(rows,'compra'),compraT:sumBy(ter,'compra'),ant:sumBy(ter,'ant'),pagado:sumBy(ter,'pagado')};
    s.util=s.venta-s.compra; s.margen=s.venta>0?s.util/s.venta*100:null; s.pant=s.compraT>0?s.ant/s.compraT*100:null; s.ppag=s.compraT>0?s.pagado/s.compraT*100:null; return s; };
  // compra de los ultimos 30 dias por afiliado dentro de una seleccion (sirve para repartir su deuda entre operaciones)
  const c30=pred=>{ const m=new Map(); M.forEach(r=>{ if(r.propia_i||r._t<T30||!pred(r)) return; m.set(r.afc,(m.get(r.afc)||0)+(r.compra||0)); }); return m; };
  const totAN=c30(()=>true);
  const shareSel=(a,m)=>{ const v=m.get(a)||0, c=CM.get(a), den=Math.max(c?(c.compra30||0):0,totAN.get(a)||0); return den>0?Math.min(1,v/den):0; };
  const planMap=()=>MOTOR.plan.cur&&MOTOR.plan.cur.rowsMap;
  function atribuido(m){ let deuda=0,porv=0,porfac=0,pay=0; const pl=planMap();
    m.forEach((v,a)=>{ const c=CM.get(a); if(!c) return; const s=shareSel(a,m), fi=FAI.get(a)||{}, pr=pl&&pl.get(a);
      deuda+=(c.venc_libre||0)*s; porv+=(fi.porVencer||0)*s; porfac+=((c.por_liquidar||0)+(c.por_causar||0))*s; if(pr) pay+=pr.asig*s; });
    return {deuda,porv,porfac,pay}; }
  const predCli=r=>!st.cli||r.cliente_op===st.cli;

  // ---------- tarjetas por operacion
  function tarjetas(){
    const b=base(), todas=stats(b), aT=atribuido(c30(predCli));
    const tj=(g,s,a)=>`<button type="button" class="segcard ${(g===''&&!st.seg)||g===st.seg?'on':''}" data-g="${g}" style="--tone:${g?COL[g]:'var(--accent)'}"><div class="sch"><i></i><b>${g?NOM[g]:'Todas las operaciones'}</b></div><small>${g?DESC[g]:'Ajover y Nouvelle'}</small>
      <div class="scv">${nf.format(s.viajes)} <span>viajes · ${nf.format(s.placas)} placas · ${nf.format(s.afiliados)} afiliados</span></div>
      <div class="scr"><span>Venta</span><b>${money(s.venta)}</b></div><div class="scr"><span>Margen</span><b>${s.margen==null?'—':nf1.format(s.margen)+'%'}</b></div>
      <div class="scr"><span>Se les debe vencido</span><b>${money(a.deuda)}</b></div><div class="scr"><span>Por vencer + por facturar</span><b>${money(a.porv+a.porfac)}</b></div><div class="scr"><span>Pagas (plan)</span><b>${money(a.pay)}</b></div></button>`;
    $('#acards',el).innerHTML=tj('',todas,aT)+GR.map(g=>tj(g,stats(b.filter(r=>grupo(r.seg)===g)),atribuido(c30(r=>predCli(r)&&grupo(r.seg)===g)))).join('');
    const otras=[...new Set(b.filter(r=>grupo(r.seg)==='OTRAS').map(r=>r.seg))].sort();
    $('#aotras',el).innerHTML=st.seg==='OTRAS'&&otras.length?`<span class="lab" style="align-self:center">Detalle de otras operaciones:</span><span class="pchip ${st.otra?'':'on'}" data-o="">Todas</span>`+otras.map(o=>`<span class="pchip ${st.otra===o?'on':''}" data-o="${esc(o)}">${esc(o)}</span>`).join(''):'';
  }

  // ---------- graficos: compra y viajes por semana y operacion
  function semanas(){
    const mon=t=>{ const d=new Date(t), k=(d.getDay()+6)%7; return new Date(d.getFullYear(),d.getMonth(),d.getDate()-k).getTime(); }, m0=mon(HOY.getTime()), ws=[...Array(8)].map((_,i)=>m0-(7-i)*7*864e5);
    const cols=ws.map((t,i)=>({t,label:fmtD(new Date(t)),sub:i===7?'(parcial)':'',v:{},n:{}}));
    cols.forEach(c=>GR.forEach(g=>{ c.v[g]=0; c.n[g]=0; }));
    M.forEach(r=>{ if(!predCli(r)) return; const i=ws.indexOf(mon(r._t)); if(i<0) return; const g=grupo(r.seg); cols[i].v[g]+=r.compra||0; cols[i].n[g]++; });
    const S=GR.map(g=>({k:g,label:NOM[g],color:COL[g]}));
    const tab=(key,fmt)=>`<div class="tw" style="max-height:300px"><table><thead><tr><th>Semana del</th>${GR.map(g=>`<th class="num">${NOM[g]}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${cols.map(c=>`<tr><td>${c.label}</td>${GR.map(g=>`<td class="num">${fmt(c[key][g])}</td>`).join('')}<td class="num"><b>${fmt(GR.reduce((s,g)=>s+c[key][g],0))}</b></td></tr>`).join('')}</tbody></table></div>`;
    $('#achart',el).innerHTML=figCard({title:'Compra por semana y operación',sub:'Lo que se genera de pago a afiliados y flota propia, por operación',chart:stackCols(cols.map(c=>({label:c.label,sub:c.sub,v:c.v})),S,{W:660,H:260}),table:tab('v',v=>full(v))})
      +figCard({title:'Viajes por semana y operación',sub:'Ritmo de la operación: cuántos viajes se crean cada semana',chart:stackCols(cols.map(c=>({label:c.label,sub:c.sub,v:c.n})),S,{W:660,H:260,fm:v=>nf.format(v),fv:v=>nf.format(v)}),table:tab('n',v=>nf.format(v))});
  }

  // ---------- seleccion actual
  function render(){
    tarjetas();
    const rows=base().filter(enSeg), s=stats(rows), m30=c30(r=>predCli(r)&&enSeg(r)), a=atribuido(m30);
    const nom=st.seg?(st.seg==='OTRAS'&&st.otra?st.otra:NOM[st.seg]):'Todas las operaciones';
    $('#ahead',el).innerHTML=`<div class="rowh"><h2>${esc(nom)}</h2><span class="pill" style="--tone:${st.seg?COL[st.seg]:'var(--accent)'}">${st.cli?(st.cli==='AJOVER'?'Ajover':'Nouvelle'):'Ajover y Nouvelle'}</span><span class="note" style="margin:0">${st.per==='30'?'Últimos 30 días':ml(st.per)}</span></div>`;
    $('#akp',el).innerHTML=kpi('Viajes',nf.format(s.viajes),`${nf.format(s.placas)} placas · ${nf.format(s.afiliados)} afiliados${s.propios?` · ${nf.format(s.propios)} de flota propia`:''}`,'acc')
      +kpi('Venta (a facturar)',money(s.venta),`Compra ${money(s.compra)} · utilidad ${money(s.util)}`,'acc')
      +kpi('Margen',s.margen==null?'—':nf1.format(s.margen)+'%',`Anticipo ${s.pant==null?'—':nf1.format(s.pant)+'%'} de lo que se les paga · pagado ${s.ppag==null?'—':nf1.format(s.ppag)+'%'}`,s.margen!=null&&s.margen<10?'warn':'good')
      +kpi('Se les debe vencido',money(a.deuda),`de los afiliados de esta operación (parte de su deuda, últimos 30 d)`,'bad')
      +kpi('Va a pasar a vencido',money(a.porv+a.porfac),`Por vencer ${money(a.porv)} · viajes por facturar ${money(a.porfac)}`,'serious')
      +kpi('Pagas con tu presupuesto',money(a.pay),'según «A quién pagar primero»','acc');
    vistas(rows,m30);
  }
  function vistas(rows,m30){
    $('#avs',el).innerHTML='<div class="seg" id="avsg"></div>';
    const V=['pagar','placas','manif'];
    seg($('#avsg',el),['A quién pagar','Placas y rotación','Manifiestos'],i=>{ if(V[i]!==st.vista){ st.vista=V[i]; vistas(rows,m30); } },V.indexOf(st.vista));
    if(st.vista==='pagar') vistaPagar(rows,m30); else if(st.vista==='placas') vistaPlacas(rows); else vistaManif(rows);
  }
  function vistaPagar(rows,m30){
    const pl=planMap(), byA=new Map();
    rows.filter(r=>!r.propia_i).forEach(r=>{ const o=byA.get(r.afc)||{afiliado:r.afc,viajes:0,placas:new Set(),compra:0,pagado:0,segs:{}}; o.viajes++; o.placas.add(r.placa); o.compra+=r.compra||0; o.pagado+=r.pagado||0; o.segs[r.seg]=(o.segs[r.seg]||0)+1; byA.set(r.afc,o); });
    m30.forEach((v,a)=>{ if(!byA.has(a)) byA.set(a,{afiliado:a,viajes:0,placas:new Set(),compra:0,pagado:0,segs:{}}); });
    const dat=[...byA.values()].map(o=>{ const c=CM.get(o.afiliado)||{}, s=shareSel(o.afiliado,m30), fi=FAI.get(o.afiliado)||{}, pr=pl&&pl.get(o.afiliado), top=Object.entries(o.segs).sort((a,b)=>b[1]-a[1])[0];
      return {afiliado:o.afiliado,nivel:c.nivel||'0-SIN SALDO',prio_txt:prioTexto(o.afiliado),opp:top?top[0]:'',placas:o.placas.size,viajes:o.viajes,compra:o.compra,ppag:o.compra>0?o.pagado/o.compra*100:null,
        deuda:Math.round((c.venc_libre||0)*s),deudaTot:Math.round(c.venc_libre||0),porv:Math.round((fi.porVencer||0)*s),porfac:Math.round(((c.por_liquidar||0)+(c.por_causar||0))*s),pay:Math.round((pr?pr.asig:0)*s),porque:(pr?pr.porque:(c.motivo||''))}; });
    $('#aout',el).innerHTML='<div id="at"></div>';
    table($('#at',el),dat,[{k:'afiliado',l:'Afiliado',render:r=>`<span style="display:inline-block;min-width:190px">${esc(r.afiliado)}</span>`},{k:'nivel',l:'Prioridad',nosum:1,render:r=>lvPill(r.nivel)},{k:'prio_txt',l:'Analista',nosum:1,render:r=>prioPill(r.afiliado)||'<span style="color:var(--mut)">—</span>'},
      {k:'opp',l:'Operación principal',nosum:1},{k:'placas',l:'Placas',num:1},{k:'viajes',l:'Viajes',num:1},{k:'compra',l:'Compra (período)',money:1},{k:'ppag',l:'% pagado',pct:1,nosum:1},
      {k:'deuda',l:'Se le debe vencido (de esta operación)',money:1},{k:'deudaTot',l:'Se le debe vencido (total, todas sus operaciones)',money:1},{k:'porv',l:'Por vencer (15 d)',money:1},{k:'porfac',l:'Viajes por facturar',money:1},
      {k:'pay',l:'Pagas (plan)',money:1,render:r=>r.pay>0?`<span class="pay">${money(r.pay)}</span>`:'<span style="color:var(--mut)">—</span>'},{k:'porque',l:'Por qué',nosum:1,acc:1}],{sort:'pay'});
  }
  function vistaPlacas(rows){
    const g=new Map(); rows.forEach(r=>{ const o=g.get(r.placa)||{placa:r.placa,afiliado:r.afc,propia:r.propia_i,viajes:0,v7:0,ultimo:'',venta:0,compra:0,tip:{},segs:{}}; o.viajes++; if(r._t>=T7) o.v7++; if(r.fecha>o.ultimo) o.ultimo=r.fecha; o.venta+=r.venta||0; o.compra+=r.compra||0; o.tip[r.tip]=(o.tip[r.tip]||0)+1; o.segs[r.seg]=(o.segs[r.seg]||0)+1; g.set(r.placa,o); });
    const dias=st.per==='30'?30:new Date(+st.per.slice(0,4),+st.per.slice(5,7),0).getDate();
    const dat=[...g.values()].map(o=>({placa:o.placa,afiliado:o.afiliado,flota:o.propia?'Propia':'Afiliado',opp:Object.entries(o.segs).sort((a,b)=>b[1]-a[1])[0][0],tip:Object.entries(o.tip).sort((a,b)=>b[1]-a[1])[0][0],viajes:o.viajes,sem:o.viajes/(dias/7),v7:o.v7,
      ultimo:o.ultimo,dsv:Math.max(0,Math.floor((HOY.getTime()-new Date(o.ultimo+'T12:00:00').getTime())/864e5)),venta:o.venta,compra:o.compra,util:o.venta-o.compra,margen:o.venta>0?(o.venta-o.compra)/o.venta*100:null}));
    $('#aout',el).innerHTML='<div id="at"></div>';
    table($('#at',el),dat,[{k:'placa',l:'Placa'},{k:'afiliado',l:'Afiliado / flota'},{k:'flota',l:'Tipo',nosum:1},{k:'opp',l:'Operación principal',nosum:1},{k:'tip',l:'Tipología',nosum:1},{k:'viajes',l:'Viajes',num:1},{k:'sem',l:'Viajes por semana',nosum:1,render:r=>nf1.format(r.sem)},{k:'v7',l:'Últimos 7 d',num:1},
      {k:'ultimo',l:'Último viaje',nosum:1},{k:'dsv',l:'Días sin viaje',num:1,nosum:1},{k:'venta',l:'Venta',money:1},{k:'compra',l:'Compra',money:1},{k:'util',l:'Utilidad',money:1},{k:'margen',l:'Margen',pct:1,ratio:['util','venta']}],{sort:'viajes'});
  }
  function vistaManif(rows){
    const dat=rows.map(r=>({...r,margen:r.venta>0?r.utilidad/r.venta*100:null}));
    $('#aout',el).innerHTML='<div id="at"></div>';
    table($('#at',el),dat,[{k:'eid',l:'Manifiesto'},{k:'fecha',l:'Fecha',nosum:1},{k:'placa',l:'Placa',nosum:1},{k:'afiliado',l:'Afiliado',nosum:1},{k:'seg',l:'Operación',nosum:1},{k:'tip',l:'Tipología',nosum:1},{k:'ruta',l:'Ruta',nosum:1},{k:'cliente',l:'Cliente',nosum:1},{k:'estado',l:'Estado',nosum:1},{k:'cumplido',l:'Cumplido',nosum:1},
      {k:'venta',l:'Venta',money:1},{k:'compra',l:'Compra',money:1},{k:'utilidad',l:'Utilidad',money:1},{k:'margen',l:'Margen',pct:1,ratio:['utilidad','venta']},{k:'ant',l:'Anticipo',money:1},{k:'saldo',l:'Saldo pagado',money:1},{k:'pagado',l:'Total pagado',money:1},{k:'pend',l:'Saldo en cartera',money:1},{k:'estado_pago',l:'Estado del pago',nosum:1}],
      {sort:'fecha',filterKey:'estado_pago',filterLabel:'Todos los estados de pago'});
  }

  // ---------- eventos
  el.addEventListener('click',e=>{
    const c=e.target.closest('.segcard'); if(c){ st.seg=c.dataset.g; st.otra=''; render(); return; }
    const o=e.target.closest('#aotras [data-o]'); if(o){ st.otra=o.dataset.o; render(); return; }
  });
  $('#ac',el).onchange=e=>{ st.cli=e.target.value; semanas(); render(); };
  $('#ap',el).onchange=e=>{ st.per=e.target.value; render(); };
  document.addEventListener('plan:update',()=>{ if(el.classList.contains('on')) render(); });
  semanas(); render();
})();
