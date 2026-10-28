// ============================================================================
// MOTOR: datos base y reglas de pago compartidas por "A quien pagar primero", "Flujo de caja", "Prioridades de analistas" y "Ajover".
//
//  - prioridades de los analistas (Excel compartido) -> PRIO
//  - reparto por ESCALERA de dias de ingreso (asignar)
//  - proyeccion semana a semana de lo que va a pasar a vencido (prepararFlujo / simular / presupuestoNecesario)
//
// Plazo: una factura tiene 15 dias desde su fecha para pagarse; al dia 16 pasa a vencida.
// ============================================================================
const MOTOR = (function(){
  const C=D.caja||[], CC=D.caja_cli||[], FA=D.facturas_af||[], PIPE=D.pipeline||[];
  const PLAZO=15;                                              // dias para pagar una factura antes de que pase a vencida
  const LAG=Math.round((D.lag_fact&&D.lag_fact.p50)||7);       // dias tipicos entre el viaje y su factura (medido en los datos)
  const [dd,mm,yy]=String(D.meta.hoy).split('/').map(Number), HOY=new Date(yy,mm-1,dd);
  C.forEach(x=>{ x.lv=lvOf(x.nivel); x.nivelTxt=lvTxt(x.nivel); x.w=Math.max((x.compra30||0)*7/30,Math.min(x.venc_libre||0,2e6)); x.inc=x.w/7; });   // ingreso semanal (w) y diario (inc)
  const CM=new Map(C.map(x=>[x.afiliado,x])), CAFN=new Map(C.map(x=>[x.afn,x])), CMN=new Map(C.map(x=>[normN(x.afiliado),x]));

  // ---------- prioridades de los analistas
  const PRIO_TXT={1:'Alta',2:'Media',3:'Baja',0:'No pagar'};
  const PRIO_TONE={1:'var(--accent)',2:'var(--s7)',3:'var(--mut)',0:'var(--s2)'};
  const PRIO=new Map(); (D.prioridades||[]).forEach(p=>{ if(p.estado_match==='OK'||p.estado_match==='APROXIMADO') PRIO.set(p.afiliado,p); });
  const prioTip=p=>tipA('Prioridad del analista · '+PRIO_TXT[p.prioridad],[{l:'Analista',v:p.analista||'—'},{l:'Registrada',v:p.fecha||'—'},{l:'Motivo',v:p.motivo||'—'},{l:'Compromiso',v:(p.compromiso||'—')+(p.fecha_compromiso?' · '+p.fecha_compromiso:'')},{l:'Monto solicitado',v:p.monto?full(p.monto):'—'},{l:'Observaciones',v:p.obs||'—'}]);
  const prioPill=a=>{ const p=PRIO.get(a); return p?`<span class="pill" style="--tone:${PRIO_TONE[p.prioridad]}" data-tip="${prioTip(p)}">${PRIO_TXT[p.prioridad]}${p.analista?' · '+esc(p.analista):''}</span>`:''; };
  const prioTexto=a=>{ const p=PRIO.get(a); return p?`${PRIO_TXT[p.prioridad]} ${p.analista||''} ${p.motivo||''} ${p.obs||''}`:''; };
  const reqOf=x=>{ const p=PRIO.get(x.afiliado); return p&&p.prioridad===1&&p.monto>0?Math.min(p.monto,x.venc_libre||0):0; };

  // ---------- facturas abiertas por afiliado (libres): vencidas, por vencer y retenidas
  const FAI=new Map();
  FA.forEach(f=>{ const c=CMN.get(normN(f.afiliado)); if(!c) return; const x=FAI.get(c.afiliado)||{porVencer:0,pv7:0,vencido:0,ret:0,n:0};
    if(f.ret_i) x.ret+=f.importe; else if(f.dfac>PLAZO) x.vencido+=f.importe; else { x.porVencer+=f.importe; if(PLAZO+1-f.dfac<=7) x.pv7+=f.importe; } x.n++; FAI.set(c.afiliado,x); });

  // ---------- clientes de cada afiliado (venta de 30 dias)
  const pv=r=>Math.max(r.venta||0,0);
  const byAf=new Map(); CC.forEach(r=>{ if(!byAf.has(r.afiliado)) byAf.set(r.afiliado,[]); byAf.get(r.afiliado).push(r); });
  const afTot=new Map(); byAf.forEach((rs,a)=>afTot.set(a,rs.reduce((s,r)=>s+pv(r),0)));
  const shareOf=(a,r)=>{ const t=afTot.get(a)||0; return t>0?pv(r)/t:1/((byAf.get(a)||[r]).length); };
  const cliVenta=new Map(); CC.forEach(r=>cliVenta.set(r.cliente,(cliVenta.get(r.cliente)||0)+pv(r)));
  const CLIENTS=[...cliVenta.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  const corto=n=>{ const s=String(n).replace(/\b(S\.?A\.?S\.?|SAS|S\.?A\.?|LTDA|DE COLOMBIA|COLOMBIA)\b\.?/gi,'').replace(/\s+/g,' ').trim(); return s.length>24?s.slice(0,23)+'…':s; };
  const cliTxt=a=>{ const cl=(byAf.get(a)||[]).slice().sort((x,y)=>pv(y)-pv(x)), t=afTot.get(a)||0, p=r=>t>0?' '+Math.round(pv(r)/t*100)+'%':'';
    return {corto:cl.slice(0,2).map(r=>corto(r.cliente)+p(r)).join(' · ')+(cl.length>2?` +${cl.length-2}`:''),full:cl.map(r=>r.cliente+p(r)).join(', '),principal:cl.length?cl[0].cliente:''}; };
  const fshare=(a,focus)=>{ const rs=byAf.get(a)||[], t=afTot.get(a)||0; if(!t) return 0; return rs.filter(r=>focus.has(r.cliente)).reduce((s,r)=>s+pv(r),0)/t; };

  // ---------- reparto por escalera
  const ESC=[{m:3.5,t:'3,5 días'},{m:7,t:'1 semana'},{m:14,t:'2 semanas'},{m:28,t:'4 semanas'},{m:Infinity,t:'Todo el saldo'}];
  // items: {need (lo que se puede pagar), inc (ingreso diario), grp (orden de atencion), req (monto pedido por un analista)}, ya ordenados.
  function asignar(items,B,est){
    const n=items.length, paid=new Array(n).fill(0); let rest=B;
    if(est==='orden'){ for(let i=0;i<n&&rest>0;i++){ const a=Math.min(items[i].need,rest); paid[i]=a; rest-=a; } return {paid,rest}; }
    const groups=[...new Set(items.map(c=>c.grp))].sort((a,b)=>a-b), idxBy=groups.map(g=>{ const o=[]; items.forEach((c,i)=>{ if(c.grp===g) o.push(i); }); return o; });
    const etapas=[it=>Math.min(it.req||0,it.need), ...ESC.map(e=>it=>Math.min(it.need,e.m===Infinity?it.need:it.inc*e.m))];
    outer: for(const tg of etapas){
      for(const idx of idxBy){
        const delta=idx.map(i=>Math.max(0,tg(items[i])-paid[i])), cost=delta.reduce((a,b)=>a+b,0); if(cost<=0) continue;
        if(cost<=rest){ idx.forEach((i,k)=>paid[i]+=delta[k]); rest-=cost; }
        else{ const f=rest/cost; idx.forEach((i,k)=>paid[i]+=delta[k]*f); rest=0; break outer; }
      }
      if(rest<1) break;
    }
    return {paid,rest};
  }
  const costos=items=>ESC.map(e=>items.reduce((s,c)=>s+Math.min(c.need,e.m===Infinity?c.need:c.inc*e.m),0));    // costo acumulado de cada escalon

  // afiliados que entran al plan de hoy (segun nivel, prioridades de analistas y clientes protegidos)
  function candidatos({incl=3,focus=new Set(),respetar=true}={}){
    let cand=C.filter(x=>x.venc_libre>0 && (incl===4 ? (x.viajes30>0&&x.lv>=1&&x.lv<=4) : (x.lv>=1&&x.lv<=incl)));
    if(respetar){
      const ya=new Set(cand.map(x=>x.afiliado));
      C.forEach(x=>{ const p=PRIO.get(x.afiliado); if(p&&x.venc_libre>0&&(p.prioridad===1||p.prioridad===2)&&!ya.has(x.afiliado)){ cand.push(x); ya.add(x.afiliado); } });
      cand=cand.filter(x=>{ const p=PRIO.get(x.afiliado); return !(p&&p.prioridad===0); });
    }
    const foc=focus.size>0;
    cand.forEach(x=>{ const p=respetar?PRIO.get(x.afiliado):null; x.fs=foc?fshare(x.afiliado,focus):0;
      let g=((foc&&x.fs>=.2)?0:1)*10+x.lv; if(p&&p.prioridad===1) g=-1; else if(p&&p.prioridad===3) g+=100;
      x.grp=g; x.need=x.venc_libre; x.req=respetar?reqOf(x):0; x.dens=x.venta30/Math.max(Math.min(x.venc_libre,x.inc*7),1); });
    return cand.sort((a,b)=>a.grp-b.grp||b.dens-a.dens);
  }

  // ---------- proyeccion: lo que va a pasar a vencido cada semana y como se mueve el vencido con un presupuesto semanal
  const KINDS=['fact','liq','oculto','causar','nuevo'];
  const dia=(n)=>new Date(HOY.getTime()+n*864e5);
  const MESES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fmtD=d=>d.getDate()+' '+MESES[d.getMonth()];
  const semanaTxt=w=>fmtD(dia(7*(w-1)+1))+' – '+fmtD(dia(7*w));
  function universoFlujo(scope,respetar){
    const U=C.filter(x=>scope==='todos'?true:((x.lv>=1&&x.lv<=4)||(x.lv===0&&x.viajes30>0)));
    if(respetar){ const ya=new Set(U.map(x=>x.afiliado)); C.forEach(x=>{ const p=PRIO.get(x.afiliado); if(p&&(p.prioridad===1||p.prioridad===2)&&!ya.has(x.afiliado)){ U.push(x); ya.add(x.afiliado); } }); }
    return U;
  }
  // arma, una sola vez, los vencimientos de cada afiliado semana por semana
  function prepararFlujo({H=8,scope='activos',respetar=true}={}){
    const U=universoFlujo(scope,respetar), idx=new Map(U.map((c,i)=>[c.afiliado,i])), days=H*7, K=LAG+PLAZO+1;
    const inf=U.map(()=>Array.from({length:H+1},()=>({fact:0,liq:0,oculto:0,causar:0,nuevo:0})));
    // a) facturas abiertas libres que todavia no estan vencidas: pasan a vencidas al dia (plazo + 1 - dias de la factura)
    FA.forEach(f=>{ if(f.ret_i||f.dfac>PLAZO) return; const c=CMN.get(normN(f.afiliado)), i=c?idx.get(c.afiliado):null; if(i==null) return;
      const w=Math.ceil((PLAZO+1-f.dfac)/7); if(w>=1&&w<=H) inf[i][w].fact+=f.importe; });
    // b) viajes terminados o en ruta que aun no tienen factura: se facturan ~LAG dias despues del viaje y vencen PLAZO dias despues
    PIPE.forEach(p=>{ const c=CAFN.get(p.afn), i=c?idx.get(c.afiliado):null; if(i==null) return;
      let tipo=p.tipo==='liquidar'?'liq':'causar', due;
      if(tipo==='liq'){ if(p.edad>=LAG+PLAZO+1){ tipo='oculto'; due=1; } else due=Math.max(1,LAG-p.edad)+PLAZO+1; }
      else due=Math.max(3,LAG-p.edad)+PLAZO+1;
      const w=Math.ceil(due/7); if(w>=1&&w<=H) inf[i][w][tipo]+=p.monto; });
    // c) viajes nuevos: lo que se genera cada dia segun lo que cargo en los ultimos 30 dias (la parte que no se paga como anticipo)
    const act=C.filter(x=>x.lv>=1&&x.lv<=4), tc=sumBy(act,'compra30'), gAnt=tc>0?sumBy(act,'ant30')/tc:.85;
    U.forEach((c,i)=>{ if(!(c.compra30>0)) return; const ar=c.ant30>0?Math.min(.95,c.ant30/c.compra30):gAnt, sh=Math.max(.04,Math.min(.5,.96-ar)), g=c.compra30/30*sh;
      for(let w=1;w<=H;w++){ const lo=Math.max(1,7*(w-1)+1-K), hi=7*w-K, nd=Math.max(0,hi-lo+1); if(nd>0) inf[i][w].nuevo+=g*nd; } });
    const sh=(()=>{ const a=gAnt; return Math.max(.04,Math.min(.5,.96-a)); })();
    return {U,inf,H,gAnt,saldoShare:sh};
  }
  // simula H semanas: cada semana se paga con el presupuesto W segun la escalera; lo que no se paga queda como vencido
  function simular(prep,{W=0,W0=null,est='amplia',respetar=true}={}){
    const {U,inf,H}=prep, n=U.length;
    const gr=U.map(c=>{ const p=respetar?PRIO.get(c.afiliado):null; let g=c.lv===0?3.5:c.lv; if(p&&p.prioridad===1) g=-1; else if(p&&p.prioridad===3) g+=100; return g; });
    const nopagar=U.map(c=>{ const p=respetar?PRIO.get(c.afiliado):null; return !!(p&&p.prioridad===0); });
    const orden=U.map((_,i)=>i).sort((a,b)=>gr[a]-gr[b]||(U[b].venta30-U[a].venta30));
    const stock=U.map(c=>c.venc_libre||0), sched=U.map(()=>new Array(H+1).fill(0)), weeks=[];
    const S0=stock.reduce((s,v)=>s+v,0); let sinPagar=S0;
    for(let w=1;w<=H;w++){
      const tot={fact:0,liq:0,oculto:0,causar:0,nuevo:0}; let infTot=0;
      for(let i=0;i<n;i++){ const r=inf[i][w]; let s=0; for(const k of KINDS){ tot[k]+=r[k]; s+=r[k]; } stock[i]+=s; infTot+=s; }
      const items=[], map=[];
      orden.forEach(i=>{ if(nopagar[i]||stock[i]<=1) return; items.push({need:stock[i],inc:U[i].inc,grp:gr[i],req:(w===1&&respetar)?reqOf(U[i]):0}); map.push(i); });
      const B=Array.isArray(W)?W[w-1]:(w===1&&W0!=null?W0:W), {paid}=asignar(items,B,est); let pagado=0;
      map.forEach((i,k)=>{ stock[i]-=paid[k]; sched[i][w]=paid[k]; pagado+=paid[k]; });
      sinPagar+=infTot;
      let fin=0, finPagable=0, nDeuda=0; for(let i=0;i<n;i++){ fin+=stock[i]; if(!nopagar[i]) finPagable+=stock[i]; if(stock[i]>1) nDeuda++; }
      weeks.push({w,inflow:tot,inflowTotal:infTot,paid:pagado,stockEnd:fin,stockPagable:finPagable,sinPagar,nDeuda,budget:B});
    }
    return {U,weeks,sched,S0,H};
  }
  // presupuesto semanal constante que deja en cero el vencido (de los afiliados que se pueden pagar) a las Hn semanas
  function presupuestoNecesario(Hn,{scope='activos',est='amplia',respetar=true}={}){
    const prep=prepararFlujo({H:Hn,scope,respetar}), base=simular(prep,{W:0,est,respetar}), total=base.weeks[Hn-1].sinPagar-(base.weeks[Hn-1].stockEnd-base.weeks[Hn-1].stockPagable);
    const tol=Math.max(1e6,.002*base.S0); let lo=0, hi=Math.max(1,total/Hn*1.02);
    for(let i=0;i<28;i++){ const mid=(lo+hi)/2, r=simular(prep,{W:mid,est,respetar}); if(r.weeks[Hn-1].stockPagable<=tol) hi=mid; else lo=mid; }
    return {W:hi,prep};
  }
  // presupuesto semanal minimo para que el vencido no crezca (al final de H semanas queda igual o menor que hoy)
  function presupuestoParaNoEmpeorar(prep,{est='amplia',respetar=true}={}){
    const base=simular(prep,{W:0,est,respetar}), H=prep.H; let lo=0, hi=Math.max(1,base.weeks[H-1].sinPagar/H*1.02);
    for(let i=0;i<28;i++){ const mid=(lo+hi)/2, r=simular(prep,{W:mid,est,respetar}); if(r.weeks[H-1].stockPagable<=base.S0-(base.weeks[H-1].stockEnd-base.weeks[H-1].stockPagable)+1e6) hi=mid; else lo=mid; }
    return hi;
  }

  // operacion de Ajover / Nouvelle en la que mas trabaja cada afiliado (compra de los ultimos 60 dias)
  const SEGAF=(()=>{ const m=new Map(), lim=HOY.getTime()-60*864e5;
    (D.flota_manif||[]).forEach(r=>{ if(r.propia_i||new Date(r.fecha).getTime()<lim) return; const k=normN(r.afiliado), o=m.get(k)||{}; o[r.seg]=(o[r.seg]||0)+(r.compra||0); m.set(k,o); });
    const out=new Map(); m.forEach((o,k)=>out.set(k,Object.entries(o).sort((a,b)=>b[1]-a[1])[0][0])); return out; })();
  const segAf=a=>SEGAF.get(normN(a))||'';

  return {C,CC,FA,PIPE,CM,CAFN,CMN,PLAZO,LAG,HOY,PRIO,PRIO_TXT,PRIO_TONE,prioPill,prioTip,prioTexto,reqOf,FAI,pv,byAf,afTot,shareOf,CLIENTS,corto,cliTxt,fshare,segAf,
    ESC,asignar,costos,candidatos,universoFlujo,prepararFlujo,simular,presupuestoNecesario,presupuestoParaNoEmpeorar,semanaTxt,dia,fmtD,plan:{st:null,cur:null}};
})();
