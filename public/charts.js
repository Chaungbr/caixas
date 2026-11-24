/* Gráficos SVG leves — sem dependências. Valores em centavos. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (c) => BRL.format((c || 0) / 100);
  function short(c) {
    const v = (c || 0) / 100; const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (a >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  function nice(max, n = 4) {
    if (max <= 0) return { top: 100, step: 25 };
    const raw = max / n; const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    return { top: Math.ceil(max / step) * step, step };
  }
  const barPath = (x, y, w, h, r = 4) => {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };
  const tipRow = (color, name, val) => `<div class='tr'><span><span class='sw' style='background:${color}'></span> ${esc(name)}</span><b>${esc(val)}</b></div>`;

  function frame(W, H, P, top, step, labels) {
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = P.t + (H - P.t - P.b) * (1 - v / top);
      g += `<line class="${v === 0 ? 'axis-l' : 'grid-l'}" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/>`;
      g += `<text x="${P.l - 8}" y="${y + 4}" text-anchor="end">${short(v)}</text>`;
    }
    const bw = (W - P.l - P.r) / labels.length;
    labels.forEach((l, i) => { g += `<text x="${P.l + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
    return { g, bw };
  }

  /** Linhas: series = [{name,color,values}] */
  function line({ labels, series, height = 230 }) {
    const W = 640, H = height, P = { t: 14, r: 12, b: 28, l: 52 };
    const max = Math.max(0, ...series.flatMap((s) => s.values));
    const min = Math.min(0, ...series.flatMap((s) => s.values));
    const { top, step } = nice(Math.max(max, 1));
    const { g, bw } = frame(W, H, P, top, step, labels);
    const y = (v) => P.t + (H - P.t - P.b) * (1 - Math.max(v, min) / top);
    const x = (i) => P.l + bw * i + bw / 2;
    let paths = '', hits = '';
    series.forEach((s) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const li = s.values.length - 1;
      paths += `<circle cx="${x(li)}" cy="${y(s.values[li])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    });
    labels.forEach((l, i) => {
      const tip = `<b>${esc(l)}</b>` + series.map((s) => tipRow(s.color, s.name, money(s.values[i]))).join('');
      hits += `<rect class="hit" x="${P.l + bw * i}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" data-tip="${esc(tip)}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${paths}${hits}</svg>`;
  }

  /** Barras agrupadas: series = [{name,color,values}] */
  function bars({ labels, series, height = 230 }) {
    const W = 640, H = height, P = { t: 14, r: 12, b: 28, l: 52 };
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const { top, step } = nice(max);
    const { g, bw } = frame(W, H, P, top, step, labels);
    const inner = Math.min(bw * 0.72, series.length * 22); const gap = 2;
    const w = (inner - gap * (series.length - 1)) / series.length;
    let marks = '';
    labels.forEach((l, i) => {
      const x0 = P.l + bw * i + (bw - inner) / 2;
      series.forEach((s, k) => {
        const v = Math.max(0, s.values[i] || 0); const h = (H - P.t - P.b) * (v / top);
        marks += `<path class="mk" d="${barPath(x0 + k * (w + gap), H - P.b - h, w, h)}" fill="${s.color}"/>`;
      });
      const tip = `<b>${esc(l)}</b>` + series.map((s) => tipRow(s.color, s.name, money(s.values[i]))).join('');
      marks += `<rect class="hit" x="${P.l + bw * i}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" data-tip="${esc(tip)}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${marks}</svg>`;
  }

  /** Comprometimento: barras empilhadas de compromissos + marcador da renda esperada */
  function commit({ labels, stacks, income, height = 240, incomeLabel = 'Renda prevista' }) {
    const W = 640, H = height, P = { t: 14, r: 12, b: 28, l: 52 };
    const totals = labels.map((_, i) => stacks.reduce((s, st) => s + (st.values[i] || 0), 0));
    const max = Math.max(1, ...totals, ...income);
    const { top, step } = nice(max);
    const { g, bw } = frame(W, H, P, top, step, labels);
    const w = Math.min(bw * 0.5, 46); const ph = H - P.t - P.b;
    let marks = '';
    labels.forEach((l, i) => {
      const x0 = P.l + bw * i + (bw - w) / 2; let acc = 0;
      const visible = stacks.filter((st) => (st.values[i] || 0) > 0);
      visible.forEach((st, k) => {
        const v = st.values[i]; const h = ph * (v / top); const yb = H - P.b - ph * (acc / top);
        const isTop = k === visible.length - 1; const hh = Math.max(h - (isTop ? 0 : 2), 0.5);
        marks += isTop ? `<path class="mk" d="${barPath(x0, yb - h, w, h)}" fill="${st.color}"/>` : `<rect class="mk" x="${x0}" y="${yb - hh}" width="${w}" height="${hh}" fill="${st.color}"/>`;
        acc += v;
      });
      if (income[i] > 0) {
        const yi = H - P.b - ph * (income[i] / top);
        marks += `<line x1="${x0 - 8}" x2="${x0 + w + 8}" y1="${yi}" y2="${yi}" stroke="var(--text)" stroke-width="2" stroke-dasharray="4 3"/>`;
      }
      const ratio = income[i] > 0 ? ` (${Math.round((totals[i] / income[i]) * 100)}% da renda)` : '';
      const tip = `<b>${esc(l)}</b>` + visible.map((st) => tipRow(st.color, st.name, money(st.values[i]))).join('') +
        `<div class='tr'><span>Total comprometido</span><b>${esc(money(totals[i]) + ratio)}</b></div><div class='tr'><span>${esc(incomeLabel)}</span><b>${esc(money(income[i]))}</b></div>`;
      marks += `<rect class="hit" x="${P.l + bw * i}" y="${P.t}" width="${bw}" height="${ph}" data-tip="${esc(tip)}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${marks}</svg>`;
  }

  window.Charts = { line, bars, commit, short, nice };
})();
