// ============================================================================
// GRAFICOS compartidos (SVG): columnas apiladas por periodo y lineas con cruce de cursor
// ============================================================================
// cols: [{label, sub, v:{clave:valor}, tip, extra:[{l,v}]}]  series: [{k,label,color}]  budget: linea horizontal opcional
function stackCols(cols, series, {budget=null, W=700, H=280, fm=money, fv=full}={}){
  const pl=60,pr=10,pt=28,pb=46,n=Math.max(cols.length,1),slot=(W-pl-pr)/n,bw=Math.min(24,slot*.5),base=H-pb;
  const tot=cols.map(c=>series.reduce((s,x)=>s+Math.max(0,c.v[x.k]||0),0)), mxBars=Math.max(1,...tot), bud=(budget!=null&&budget>0)?budget:null;
  const mx=niceMax(Math.max(mxBars,bud?Math.min(bud,mxBars*2.5):0)*1.08), Y=v=>pt+(base-pt)*(1-v/mx);
  let g='';
  for(let i=0;i<=4;i++){ const v=mx*i/4, y=Y(v); g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pl-8}" y="${y+3.5}" text-anchor="end">${i?fm(v):'0'}</text>`; }
  cols.forEach((c,i)=>{
    const x0=pl+slot*i, cx=x0+slot/2, x=cx-bw/2, segs=series.map(s=>({s,v:Math.max(0,c.v[s.k]||0)})).filter(o=>o.v>0); let top=base;
    segs.forEach((o,k)=>{ const h=o.v/mx*(base-pt), y=top-h, last=k===segs.length-1, gap=(k>0&&h>3)?2:0, hh=Math.max(1,h-gap);
      if(last&&hh>6){ const r=Math.min(4,hh/2); g+=`<path d="M${x},${y+hh}V${y+r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y+r}V${y+hh}Z" fill="${o.s.color}"/>`; }
      else g+=`<rect x="${x}" y="${y}" width="${bw}" height="${hh}" fill="${o.s.color}"/>`;
      top=y; });
    const tp=tipA(c.tip||c.label,[...series.map(s=>({k:s.color,l:s.label,v:fv(c.v[s.k]||0)})),...(series.length>1?[{l:'Total',v:fv(tot[i])}]:[]),...(c.extra||[])]);
    g+=`<rect class="hit" x="${x0}" y="${pt}" width="${slot}" height="${base-pt}" data-tip="${tp}" tabindex="0"/>`;
    g+=`<text x="${cx}" y="${H-26}" text-anchor="middle" style="fill:var(--ink2)">${esc(c.label)}</text>`+(c.sub?`<text x="${cx}" y="${H-12}" text-anchor="middle" style="font-size:9.5px">${esc(c.sub)}</text>`:'');
  });
  if(bud!=null){
    if(bud<=mx){ const y=Y(bud); g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--accent)" stroke-width="1.5"/><text x="${W-pr}" y="${y-6}" text-anchor="end" style="fill:var(--ink);font-weight:650">Tu presupuesto ${fm(bud)}</text>`; }
    else g+=`<text x="${W-pr}" y="${pt-12}" text-anchor="end" style="fill:var(--ink);font-weight:650">Tu presupuesto ${fm(bud)} (fuera de escala)</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg><div class="legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}${bud!=null?'<span><i style="background:var(--accent);height:3px;vertical-align:3px"></i>Tu presupuesto</span>':''}</div>`;
}

// columnas de una sola serie con una linea encima (p. ej. lo pagado frente a lo vencido); la linea puede faltar en algunas semanas
// cols: [{label, sub, v, l, parcial, tip, extra:[{l,v}]}]
function barsLine(cols, {W=700,H=270,fm=money,fv=full,barLabel='',lineLabel='',barColor='var(--s1)',lineColor='var(--s2)'}={}){
  const pl=60,pr=14,pt=24,pb=46,n=Math.max(cols.length,1),slot=(W-pl-pr)/n,bw=Math.min(26,slot*.55),base=H-pb;
  const mx=niceMax(Math.max(1,...cols.map(c=>Math.max(c.v||0,c.l||0)))*1.08), Y=v=>pt+(base-pt)*(1-v/mx);
  let g='', pts=[];
  for(let i=0;i<=4;i++){ const v=mx*i/4, y=Y(v); g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pl-8}" y="${y+3.5}" text-anchor="end">${i?fm(v):'0'}</text>`; }
  cols.forEach((c,i)=>{ const x0=pl+slot*i, cx=x0+slot/2, x=cx-bw/2, h=Math.max(0,c.v||0)/mx*(base-pt), y=base-h;
    if(h>.5){ const r=Math.min(4,h/2); g+=`<path d="M${x},${base}V${y+r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y+r}V${base}Z" fill="${barColor}"${c.parcial?' opacity=".5"':''}/>`; }
    if(c.l!=null) pts.push([cx,Y(c.l)]);
    const tp=tipA(c.tip||c.label,[{k:barColor,l:barLabel,v:fv(c.v||0)},...(c.l!=null?[{k:lineColor,l:lineLabel,v:fv(c.l)}]:[]),...(c.extra||[])]);
    g+=`<rect class="hit" x="${x0}" y="${pt}" width="${slot}" height="${base-pt}" data-tip="${tp}" tabindex="0"/>`;
    g+=`<text x="${cx}" y="${H-28}" text-anchor="middle" style="fill:var(--ink2)">${esc(c.label)}</text>`+(c.sub?`<text x="${cx}" y="${H-14}" text-anchor="middle" style="font-size:9.5px">${esc(c.sub)}</text>`:''); });
  if(pts.length>1) g+=`<path d="M${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join('L')}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach(p=>{ g+=`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${lineColor}" stroke="var(--card)" stroke-width="2"/>`; });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg><div class="legend"><span><i style="background:${barColor}"></i>${esc(barLabel)}</span><span><i style="background:${lineColor};height:3px;vertical-align:3px"></i>${esc(lineLabel)}</span></div>`;
}

// lineas (2px) con puntos de 8px, cruce de cursor y rotulo directo al final de cada serie
// pts: [{label, sub, tip, extra:[{l,v}], ...valores}]  lineas: [{k,label,color}]
// marca: {i, label} vertical punteada (p. ej. la semana en que quedas al dia)  inicio: rotula el valor de hoy sobre el primer punto
function lineCols(pts, lineas, {W=700,H=280,fm=money,marca=null,inicio=false}={}){
  const pl=60,pr=124,pt=22,pb=44,n=pts.length,base=H-pb, X=i=>pl+(W-pl-pr)*i/Math.max(n-1,1);
  const mx=niceMax(Math.max(1,...pts.flatMap(p=>lineas.map(l=>p[l.k]||0)))*1.06), Y=v=>pt+(base-pt)*(1-v/mx);
  let g='';
  for(let i=0;i<=4;i++){ const v=mx*i/4, y=Y(v); g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pl-8}" y="${y+3.5}" text-anchor="end">${i?fm(v):'0'}</text>`; }
  pts.forEach((p,i)=>{ g+=`<text x="${X(i)}" y="${H-26}" text-anchor="middle" style="fill:var(--ink2)">${esc(p.label)}</text>`+(p.sub?`<text x="${X(i)}" y="${H-12}" text-anchor="middle" style="font-size:9.5px">${esc(p.sub)}</text>`:''); });
  lineas.forEach(l=>{ const d='M'+pts.map((p,i)=>X(i).toFixed(1)+','+Y(p[l.k]||0).toFixed(1)).join('L'), last=pts[n-1], yl=Y(last[l.k]||0), sube=yl+17>base-2;   // si el rotulo no cabe debajo (serie en cero), se sube para no tapar el eje
    g+=`<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(n-1)}" cy="${yl}" r="4.5" fill="${l.color}" stroke="var(--card)" stroke-width="2"/>`
      +`<text x="${X(n-1)+10}" y="${sube?yl-12:yl+4}" style="fill:var(--ink);font-weight:650">${esc(l.label)}</text><text x="${X(n-1)+10}" y="${sube?yl+1:yl+17}" style="font-size:10px">${fm(last[l.k]||0)}</text>`; });
  if(marca&&marca.i>=0&&marca.i<n){ const mx_=X(marca.i); g+=`<line x1="${mx_}" x2="${mx_}" y1="${pt}" y2="${base}" stroke="var(--good)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${mx_}" y="${pt-7}" text-anchor="middle" style="fill:var(--good);font-weight:650">${esc(marca.label)}</text>`; }
  if(inicio&&n>0){ const v0=pts[0][lineas[0].k]||0; g+=`<text x="${X(0)+8}" y="${Y(v0)-10}" style="fill:var(--ink);font-weight:650">${esc(pts[0].label)} ${fm(v0)}</text>`; }
  g+=`<line class="xh" y1="${pt}" y2="${base}" stroke="var(--ink)" stroke-opacity=".3" visibility="hidden"/>`+lineas.map((l,j)=>`<circle class="xd${j}" r="4.5" fill="${l.color}" stroke="var(--card)" stroke-width="2" visibility="hidden"/>`).join('')
    +`<rect class="ov" x="${pl}" y="${pt}" width="${W-pl-pr}" height="${base-pt}" fill="transparent" style="cursor:crosshair"/>`;
  return {html:`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg><div class="legend">${lineas.map(l=>`<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join('')}</div>`,
    bind:(root)=>{ const svg=root.querySelector('svg'), ov=svg&&svg.querySelector('.ov'); if(!ov) return; const xh=svg.querySelector('.xh'), xd=lineas.map((_,j)=>svg.querySelector('.xd'+j));
      ov.addEventListener('pointermove',ev=>{ const r=svg.getBoundingClientRect(), px=(ev.clientX-r.left)/r.width*W; let b=0,bd=Infinity; pts.forEach((p,i)=>{ const d=Math.abs(X(i)-px); if(d<bd){bd=d;b=i;} }); const p=pts[b];
        xh.setAttribute('x1',X(b)); xh.setAttribute('x2',X(b)); xh.setAttribute('visibility','visible'); lineas.forEach((l,j)=>{ xd[j].setAttribute('cx',X(b)); xd[j].setAttribute('cy',Y(p[l.k]||0)); xd[j].setAttribute('visibility','visible'); });
        tipShow(tipH(p.tip||p.label,[...lineas.map(l=>({k:l.color,l:l.label,v:full(p[l.k]||0)})),...(p.extra||[])]),ev.clientX,ev.clientY); ev.stopPropagation(); });
      ov.addEventListener('pointerleave',()=>{ xh.setAttribute('visibility','hidden'); xd.forEach(c=>c.setAttribute('visibility','hidden')); TIP.classList.remove('on'); }); }};
}
