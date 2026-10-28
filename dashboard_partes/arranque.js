const h0 = (location.hash||'#resumen').slice(1);
show(TABS.some(t=>t[0]===h0) ? h0 : 'resumen');
