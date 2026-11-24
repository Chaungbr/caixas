/* Caixas — aplicação cliente (SPA sem dependências). Valores monetários sempre em centavos. */
'use strict';
(function () {
  // ───────────────────────────── Utilidades ─────────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (c) => (S.hide ? 'R$ ••••' : BRL.format((c || 0) / 100));
  const moneyInput = (c) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  function parseMoney(str) {
    let s = String(str ?? '').replace(/[R$\s ]/g, ''); if (!s) return 0;
    const neg = s.startsWith('-'); s = s.replace(/^-/, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s); if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) * (neg ? -1 : 1);
  }
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const curYm = () => todayISO().slice(0, 7);
  function ymAdd(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${pad(m)}`; }
  const ymDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const MSHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const ymLabel = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} de ${ym.slice(0, 4)}`;
  const ymShort = (ym) => `${MSHORT[Number(ym.slice(5)) - 1]}/${ym.slice(2, 4)}`;
  const fdate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
  const fdateShort = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
  const defaultDate = (ym) => (curYm() === ym ? todayISO() : `${ym}-01`);
  const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const tint = (hex, a = 0.14) => `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;

  const TYPES = {
    pagamento: { label: 'Pagamento', desc: 'Faturas, boletos e obrigações', icon: 'file' },
    consumo: { label: 'Consumo', desc: 'Gastos variáveis ao longo do mês', icon: 'cart' },
    acumulacao: { label: 'Acumulação', desc: 'Reservas que seguem para os próximos meses', icon: 'piggy' },
    meta: { label: 'Meta', desc: 'Objetivo com valor-alvo definido', icon: 'target' },
  };
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0e7c86', '#52514e'];
  const STATUS = { pago: ['Pago', 'check'], pendente: ['Pendente', 'clock'], vencido: ['Vencido', 'alert'], recebido: ['Recebido', 'check'], previsto: ['Previsto', 'clock'], info: ['Info', 'info'] };
  const statusBadge = (s) => (s && STATUS[s] ? `<span class="badge ${s}">${icon(STATUS[s][1])}${STATUS[s][0]}</span>` : '');
  const KIND = { reserva: 'Distribuição', gasto: 'Gasto', pagamento: 'Pagamento', transferencia: 'Transferência', receita: 'Receita' };
  const isPersistent = (t) => t === 'acumulacao' || t === 'meta';
  const funds = (b) => b.opening + b.reserved + b.tin - b.tout;

  // ───────────────────────────── Estado ─────────────────────────────
  const ROUTES = {
    'visao-geral': { title: 'Visão geral', icon: 'overview' },
    caixas: { title: 'Minhas caixas', icon: 'boxes' },
    cartoes: { title: 'Cartões', icon: 'card' },
    movimentacoes: { title: 'Movimentações', icon: 'list' },
    planejamento: { title: 'Planejamento', icon: 'plan' },
    calendario: { title: 'Calendário', icon: 'calendar' },
    relatorios: { title: 'Relatórios', icon: 'chart' },
    configuracoes: { title: 'Configurações', icon: 'settings' },
  };
  let savedYm = null; try { savedYm = sessionStorage.getItem('caixas_ym'); } catch (e) { /* */ }
  const S = { me: null, ym: /^\d{4}-\d{2}$/.test(savedYm || '') ? savedYm : curYm(), route: 'visao-geral', view: null, boxFilter: 'todas', cardSel: null, calDay: null, mv: { kind: '', box: '', q: '' }, authMode: 'login', pending: 0, hide: (() => { try { return localStorage.getItem('caixas_hide') === '1'; } catch (e) { return false; } })() };

  // ───────────────────────────── API ─────────────────────────────
  function setSaving(state) {
    const el = $('#saveInd'); if (!el) return;
    el.className = `save-ind ${state === 'busy' ? 'busy' : state === 'err' ? 'err' : ''}`;
    el.querySelector('span:last-child').textContent = state === 'busy' ? 'Salvando…' : state === 'err' ? 'Erro ao salvar' : 'Salvo';
  }
  async function api(method, url, body) {
    const mut = method !== 'GET';
    if (mut) { S.pending++; setSaving('busy'); }
    try {
      // Tudo roda no aparelho: a "API" é local (local-api.js) e salva no armazenamento do navegador.
      const data = window.LocalAPI.call(method, url, body ? JSON.parse(JSON.stringify(body)) : undefined);
      if (mut) { S.pending--; if (!S.pending) setSaving('ok'); }
      return data;
    } catch (e) {
      if (mut) { S.pending = Math.max(0, S.pending - 1); setSaving('err'); }
      if (!(e instanceof window.LocalAPI.HttpError)) console.error(e);
      throw new Error(e instanceof window.LocalAPI.HttpError ? e.message : 'Erro inesperado. Tente novamente.');
    }
  }
  function download(filename, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportCsv(kind, ym) { download(`caixas-${kind}${ym ? '-' + ym : ''}.csv`, window.LocalAPI.exportCsv(kind, ym || null), 'text/csv;charset=utf-8'); }
  const csvBtn = (kind, ym, label = 'Baixar', cls = 'btn sm') => `<button type="button" class="${cls}" data-act="csv" data-kind="${kind}" data-ym="${ym || ''}">${icon('download')}${label}</button>`;
  const lastBackup = () => { try { return localStorage.getItem('caixas_last_backup') || ''; } catch (e) { return ''; } };
  function backupNow() {
    download(`caixas-backup-${todayISO()}.json`, window.LocalAPI.exportBackup(), 'application/json');
    try { localStorage.setItem('caixas_last_backup', todayISO()); } catch (e) { /* */ }
    toast('Backup gerado — guarde o arquivo no app Arquivos ou no iCloud Drive');
  }
  async function loadView() { S.view = await api('GET', `/api/month/${S.ym}`); return S.view; }

  // ───────────────────────────── Toast / tooltip ─────────────────────────────
  function toast(msg, type = '') {
    const t = document.createElement('div'); t.className = `toast ${type}`; t.innerHTML = `${icon(type === 'err' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, type === 'err' ? 4200 : 2400);
  }
  const tipEl = () => $('#tooltip');
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (!el) return; const t = tipEl(); t.innerHTML = el.getAttribute('data-tip'); t.classList.add('on'); });
  document.addEventListener('mousemove', (e) => {
    const t = tipEl(); if (!t.classList.contains('on')) return;
    if (!e.target.closest('[data-tip]')) { t.classList.remove('on'); return; }
    const w = t.offsetWidth, h = t.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) tipEl().classList.remove('on'); });

  // ───────────────────────────── Modais ─────────────────────────────
  const modals = [];
  function closeAllModals() { while (modals.length) modals[modals.length - 1].close(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modals.length) { e.preventDefault(); modals[modals.length - 1].close(); } });
  function modal({ title, body, submit = 'Salvar', cancel = 'Cancelar', size = '', danger = false, onSubmit, onOpen, onClose, footLeft = '', noFoot = false }) {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<form class="modal ${size}" novalidate autocomplete="off">
      <div class="modal-h"><h3>${title}</h3><button type="button" class="btn ghost icon sm" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="modal-b">${body}<div class="err-box hide" style="margin-top:14px"></div></div>
      ${noFoot ? '' : `<div class="modal-f">${footLeft ? `<div class="l">${footLeft}</div>` : ''}${cancel ? `<button type="button" class="btn" data-close>${cancel}</button>` : ''}${submit ? `<button class="btn ${danger ? 'danger solid' : 'primary'}" type="submit">${submit}</button>` : ''}</div>`}
    </form>`;
    document.body.appendChild(ov);
    const form = ov.querySelector('form'); const err = ov.querySelector('.err-box');
    const m = { form, el: ov, close() { const i = modals.indexOf(m); if (i < 0) return; modals.splice(i, 1); ov.remove(); onClose && onClose(); }, error(msg) { err.textContent = msg; err.classList.toggle('hide', !msg); } };
    modals.push(m);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) m.close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!onSubmit) return m.close();
      m.error(''); const btn = form.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
      try { const r = await onSubmit(formData(form), form, m); if (r !== false) m.close(); }
      catch (ex) { m.error(ex.message); }
      finally { if (btn) btn.disabled = false; }
    });
    bindMoneyInputs(form);
    onOpen && onOpen(form, m);
    setTimeout(() => { const f = form.querySelector('[autofocus]') || form.querySelector('.modal-b input:not([type=hidden]):not([type=radio]):not([type=checkbox]), .modal-b select, .modal-b textarea'); f && f.focus(); }, 30);
    return m;
  }
  function formData(form) {
    const o = {}; for (const [k, v] of new FormData(form)) o[k] = v;
    $$('input[type=checkbox][name]', form).forEach((c) => { o[c.name] = c.checked; });
    return o;
  }
  function confirmDlg(text, { title = 'Confirmar', ok = 'Confirmar', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      modal({ title, body: `<p style="margin:0;color:var(--text-2)">${text}</p>`, submit: ok, danger, onSubmit: () => { done = true; resolve(true); }, onClose: () => { if (!done) resolve(false); } });
    });
  }
  function bindMoneyInputs(root) {
    $$('input[data-money]', root).forEach((inp) => {
      inp.addEventListener('blur', () => { const c = parseMoney(inp.value); if (inp.value.trim() && Number.isFinite(c)) inp.value = (c < 0 ? '-' : '') + moneyInput(Math.abs(c)); });
      inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
    });
  }
  const mField = (name, label, cents, { hint = '', attrs = '' } = {}) => `<div class="field"><label>${label}</label><div class="money-wrap"><input class="inp money" data-money inputmode="decimal" name="${name}" value="${moneyInput(cents)}" placeholder="0,00" ${attrs}></div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const tField = (name, label, value = '', { type = 'text', hint = '', attrs = '' } = {}) => `<div class="field"><label>${label}</label><input class="inp" type="${type}" name="${name}" value="${esc(value)}" ${attrs}>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  function needMoney(v, label, { allowZero = false, allowNeg = false } = {}) {
    const c = parseMoney(v); if (!Number.isFinite(c)) throw new Error(`${label}: valor inválido.`);
    if (!allowNeg && c < 0) throw new Error(`${label}: não pode ser negativo.`);
    if (!allowZero && c === 0) throw new Error(`${label}: informe um valor maior que zero.`);
    return c;
  }
  const boxOpts = (sel, filter = () => true, boxes = S.view.boxes) => boxes.filter(filter).map((b) => `<option value="${b.id}" ${String(b.id) === String(sel) ? 'selected' : ''}>${esc(b.name)}${b.saldo != null ? ` · ${money(b.saldo)}` : ''}</option>`).join('');

  // ───────────────────────────── Render raiz ─────────────────────────────
  const root = $('#root');
  function render() { if (!S.me || !S.me.name) return renderAuth(); renderShell(); renderPage(true); }

  function renderAuth() {
    const demo = (name, ic, color, type, val, used, tot) => `<div class="box" style="--c:${color}"><div class="box-h"><div class="ico-tile" style="background:${tint(color)};color:${color}">${icon(ic)}</div><div><div class="nm">${name}</div><div class="tp">${type}</div></div></div><div class="saldo"><span class="v">${val}</span></div><div class="prog"><span style="width:${(used / tot) * 100}%;background:${color}"></span></div></div>`;
    root.innerHTML = `<div class="auth">
      <div class="auth-l">
        <div class="brand"><span class="brand-mark"></span>Caixas</div>
        <div><h1>Cada real com um destino definido.</h1><p>Distribua seu salário em caixas com finalidade, acompanhe faturas e compromissos futuros e feche o mês com tudo no lugar.</p></div>
        <div class="auth-demo">${demo('Alimentação', 'cart', '#1baf7a', 'Consumo', 'R$ 640,00 disponíveis', 3, 8)}${demo('Reserva financeira', 'piggy', '#008300', 'Acumulação', 'R$ 12.400,00', 6, 8)}</div>
      </div>
      <div class="auth-r"><form class="auth-form form" id="authForm" novalidate>
        <div class="brand" style="padding:0 0 8px"><span class="brand-mark"></span>Caixas</div>
        <div><h2>Bem-vindo</h2><p class="sub">Funciona sem internet. Seus dados ficam guardados só neste aparelho.</p></div>
        ${tField('name', 'Como você quer ser chamado?', '', { attrs: 'autocomplete="given-name" required maxlength="80"' })}
        <div class="err-box hide"></div>
        <button class="btn primary" type="submit">Começar</button>
        <div class="auth-switch">Já usa o Caixas? <a data-act="backup-restore">Restaurar um backup</a></div>
      </form></div></div>`;
    const f = $('#authForm');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = f.querySelector('.err-box'); err.classList.add('hide');
      try { await api('PUT', '/api/me', { name: formData(f).name }); await boot(); }
      catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); }
    });
    setTimeout(() => f.querySelector('input')?.focus(), 30);
  }

  function renderShell() {
    if ($('.app')) return updateShell();
    root.innerHTML = `<div class="app">
      <aside class="side">
        <div class="brand"><span class="brand-mark"></span>Caixas</div>
        <nav class="nav" id="nav">${Object.entries(ROUTES).map(([k, r]) => `<a href="#/${k}" data-route="${k}">${icon(r.icon)}<span>${r.title}</span></a>`).join('')}</nav>
        <div class="side-foot">
          <button class="btn ghost" data-act="theme-cycle" style="justify-content:flex-start" id="themeBtn"></button>
          <div class="user-chip"><div class="avatar" id="avatar"></div><div><div class="nm" id="uName"></div><div class="em" id="uEmail"></div></div>
            </div>
        </div>
      </aside>
      <div class="mobile-scrim" data-act="nav-close"></div>
      <main class="main">
        <header class="top" id="top">
          <button class="btn ghost icon menu-btn" data-act="nav-open" aria-label="Menu">${icon('menu')}</button>
          <h1 id="pageTitle"></h1>
          <div class="month-sw" id="monthSw">
            <button data-act="month-prev" aria-label="Mês anterior">${icon('left')}</button>
            <div class="lbl" data-act="month-today" title="Ir para o mês atual" id="monthLbl"></div>
            <button data-act="month-next" aria-label="Próximo mês">${icon('right')}</button>
          </div>
          <div class="spacer"></div>
          <div class="save-ind" id="saveInd"><span class="dot"></span><span>Salvo</span></div>
          <div class="btn-row" id="topActs"></div>
        </header>
        <div class="page" id="page"></div>
      </main>
    </div>`;
    addEventListener('scroll', () => $('#top')?.classList.toggle('scrolled', scrollY > 4), { passive: true });
    updateShell();
  }
  function updateShell() {
    $('.app').dataset.route = S.route;
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === S.route));
    $('#pageTitle').textContent = ROUTES[S.route].title;
    $('#uName').textContent = S.me.name; $('#uEmail').textContent = S.me.email; $('#avatar').textContent = initials(S.me.name);
    const th = S.me.settings.theme || 'system';
    $('#themeBtn').innerHTML = `${icon(th === 'dark' ? 'moon' : th === 'light' ? 'sun' : 'monitor')}<span>Tema: ${th === 'dark' ? 'escuro' : th === 'light' ? 'claro' : 'sistema'}</span>`;
    $('#monthSw').style.display = S.route === 'configuracoes' ? 'none' : '';
    const closed = S.view && S.view.ym === S.ym && S.view.month.closed;
    $('#monthLbl').innerHTML = `${ymLabel(S.ym)}${closed ? icon('lock', 'lock') : ''}`;
    const acts = {
      'visao-geral': `<button class="btn" data-act="distribute">${icon('split')}<span class="act-txt">Distribuir</span></button><button class="btn primary" data-act="quick-add">${icon('plus')}<span class="act-txt">Lançar</span></button>`,
      caixas: `<button class="btn primary" data-act="box-new">${icon('plus')}<span class="act-txt">Nova caixa</span></button>`,
      cartoes: `<button class="btn" data-act="card-new">${icon('card')}<span class="act-txt">Novo cartão</span></button><button class="btn primary" data-act="purchase-new">${icon('plus')}<span class="act-txt">Nova compra</span></button>`,
      movimentacoes: `<button class="btn" data-act="transfer">${icon('transfer')}<span class="act-txt">Transferir</span></button><button class="btn primary" data-act="expense">${icon('plus')}<span class="act-txt">Gasto</span></button>`,
      planejamento: `<button class="btn primary" data-act="distribute">${icon('split')}<span class="act-txt">Distribuir</span></button>`,
      calendario: '', relatorios: `<button class="btn" data-act="export-menu">${icon('download')}<span class="act-txt">Exportar CSV</span></button>`, configuracoes: '',
    };
    $('#topActs').innerHTML = acts[S.route] || '';
  }

  let renderSeq = 0;
  async function renderPage(animate = false) {
    const seq = ++renderSeq; const page = $('#page'); if (!page) return;
    updateShell();
    try {
      if (!S.view || S.view.ym !== S.ym) await loadView();
      const html = await PAGES[S.route]();
      if (seq !== renderSeq) return;
      const y = scrollY; page.innerHTML = html;
      if (animate) { page.style.animation = 'none'; void page.offsetWidth; page.style.animation = ''; } else scrollTo(0, y);
      updateShell(); bindMoneyInputs(page); MOUNT[S.route] && MOUNT[S.route]();
    } catch (e) { if (seq === renderSeq) page.innerHTML = `<div class="empty"><div class="ico-tile">${icon('alert')}</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p><button class="btn" data-act="reload">Tentar novamente</button></div>`; }
  }
  async function refresh() { await loadView(); await renderPage(false); }
  const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); await refresh(); } catch (e) { toast(e.message, 'err'); } };

  // ───────────────────────────── Componentes ─────────────────────────────
  function segBar(boxes, total, { tall = false, legend = true } = {}) {
    const items = boxes.filter((b) => b.reserved > 0);
    const dist = items.reduce((s, b) => s + b.reserved, 0);
    const base = Math.max(total, dist, 1); const free = total - dist;
    let html = `<div class="seg ${tall ? 'tall' : ''}">` + items.map((b) => `<span style="flex-grow:${b.reserved};background:${b.color}" data-tip="${esc(`<b>${esc(b.name)}</b><br>${money(b.reserved)} · ${pct(b.reserved / base)}`)}"></span>`).join('');
    if (free > 0) html += `<span class="free" style="flex-grow:${free}" data-tip="${esc(`<b>Não distribuído</b><br>${money(free)} · ${pct(free / base)}`)}"></span>`;
    if (!items.length && free <= 0) html += `<span class="free" style="flex-grow:1"></span>`;
    html += '</div>';
    if (free < 0) html += `<div class="alert critical" style="margin-top:10px">${icon('alert')}<div>A distribuição ultrapassa os recursos em <b>${money(-free)}</b>.</div></div>`;
    if (legend) html += `<div class="legend">${items.map((b) => `<div class="it"><span class="sw" style="background:${b.color}"></span>${esc(b.name)} <b>${money(b.reserved)}</b></div>`).join('')}${free > 0 ? `<div class="it"><span class="sw free"></span>Não distribuído <b>${money(free)}</b></div>` : ''}</div>`;
    return html;
  }
  const tile = (b, cls = '') => `<div class="ico-tile ${cls}" style="background:${tint(b.color)};color:${b.color}">${icon(b.icon)}</div>`;
  function progOf(b) {
    if (b.type === 'pagamento') return b.planned > 0 ? (b.paid ? 1 : funds(b) / b.planned) : 0;
    if (b.type === 'consumo') { const f = funds(b); return f > 0 ? b.used / f : b.used > 0 ? 1.01 : 0; }
    if (b.type === 'meta') return b.target > 0 ? b.saldo / b.target : 0;
    return b.planned > 0 ? (b.reserved + b.tin - b.tout) / b.planned : (b.saldo > 0 ? 1 : 0);
  }
  function boxCard(b, { drag = false } = {}) {
    const p = progOf(b); const over = b.type === 'consumo' && p > 1;
    const T = TYPES[b.type];
    let main, mainL, rows, foot = '';
    if (b.type === 'pagamento') {
      main = money(b.planned); mainL = b.card_id ? `Fatura ${esc(b.card_name || '')}` : 'Valor da conta';
      rows = [['Reservado', money(funds(b))], ['Pago', money(b.used)], ['Falta reservar', money(Math.max(b.planned - funds(b), 0))]];
      foot = `<span>${b.due_date ? `Vence ${fdate(b.due_date)}` : 'Sem vencimento'}</span>${b.planned > 0 || b.paid ? statusBadge(b.status) : '<span class="badge">Sem valor</span>'}`;
    } else if (b.type === 'consumo') {
      main = money(b.saldo); mainL = 'disponível';
      rows = [['Reservado', money(funds(b))], ['Utilizado', money(b.used)], ['Planejado', money(b.planned)]];
      if (S.ym === curYm() && b.saldo > 0) { const left = daysIn(S.ym) - Number(todayISO().slice(8)) + 1; foot = `<span>${money(Math.floor(b.saldo / left))}/dia pelos próximos ${left} dias</span>`; }
      else foot = `<span>${pct(Math.min(p, 9.99))} utilizado</span>`;
    } else if (b.type === 'acumulacao') {
      main = money(b.saldo); mainL = 'acumulado';
      rows = [['Saldo anterior', money(b.opening)], ['Aporte no mês', money(b.reserved + b.tin)], ['Retiradas', money(b.used + b.tout)]];
      foot = `<span>${b.planned ? `Aporte planejado ${money(b.planned)}` : 'Preserva saldo entre meses'}</span>`;
    } else {
      main = money(b.saldo); mainL = `de ${money(b.target)}`;
      const rest = Math.max(b.target - b.saldo, 0);
      rows = [['Meta', money(b.target)], ['Faltam', money(rest)], ['Aporte no mês', money(b.reserved + b.tin)]];
      if (b.target_date && rest > 0) { const m = Math.max(ymDiff(S.ym, b.target_date.slice(0, 7)) + 1, 1); foot = `<span>${money(Math.ceil(rest / m))}/mês até ${fdate(b.target_date)}</span>`; }
      else foot = `<span>${rest <= 0 && b.target > 0 ? 'Meta atingida' : `${pct(Math.min(p, 1))} concluído`}</span>`;
    }
    return `<div class="box" style="--c:${b.color}" data-act="box-open" data-id="${b.id}" tabindex="0">
      <div class="box-h">${tile(b)}<div><div class="nm">${esc(b.name)}</div><div class="tp">${T.label}${b.recurring ? '' : ' · avulsa'}</div></div>
        ${drag ? `<button class="grip" data-grip title="Arrastar para reorganizar" aria-label="Arrastar">${icon('grip')}</button>` : ''}</div>
      <div class="saldo"><span class="v ${b.saldo < 0 ? 'neg' : ''}">${main}</span><span class="l">${mainL}</span></div>
      <div class="prog ${over ? 'over' : ''}"><span style="width:${Math.min(Math.max(p, 0), 1) * 100}%;background:${b.color}"></span></div>
      <div class="meta-row">${rows.map(([l, v]) => `<div><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
      <div class="foot">${foot}</div>
    </div>`;
  }
  const closedBanner = () => S.view.month.closed ? `<div class="banner">${icon('lock')}<div class="grow">Este mês foi fechado em ${fdate((S.view.month.closed_at || '').slice(0, 10))}. Os valores estão protegidos contra alterações.</div><button class="btn sm" data-act="month-reopen">${icon('unlock')}Reabrir mês</button></div>` : '';
  const alertsBlock = (alerts) => alerts.length ? `<div class="alerts">${alerts.map((a) => `<div class="alert ${a.level}">${icon('alert')}<div>${esc(a.text)}${a.code === 'over' ? ` Excesso de <b>${money(a.amount)}</b>.` : a.code === 'neg' ? ` Saldo: <b>${money(a.amount)}</b>.` : ''}</div></div>`).join('')}</div>` : '';

  // ───────────────────────────── Páginas ─────────────────────────────
  const PAGES = {};
  const MOUNT = {};

  // Linha de lista no estilo "app de banco": ícone grande, nome, detalhe e valor.
  function boxRow(b) {
    const p = Math.min(Math.max(progOf(b), 0), 1);
    const val = b.type === 'pagamento' ? b.planned : b.saldo;
    const nItems = (b.items || []).length;
    const sub = b.type === 'pagamento' ? (b.planned > 0 || b.paid ? `${nItems ? `${nItems} ${nItems === 1 ? 'item' : 'itens'} · ` : ''}${STATUS[b.status][0]}${b.due_date ? ` · vence ${fdateShort(b.due_date)}` : ''}` : 'Sem valor definido')
      : b.type === 'meta' ? `${pct(b.target ? b.saldo / b.target : 0)} de ${money(b.target)}` : b.type === 'consumo' ? `${money(b.used)} usados de ${money(funds(b))}` : `Acumulado · ${money(b.reserved + b.tin)} no mês`;
    return `<div class="lrow" data-act="box-open" data-id="${b.id}" tabindex="0">${tile(b, 'xl')}
      <div class="grow"><div class="nm">${esc(b.name)}</div><div class="sub ${b.status === 'vencido' ? 'neg' : ''}">${sub}</div>
        <div class="prog thin ${b.type === 'consumo' && progOf(b) > 1 ? 'over' : ''}"><span style="width:${p * 100}%;background:${b.color}"></span></div></div>
      <div class="val ${val < 0 ? 'neg' : ''}">${money(val)}</div></div>`;
  }
  const circ = (act, ic, label) => `<button class="circ" data-act="${act}"><span>${icon(ic)}</span>${label}</button>`;

  PAGES['visao-geral'] = async () => {
    const v = S.view, s = v.summary;
    if (!v.boxes.length && !v.incomes.length && !v.other_boxes.length) {
      return `<div class="card pad" style="margin-top:12px"><div class="empty"><div class="ico-tile">${icon('boxes')}</div><h3>Vamos organizar seu dinheiro</h3>
        <p>O método parte do seu salário: cada real recebido ganha um destino em uma caixa com finalidade. Comece com uma estrutura sugerida ou crie suas caixas do zero.</p>
        <div class="btn-row" style="justify-content:center"><button class="btn primary" data-act="onboard">${icon('sparkle')}Usar estrutura sugerida</button><button class="btn" data-act="box-new">${icon('plus')}Criar do zero</button></div></div></div>`;
    }
    const prevHint = !v.month.closed && v.month.prev_exists && !v.month.prev_closed && S.ym <= curYm()
      ? `<div class="banner">${icon('info')}<div class="grow">O mês de ${ymLabel(ymAdd(S.ym, -1))} ainda não foi fechado. Feche-o para levar as sobras e saldos para este mês.</div><button class="btn sm" data-act="goto-prev-close">Fechar ${MONTHS[Number(ymAdd(S.ym, -1).slice(5)) - 1].toLowerCase()}</button></div>` : '';
    const noSalary = !s.salary && !v.month.closed ? `<div class="banner">${icon('income')}<div class="grow">Nenhum salário registrado em ${ymLabel(S.ym).toLowerCase()}.</div><button class="btn sm primary" data-act="salary">Registrar salário</button></div>` : '';
    const upcoming = [
      ...v.boxes.filter((b) => b.type === 'pagamento' && !b.paid && b.planned > 0).map((b) => ({ date: b.due_date, name: b.name, amount: b.planned, status: b.status, b })),
      ...v.cards.filter((c) => !c.archived && !c.invoice.paid && c.invoice.total > 0 && !v.boxes.some((b) => b.card_id === c.id)).map((c) => ({ date: c.invoice.due_date, name: `Fatura ${c.name}`, amount: c.invoice.total, status: c.invoice.status, card: c })),
    ].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    const kpi = (l, val, sub = '', cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${val}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const lb = lastBackup(); const daysSince = lb ? Math.floor((Date.parse(todayISO()) - Date.parse(lb)) / 864e5) : null;
    const backupHint = daysSince == null || daysSince >= 14 ? `<div class="banner">${icon('shield')}<div class="grow">${lb ? `Seu último backup foi há ${daysSince} dias.` : 'Você ainda não fez nenhum backup.'} Seus dados ficam só neste aparelho — guarde uma cópia no app Arquivos ou no iCloud Drive.</div><button class="btn sm" data-act="backup-now">${icon('download')}Fazer backup</button></div>` : '';
    const orgCls = s.organization > 1 ? 'bad' : s.organization >= 0.999 ? 'ok' : 'neutral';
    const paidN = v.boxes.filter((b) => b.type === 'pagamento' && b.paid).length;
    const toPayN = v.boxes.filter((b) => b.type === 'pagamento' && !b.paid && b.planned > 0).length;
    return `<section class="hero">
        <button class="hero-l" data-act="toggle-hide" aria-label="${S.hide ? 'Mostrar valores' : 'Ocultar valores'}">Saldo financeiro atual ${icon(S.hide ? 'eyeoff' : 'eye')}</button>
        <div class="hero-v ${s.balance < 0 ? 'neg' : ''}">${money(s.balance)}</div>
        <span class="pill-tag ${orgCls}">${pct(s.organization)} do dinheiro organizado</span>
        <div class="circles">${circ('salary', 'income', 'Salário')}${circ('expense', 'expense', 'Gasto')}${circ('transfer', 'transfer', 'Transferir')}${circ('distribute', 'split', 'Distribuir')}</div>
      </section>
      ${closedBanner()}${prevHint}${noSalary}${backupHint}${alertsBlock(v.alerts)}
      <div class="sec-row"><h2>Não distribuído</h2><a data-act="distribute">Distribuir</a></div>
      <div class="flat-card" data-act="distribute"><div class="l">Ainda sem destino</div><div class="v ${s.undistributed < 0 ? 'neg' : ''}">${money(s.undistributed)}</div>
        <div style="margin-top:14px">${segBar(v.boxes, s.total_income, { legend: false })}</div></div>
      <div class="grid g-main" style="margin-top:8px">
        <div><div class="sec-row"><h2>Caixinhas</h2><a href="#/caixas">Ver todas</a></div>
          <div class="lrows">${v.boxes.length ? v.boxes.map(boxRow).join('') : '<div class="empty"><p>Nenhuma caixa neste mês.</p></div>'}</div></div>
        <div><div class="sec-row"><h2>Próximos compromissos</h2></div>
          <div class="flat-list">${upcoming.length ? upcoming.slice(0, 7).map((u) => `<div class="row" ${u.b ? `data-act="box-open" data-id="${u.b.id}"` : 'data-act="goto" data-to="cartoes"'} style="cursor:pointer"><div class="grow"><div class="t">${esc(u.name)}</div><div class="d">${u.date ? `Vence ${fdate(u.date)}` : 'Sem vencimento'}</div></div><div style="text-align:right"><div class="amt">${money(u.amount)}</div>${statusBadge(u.status)}</div></div>`).join('') : `<div class="empty" style="padding:20px"><p style="margin:0">Nenhuma conta pendente neste mês.</p></div>`}</div></div>
      </div>
      <div class="sec-row"><h2>Resumo do mês</h2></div>
      <div class="kpis">
        ${kpi('Salário mensal', money(s.salary), v.incomes.filter((i) => i.kind === 'salario').map((i) => `Recebido em ${fdateShort(i.date)}`)[0] || 'Não registrado')}
        ${kpi('Receitas extras', money(s.extras), s.carry_in ? `+ ${money(s.carry_in)} de sobras` : `${v.incomes.filter((i) => i.kind !== 'salario').length} lançamento(s)`)}
        ${kpi('Receita total', money(s.total_income), 'Salário + extras + sobras')}
        ${kpi('Distribuído', money(s.distributed), `${v.boxes.filter((b) => b.reserved > 0).length} de ${v.boxes.length} caixas`)}
        ${kpi('Contas pagas', `<span class="pos">${money(s.paid_total)}</span>`, `${paidN} conta(s)`)}
        ${kpi('Contas pendentes', `<span class="${s.pending_total ? 'warn' : ''}">${money(s.pending_total)}</span>`, s.overdue_count ? `<span class="neg">${s.overdue_count} vencida(s)</span>` : `${toPayN} a pagar`)}
        ${kpi('Gasto no mês', money(s.used_total), 'Gastos e pagamentos')}
        ${kpi('Vindo de meses anteriores', money(s.opening_total), 'Reservas e metas')}
      </div>
      <div class="bottom-bar"><div><div class="v ${s.undistributed < 0 ? 'neg' : ''}">${money(s.undistributed)}</div><div class="l">Não distribuído</div></div><button class="pill" data-act="quick-add">${icon('plus')}Lançar</button></div>`;
  };

  const GROUPS = { todas: () => true, usar: (b) => b.type === 'pagamento' || b.type === 'consumo', guardar: (b) => isPersistent(b.type) };
  PAGES.caixas = async () => {
    const v = S.view; const f = GROUPS[S.boxFilter] ? S.boxFilter : 'todas';
    const list = v.boxes.filter(GROUPS[f]);
    const total = list.reduce((a, b) => a + b.saldo, 0);
    const seg = (k, l) => `<button class="${f === k ? 'on' : ''}" data-act="box-filter" data-f="${k}">${l}</button>`;
    const heroL = f === 'guardar' ? 'Guardado nas caixas' : f === 'usar' ? 'Disponível para usar' : 'Total nas caixas';
    const heroS = f === 'usar' ? 'Contas a pagar e gastos do mês' : f === 'guardar' ? 'Reservas e metas — o saldo segue para os próximos meses' : `${list.length} caixas em ${ymLabel(S.ym).toLowerCase()}`;
    return `<div class="segm">${seg('todas', 'Todas')}${seg('usar', 'Usar')}${seg('guardar', 'Guardar')}</div>
      <div class="hero compact"><div class="hero-l" style="cursor:default">${heroL}</div><div class="hero-v ${total < 0 ? 'neg' : ''}">${money(total)}</div><span class="faint" style="font-size:13px">${heroS}</span></div>
      ${closedBanner()}${alertsBlock(v.alerts.filter((a) => a.code === 'neg'))}
      <div class="lrows only-mobile">${list.map(boxRow).join('') || '<div class="empty"><p>Nenhuma caixa aqui.</p></div>'}</div>
      <div class="only-desktop"><div class="sec-row"><span></span><span class="faint" style="font-size:12.5px">${f === 'todas' && list.length > 1 ? `${icon('grip')} Arraste pelo ícone para reorganizar` : ''}</span></div>
        <div class="boxes" id="boxGrid">${list.map((b) => boxCard(b, { drag: f === 'todas' })).join('')}
        <button class="box add" data-act="box-new">${icon('plus')}<span>Nova caixa</span></button></div></div>
      ${v.other_boxes.length ? `<div class="sec-row"><h2>Fora deste mês</h2></div>
        <div class="flat-list">${v.other_boxes.map((b) => `<div class="row">${tile(b, 'sm')}<div class="grow"><div class="t">${esc(b.name)}</div><div class="d">${TYPES[b.type].label}</div></div><button class="btn sm" data-act="box-add-month" data-id="${b.id}">${icon('plus')}Adicionar</button></div>`).join('')}</div>` : ''}
      <div class="bottom-bar"><div><div class="v">${money(v.summary.undistributed)}</div><div class="l">Não distribuído</div></div><button class="pill" data-act="box-new">Criar nova</button></div>`;
  };

  MOUNT.caixas = () => initDrag();

  PAGES.cartoes = async () => {
    const v = S.view; const cards = v.cards;
    if (!cards.length) return `<div class="card pad" style="margin-top:12px"><div class="empty"><div class="ico-tile">${icon('card')}</div><h3>Nenhum cartão cadastrado</h3><p>Cadastre seus cartões — inclusive os de outras pessoas em que você faz compras — para controlar faturas, parcelas e projeções.</p><button class="btn primary" data-act="card-new">${icon('plus')}Cadastrar cartão</button></div></div>`;
    if (!cards.find((c) => c.id === S.cardSel)) S.cardSel = (cards.find((c) => !c.archived) || cards[0]).id;
    const c = cards.find((x) => x.id === S.cardSel); const inv = c.invoice;
    const linked = v.boxes.find((b) => b.card_id === c.id);
    const maxProj = Math.max(inv.total, ...c.next.map((n) => n.total), 1);
    const totalOpen = cards.filter((x) => !x.archived).reduce((s, x) => s + x.invoice.total, 0);
    return `${closedBanner()}
      <div class="split3" style="margin-bottom:16px"><div><div class="l">Faturas de ${ymLabel(S.ym).toLowerCase()}</div><div class="v">${money(totalOpen)}</div></div>
        <div><div class="l">${icon('check')} Pagas</div><div class="v pos">${money(cards.filter((x) => x.invoice.paid).reduce((s, x) => s + x.invoice.total, 0))}</div></div>
        <div><div class="l">${icon('clock')} Em aberto</div><div class="v warn">${money(cards.filter((x) => !x.invoice.paid && !x.archived).reduce((s, x) => s + x.invoice.total, 0))}</div></div></div>
      <div class="cards-grid">${cards.map((x) => `<div class="ccard ${x.id === S.cardSel ? 'on' : ''}" style="--c:${x.color};${x.archived ? 'opacity:.55' : ''}" data-act="card-sel" data-id="${x.id}"><div class="stripe"></div>
        <div class="h"><div class="ico-tile sm" style="background:${tint(x.color)};color:${x.color}">${icon(x.third_party ? 'users' : 'card')}</div><div style="flex:1;min-width:0"><div class="nm">${esc(x.name)}</div><div class="faint" style="font-size:12px">${x.third_party ? `Cartão de terceiro${x.holder ? ` · ${esc(x.holder)}` : ''}` : (x.holder ? esc(x.holder) : 'Meu cartão')}</div></div>${x.archived ? '<span class="badge">Arquivado</span>' : statusBadge(x.invoice.total > 0 || x.invoice.paid ? x.invoice.status : null)}</div>
        <div><div class="faint" style="font-size:12px">Fatura de ${MONTHS[Number(S.ym.slice(5)) - 1].toLowerCase()}</div><div class="total">${money(x.invoice.total)}</div></div>
        <div class="dates"><span>Fecha <b>${fdateShort(x.invoice.closing_date)}</b></span><span>Vence <b>${fdateShort(x.invoice.due_date)}</b></span>${x.limit_amount ? `<span>Limite <b>${Charts.short(x.limit_amount)}</b></span>` : ''}</div></div>`).join('')}</div>

      <div class="grid g-main" style="margin-top:16px">
        <div class="card"><div class="card-h"><h2>Compras na fatura · ${esc(c.name)}</h2><span class="sub">${inv.purchases.length} item(ns)</span>
          <div class="r"><button class="btn sm" data-act="card-edit" data-id="${c.id}">${icon('edit')}Editar</button><button class="btn sm primary" data-act="purchase-new" data-card="${c.id}">${icon('plus')}Compra</button></div></div>
          <div class="card-b">${inv.purchases.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Compra</th><th>Parcela</th><th class="r">Total</th><th class="r">Nesta fatura</th><th></th></tr></thead><tbody>
            ${inv.purchases.map((p) => `<tr><td style="white-space:normal;min-width:140px"><div style="font-weight:550">${esc(p.description)}</div><div class="faint" style="font-size:12px">${fdate(p.date)}${p.category ? ` · ${esc(p.category)}` : ''}</div></td>
              <td>${p.installments > 1 ? `<span class="badge outline">${p.k}/${p.installments}</span><div class="faint" style="font-size:11.5px;margin-top:2px">${p.remaining ? `faltam ${p.remaining}` : 'última'}</div>` : '<span class="faint">À vista</span>'}</td>
              <td class="r faint">${money(p.amount)}</td><td class="r" style="font-weight:600">${money(p.value)}</td>
              <td class="r"><div class="btn-row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn ghost icon sm" data-act="purchase-edit" data-id="${p.id}" aria-label="Editar">${icon('edit')}</button><button class="btn ghost icon sm" data-act="purchase-del" data-id="${p.id}" aria-label="Excluir">${icon('trash')}</button></div></td></tr>`).join('')}
            </tbody><tfoot>${inv.adjustment ? `<tr><td colspan="3">Ajuste manual</td><td class="r">${money(inv.adjustment)}</td><td></td></tr>` : ''}<tr><td colspan="3">Total da fatura</td><td class="r">${money(inv.total)}</td><td></td></tr></tfoot></table></div>`
            : `<div class="empty"><p>Nenhuma compra nesta fatura.</p></div>`}</div></div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card"><div class="card-h"><h2>Pagamento da fatura</h2></div><div class="card-b">
            <div class="stat-line"><span class="l">Fechamento</span><span class="v">${fdate(inv.closing_date)}</span></div>
            <div class="stat-line"><span class="l">Vencimento</span><span class="v">${fdate(inv.due_date)}</span></div>
            <div class="stat-line"><span class="l">Status</span><span>${statusBadge(inv.status)}</span></div>
            <div class="stat-line"><span class="l">Caixa de pagamento</span><span class="v">${linked ? esc(linked.name) : '<span class="faint">Nenhuma vinculada</span>'}</span></div>
            ${inv.paid ? `<div class="stat-line"><span class="l">Pago em</span><span class="v">${fdate(inv.paid_at)}</span></div>` : ''}
            <div class="stat-line tot"><span class="l">Total</span><span class="v">${money(inv.total)}</span></div>
            <div class="btn-row" style="margin-top:12px">${inv.paid ? `<button class="btn" data-act="invoice-unpay" data-id="${c.id}">Desfazer pagamento</button>` : `<button class="btn primary" data-act="invoice-pay" data-id="${c.id}" ${inv.total <= 0 ? 'disabled' : ''}>${icon('check')}Pagar fatura</button>`}
              <button class="btn ghost" data-act="invoice-adjust" data-id="${c.id}">Ajuste manual</button></div>
            ${!linked ? `<div class="alert neutral" style="margin-top:12px">${icon('info')}<div>Vincule uma caixa de <b>Pagamento</b> a este cartão para reservar o valor da fatura no planejamento. As compras não são contadas duas vezes: só o pagamento da fatura sai do orçamento.</div></div>` : ''}
          </div></div>
          <div class="card"><div class="card-h"><h2>Projeção das próximas faturas</h2></div><div class="card-b">
            <div class="proj-bars">${[{ ym: S.ym, total: inv.total }, ...c.next].map((n, i) => `<div class="b" data-tip="${esc(`<b>${ymLabel(n.ym)}</b><br>${money(n.total)}`)}"><span class="vl">${n.total ? Charts.short(n.total) : '—'}</span><div class="bar" style="height:${(n.total / maxProj) * 82}%;--c:${i === 0 ? c.color : tint(c.color, 0.55)}"></div><span class="lb">${ymShort(n.ym)}</span></div>`).join('')}</div>
            <div class="faint" style="font-size:12px;margin-top:10px">Considera apenas parcelas já lançadas.</div>
          </div></div>
        </div>
      </div>`;
  };

  PAGES.movimentacoes = async () => {
    const v = S.view; const { transactions } = await api('GET', `/api/transactions?ym=${S.ym}`);
    const f = S.mv; const q = f.q.trim().toLowerCase();
    let items = [...transactions.map((t) => ({ ...t, _t: 'tx' })), ...v.incomes.map((i) => ({ ...i, kind: 'receita', _t: 'inc' }))];
    items = items.filter((t) => (!f.kind || t.kind === f.kind) && (!f.box || String(t.box_id) === f.box || String(t.to_box_id) === f.box) &&
      (!q || [t.description, t.box_name, t.to_box_name, t.card_name].some((x) => (x || '').toLowerCase().includes(q))));
    items.sort((a, b) => b.date.localeCompare(a.date) || (b.id - a.id));
    const totals = { receita: 0, gasto: 0, pagamento: 0, transferencia: 0, reserva: 0 };
    items.forEach((t) => { totals[t.kind] += t.amount; });
    const groups = {}; items.forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
    const row = (t) => {
      const color = t._t === 'inc' ? 'var(--green)' : t.box_color || '#8f8d86';
      const ic = t._t === 'inc' ? 'income' : t.kind === 'transferencia' ? 'transfer' : t.kind === 'reserva' ? 'split' : t.kind === 'pagamento' ? 'check' : (t.box_icon || 'expense');
      const title = t.description || (t._t === 'inc' ? (t.kind === 'salario' ? 'Salário' : 'Receita extra') : KIND[t.kind]);
      const sub = t._t === 'inc' ? (t.kind === 'salario' ? 'Salário' : 'Receita extra') : t.kind === 'transferencia' ? `${esc(t.box_name)} → ${esc(t.to_box_name)}` : `${KIND[t.kind]} · ${esc(t.box_name || '')}${t.card_name ? ` · ${esc(t.card_name)}` : ''}`;
      const sign = t._t === 'inc' ? '+' : (t.kind === 'gasto' || t.kind === 'pagamento') ? '−' : '';
      const cls = t._t === 'inc' ? 'pos' : '';
      return `<div class="row"><div class="ico-tile sm" style="background:${tint(color.startsWith('#') ? color : '#2e8b57')};color:${color}">${icon(ic)}</div>
        <div class="grow"><div class="t">${esc(title)}</div><div class="d">${sub}</div></div>
        <div class="amt ${cls}">${sign} ${money(Math.abs(t.amount))}${t.kind === 'reserva' && t.amount < 0 ? ' <span class="faint">(ajuste)</span>' : ''}</div>
        ${v.month.closed ? '' : `<div class="acts">${t.kind !== 'reserva' ? `<button class="btn ghost icon sm" data-act="${t._t === 'inc' ? 'income-edit' : 'tx-edit'}" data-id="${t.id}" aria-label="Editar">${icon('edit')}</button>` : ''}<button class="btn ghost icon sm" data-act="${t._t === 'inc' ? 'income-del' : 'tx-del'}" data-id="${t.id}" aria-label="Excluir">${icon('trash')}</button></div>`}</div>`;
    };
    const allBoxes = [...v.boxes];
    return `${closedBanner()}
      <div class="split3" style="margin-bottom:16px"><div><div class="l">${icon('income')} Receitas</div><div class="v pos">${money(totals.receita)}</div></div>
        <div><div class="l">${icon('expense')} Gastos e pagamentos</div><div class="v">${money(totals.gasto + totals.pagamento)}</div></div>
        <div><div class="l">${icon('transfer')} Transferências entre caixas</div><div class="v">${money(totals.transferencia)}</div></div></div>
      <div class="card"><div class="card-b">
        <div class="btn-row" style="margin-bottom:6px">
          <div class="money-wrap" style="flex:1;min-width:180px"><input class="inp sm" style="padding-left:12px" placeholder="Buscar descrição, caixa ou cartão" value="${esc(f.q)}" data-mv="q"></div>
          <select class="inp sm" style="width:auto" data-mv="kind"><option value="">Todos os tipos</option>${['receita', 'gasto', 'pagamento', 'transferencia', 'reserva'].map((k) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${KIND[k]}</option>`).join('')}</select>
          <select class="inp sm" style="width:auto" data-mv="box"><option value="">Todas as caixas</option>${allBoxes.map((b) => `<option value="${b.id}" ${f.box === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          ${csvBtn('movimentacoes', S.ym, 'CSV')}
        </div>
        ${items.length ? Object.entries(groups).map(([d, list]) => `<div class="day-h">${fdate(d)}</div><div class="list">${list.map(row).join('')}</div>`).join('') : `<div class="empty"><div class="ico-tile">${icon('list')}</div><h3>Nenhuma movimentação</h3><p>Registre gastos, transferências e receitas — tudo é salvo automaticamente.</p></div>`}
      </div></div>`;
  };

  PAGES.planejamento = async () => {
    const v = S.view, s = v.summary;
    const proj = (await api('GET', `/api/projection?ym=${S.ym}&n=6`)).months;
    const closed = v.month.closed;
    const isPast = S.ym < curYm();
    return `${closedBanner()}
      <div class="banner" style="background:var(--surface)">${icon(closed ? 'lock' : 'calendar')}<div class="grow"><b style="color:var(--text)">${ymLabel(S.ym)}</b> · ${closed ? 'Mês fechado' : isPast ? 'Mês anterior em aberto' : S.ym > curYm() ? 'Planejamento futuro' : 'Mês atual em aberto'}</div>
        ${closed ? '' : `<button class="btn sm" data-act="replicate">${icon('copy')}Replicar estrutura de ${MONTHS[Number(ymAdd(S.ym, -1).slice(5)) - 1].toLowerCase()}</button><button class="btn sm primary" data-act="month-close">${icon('lock')}Fechar mês</button>`}</div>
      ${alertsBlock(v.alerts.filter((a) => a.code === 'over'))}
      <div class="grid g-main">
        <div class="card"><div class="card-h"><h2>Receitas do mês</h2><div class="r">${closed ? '' : `<button class="btn sm" data-act="salary">${icon('income')}Salário</button><button class="btn sm" data-act="income-new">${icon('plus')}Extra</button>`}</div></div><div class="card-b"><div class="list">
          ${v.incomes.length ? v.incomes.map((i) => `<div class="row"><div class="ico-tile sm" style="background:var(--green-bg);color:var(--green)">${icon('income')}</div><div class="grow"><div class="t">${esc(i.description || (i.kind === 'salario' ? 'Salário' : 'Receita extra'))}</div><div class="d">${i.kind === 'salario' ? 'Salário' : 'Extra'} · ${fdate(i.date)}</div></div><div class="amt pos">${money(i.amount)}</div>
            ${closed ? '' : `<div class="acts"><button class="btn ghost icon sm" data-act="income-edit" data-id="${i.id}" aria-label="Editar">${icon('edit')}</button><button class="btn ghost icon sm" data-act="income-del" data-id="${i.id}" aria-label="Excluir">${icon('trash')}</button></div>`}</div>`).join('') : '<div class="empty" style="padding:20px"><p style="margin:0">Nenhuma receita registrada.</p></div>'}
          ${s.carry_in ? `<div class="row"><div class="ico-tile sm" style="background:var(--surface-2);color:var(--text-2)">${icon('repeat')}</div><div class="grow"><div class="t">Sobras do mês anterior</div><div class="d">Valores liberados no fechamento</div></div><div class="amt">${money(s.carry_in)}</div></div>` : ''}
        </div></div></div>
        <div class="card"><div class="card-h"><h2>Resumo</h2></div><div class="card-b">
          <div class="stat-line"><span class="l">Receita total</span><span class="v">${money(s.total_income)}</span></div>
          <div class="stat-line"><span class="l">Planejado nas caixas</span><span class="v">${money(s.planned_total)}</span></div>
          <div class="stat-line"><span class="l">Distribuído (reservado)</span><span class="v">${money(s.distributed)}</span></div>
          <div class="stat-line"><span class="l">Efetivamente gasto</span><span class="v">${money(s.used_total)}</span></div>
          <div class="stat-line"><span class="l">Disponível nas caixas</span><span class="v pos">${money(s.available)}</span></div>
          <div class="stat-line tot"><span class="l">Não distribuído</span><span class="v ${s.undistributed < 0 ? 'neg' : ''}">${money(s.undistributed)}</span></div>
          <div style="margin-top:12px">${segBar(v.boxes, s.total_income, { legend: false })}</div>
        </div></div>
      </div>

      <div class="sec-h"><h2>Planejado × realizado</h2><span class="sub">Edite o valor planejado de cada caixa — salvo automaticamente</span></div>
      <div class="card"><div class="card-b"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Caixa</th><th>Modalidade</th><th class="r" style="width:150px">Planejado</th><th class="r">Reservado</th><th class="r">Realizado</th><th class="r">Diferença</th><th class="r">Saldo</th></tr></thead><tbody>
        ${v.boxes.map((b) => { const exec = isPersistent(b.type) ? b.reserved + b.tin - b.tout : b.used; const diff = b.planned - exec;
          return `<tr><td><div class="cell-box">${tile(b, 'sm')}<span style="font-weight:550">${esc(b.name)}</span>${b.recurring ? `<span title="Recorrente" class="faint">${icon('repeat')}</span>` : ''}</div></td><td class="faint">${TYPES[b.type].label}</td>
          <td class="r">${b.card_id || (b.items || []).length ? `<span title="${b.card_id ? 'Valor da fatura vinculada' : 'Soma dos itens da conta'}" class="faint">${money(b.planned)}</span>` : closed ? money(b.planned) : `<div class="money-wrap"><input class="inp sm money" data-money inputmode="decimal" data-planned="${b.id}" value="${moneyInput(b.planned)}" placeholder="0,00"></div>`}</td>
          <td class="r">${money(b.reserved)}</td><td class="r">${money(exec)}</td><td class="r ${diff < 0 ? 'neg' : diff > 0 ? 'faint' : ''}">${diff === 0 ? '—' : (diff > 0 ? '' : '−') + money(Math.abs(diff))}</td><td class="r ${b.saldo < 0 ? 'neg' : ''}" style="font-weight:600">${money(b.saldo)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="2">Total</td><td class="r">${money(s.planned_total)}</td><td class="r">${money(s.distributed)}</td><td class="r">${money(v.boxes.reduce((a, b) => a + (isPersistent(b.type) ? b.reserved + b.tin - b.tout : b.used), 0))}</td><td></td><td class="r">${money(s.boxes_balance)}</td></tr></tfoot></table></div>
      <div class="faint" style="font-size:12px;margin-top:10px">Para Acumulação e Meta, “realizado” é o aporte do mês; para Pagamento e Consumo, o valor efetivamente gasto.</div></div></div>

      <div class="sec-h"><h2>Projeção dos próximos meses</h2><span class="sub">Compromissos já assumidos: parcelas de cartão e contas recorrentes</span></div>
      <div class="card"><div class="card-b"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mês</th><th class="r">Renda prevista</th><th class="r">Faturas de cartão</th><th class="r">Contas recorrentes</th><th class="r">Comprometido</th><th class="r">Livre</th><th class="r">Comprometimento</th><th></th></tr></thead><tbody>
        ${proj.map((m) => { const cards = m.cards.reduce((a, c) => a + c.total, 0); const bills = m.bills.reduce((a, c) => a + c.total, 0); const free = m.income - m.committed;
          return `<tr><td style="font-weight:550">${ymLabel(m.ym)}</td><td class="r">${money(m.income)}</td><td class="r">${money(cards)}</td><td class="r">${money(bills)}</td><td class="r" style="font-weight:600">${money(m.committed)}</td><td class="r ${free < 0 ? 'neg' : 'pos'}">${money(free)}</td>
          <td class="r">${m.ratio == null ? '—' : `<span class="badge ${m.ratio > 0.8 ? 'bad' : m.ratio > 0.5 ? 'pendente' : 'ok'}">${pct(m.ratio)}</span>`}</td><td class="r"><button class="btn ghost sm" data-act="goto-month" data-ym="${m.ym}">Planejar ${icon('right')}</button></td></tr>`; }).join('')}
      </tbody></table></div>${!S.me.settings.salary ? `<div class="faint" style="font-size:12px;margin-top:10px">Dica: defina seu salário padrão em Configurações para projetar a renda dos meses futuros.</div>` : ''}</div></div>

      <div class="sec-h"><h2>Anotações do mês</h2><span class="sub">Salvas automaticamente</span></div>
      <div class="card"><div class="card-b"><textarea class="ta-autosave" id="monthNotes" placeholder="Decisões, lembretes, ajustes previstos…" ${closed ? 'readonly' : ''}>${esc(v.month.notes)}</textarea></div></div>`;
  };
  MOUNT.planejamento = () => {
    $$('[data-planned]').forEach((inp) => inp.addEventListener('change', () => {
      const c = parseMoney(inp.value); if (!Number.isFinite(c) || c < 0) { toast('Valor planejado inválido.', 'err'); return; }
      run(() => api('PUT', `/api/boxes/${inp.dataset.planned}`, { ym: S.ym, planned: c }));
    }));
    const ta = $('#monthNotes'); let t;
    ta && ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api('PUT', `/api/month/${S.ym}/notes`, { notes: ta.value }).then(() => { S.view.month.notes = ta.value; }).catch((e) => toast(e.message, 'err')), 700); });
  };

  PAGES.calendario = async () => {
    const { events } = await api('GET', `/api/calendar?ym=${S.ym}`);
    const first = new Date(Number(S.ym.slice(0, 4)), Number(S.ym.slice(5)) - 1, 1).getDay();
    const n = daysIn(S.ym); const today = todayISO();
    const byDay = {}; events.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    if (S.calDay && S.calDay.slice(0, 7) !== S.ym) S.calDay = null;
    let cells = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<div class="wd">${d}</div>`).join('');
    for (let i = 0; i < first; i++) cells += '<div class="d out"></div>';
    for (let d = 1; d <= n; d++) {
      const iso = `${S.ym}-${pad(d)}`; const ev = byDay[iso] || [];
      cells += `<div class="d ${iso === today ? 'today' : ''} ${iso === S.calDay ? 'sel' : ''}" data-act="cal-day" data-d="${iso}"><span class="n">${d}</span>
        ${ev.slice(0, 3).map((e) => `<div class="ev ${e.status}" data-tip="${esc(`<b>${esc(e.title)}</b><br>${e.amount != null ? money(e.amount) + ' · ' : ''}${STATUS[e.status] ? STATUS[e.status][0] : ''}`)}"><span class="dt" style="background:currentColor"></span><span class="tx">${esc(e.title)}</span></div>`).join('')}
        ${ev.length > 3 ? `<div class="ev more">+${ev.length - 3}</div>` : ''}</div>`;
    }
    const rest = (7 - ((first + n) % 7)) % 7; for (let i = 0; i < rest; i++) cells += '<div class="d out"></div>';
    const list = S.calDay ? byDay[S.calDay] || [] : events;
    const TL = { recebimento: 'Recebimento', vencimento: 'Vencimento', fatura: 'Fatura', parcela: 'Parcela', pagamento: 'Pagamento realizado', fechamento: 'Fechamento da fatura', meta: 'Prazo da meta' };
    const count = (st) => events.filter((e) => e.status === st && e.type !== 'parcela').length;
    return `<div class="grid g-main">
      <div class="card"><div class="card-b">
        <div class="cal-legend" style="margin-bottom:12px">${statusBadge('pago')}${statusBadge('pendente')}${statusBadge('vencido')}${statusBadge('recebido')}${statusBadge('info')}</div>
        <div class="cal">${cells}</div></div></div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="split3" style="grid-template-columns:repeat(3,1fr)"><div><div class="l">Pagos</div><div class="v pos">${count('pago')}</div></div><div><div class="l">Pendentes</div><div class="v warn">${count('pendente')}</div></div><div><div class="l">Vencidos</div><div class="v neg">${count('vencido')}</div></div></div>
        <div class="card"><div class="card-h"><h2>${S.calDay ? fdate(S.calDay) : 'Agenda do mês'}</h2>${S.calDay ? `<div class="r"><button class="btn ghost sm" data-act="cal-day" data-d="">Ver mês inteiro</button></div>` : ''}</div><div class="card-b"><div class="list">
          ${list.length ? list.map((e) => `<div class="row"><div class="grow"><div class="t">${esc(e.title)}</div><div class="d">${TL[e.type] || e.type}${S.calDay ? '' : ` · ${fdate(e.date)}`}</div></div><div style="text-align:right">${e.amount != null ? `<div class="amt">${money(e.amount)}</div>` : ''}${statusBadge(e.status)}</div></div>`).join('') : '<div class="empty" style="padding:20px"><p style="margin:0">Nenhum evento.</p></div>'}
        </div></div></div>
      </div></div>`;
  };

  PAGES.relatorios = async () => {
    const r = await api('GET', `/api/reports?ym=${S.ym}`);
    const labels = r.months.map((m) => ymShort(m.ym));
    const persistent = new Map(); r.months.forEach((m) => m.reserves.forEach((x) => persistent.set(x.id, x)));
    const resSeries = [...persistent.values()].map((b) => ({ name: b.name, color: b.color, values: r.months.map((m) => (m.reserves.find((x) => x.id === b.id) || { saldo: 0 }).saldo) }));
    const resChart = resSeries.length > 4 ? [{ name: 'Total em reservas e metas', color: '#008300', values: r.months.map((m) => m.reserves_total) }] : resSeries;
    const legend = (ss) => ss.length > 1 ? `<div class="legend" style="margin-top:6px">${ss.map((s) => `<div class="it"><span class="sw" style="background:${s.color}"></span>${esc(s.name)} <b>${money(s.values[s.values.length - 1])}</b></div>`).join('')}</div>` : '';
    const cmp = [{ name: 'Receita', color: '#2a78d6', values: r.months.map((m) => m.income) }, { name: 'Distribuído', color: '#1baf7a', values: r.months.map((m) => m.distributed) }, { name: 'Gasto', color: '#eb6834', values: r.months.map((m) => m.used) }];
    const catMax = Math.max(1, ...r.categories.map((c) => c.value)); const catTot = r.categories.reduce((s, c) => s + c.value, 0);
    const distTot = r.distribution.reduce((s, d) => s + d.value, 0);
    const pvMax = Math.max(1, ...r.plan_vs_real.flatMap((p) => [p.planned, p.executed]));
    const cm = r.commitment;
    const stackDefs = new Map();
    cm.forEach((m) => { m.cards.forEach((c) => stackDefs.set(`c${c.id}`, { name: /^cart[ãa]o/i.test(c.name) ? c.name : `Cartão ${c.name}`, color: c.color })); m.bills.forEach((b) => stackDefs.set(`b${b.id}`, { name: b.name, color: b.color })); });
    const stacks = [...stackDefs.entries()].map(([k, d]) => ({ ...d, values: cm.map((m) => { const src = k[0] === 'c' ? m.cards.find((c) => `c${c.id}` === k) : m.bills.find((b) => `b${b.id}` === k); return src ? src.total : 0; }) })).filter((s) => s.values.some((x) => x > 0));
    const s = r.summary;
    return `<div class="kpis" style="margin-bottom:16px">
        <div class="kpi"><div class="l">Receita do mês</div><div class="v">${money(s.total_income)}</div></div>
        <div class="kpi"><div class="l">Distribuído</div><div class="v">${money(s.distributed)}</div><div class="s">${pct(s.organization)} da receita</div></div>
        <div class="kpi"><div class="l">Gasto</div><div class="v">${money(s.used_total)}</div><div class="s">${s.total_income ? pct(s.used_total / s.total_income) : '—'} da receita</div></div>
        <div class="kpi"><div class="l">Reservas e metas</div><div class="v pos">${money(r.months[r.months.length - 1].reserves_total)}</div></div></div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h2>Distribuição mensal do salário</h2><span class="sub">${ymLabel(S.ym)}</span></div><div class="card-b">
          ${r.distribution.length ? `${segBar(r.distribution.map((d) => ({ ...d, reserved: d.value })), s.total_income, { legend: false, tall: true })}
          <div class="hbar" style="margin-top:16px">${r.distribution.map((d) => `<div class="n"><span class="dotc" style="background:${d.color}"></span>${esc(d.name)}</div><div class="faint num" style="font-size:12px">${pct(d.value / Math.max(s.total_income, distTot, 1))}</div><div class="v">${money(d.value)}</div>`).join('')}</div>` : '<div class="empty"><p>Nenhuma distribuição neste mês.</p></div>'}
        </div></div>
        <div class="card"><div class="card-h"><h2>Gastos por categoria</h2><span class="sub">${money(catTot)}</span></div><div class="card-b">
          ${r.categories.length ? `<div class="hbar">${r.categories.map((c) => `<div class="n" title="${esc(c.name)}"><span class="dotc" style="background:${c.color}"></span>${esc(c.name)}</div><div class="tr"><div class="fl" style="width:${(c.value / catMax) * 100}%;background:${c.color}" data-tip="${esc(`<b>${esc(c.name)}</b><br>${money(c.value)} · ${pct(c.value / catTot)}`)}"></div></div><div class="v">${money(c.value)}</div>`).join('')}</div>
          <div class="faint" style="font-size:12px;margin-top:12px">Compras no cartão entram pela parcela da fatura do mês, na categoria informada; o pagamento da fatura não é somado de novo.</div>` : '<div class="empty"><p>Nenhum gasto registrado neste mês.</p></div>'}
        </div></div>
        <div class="card"><div class="card-h"><h2>Evolução das reservas</h2><span class="sub">Acumulação e metas · 6 meses</span></div><div class="card-b">
          ${resChart.length ? Charts.line({ labels, series: resChart }) + legend(resChart) : '<div class="empty"><p>Crie caixas de Acumulação ou Meta para acompanhar a evolução.</p></div>'}
        </div></div>
        <div class="card"><div class="card-h"><h2>Comparação entre meses</h2></div><div class="card-b">
          ${Charts.bars({ labels, series: cmp })}${legend(cmp)}
        </div></div>
        <div class="card"><div class="card-h"><h2>Comprometimento da renda futura</h2><span class="sub">Próximos 6 meses</span></div><div class="card-b">
          ${stacks.length ? Charts.commit({ labels: cm.map((m) => ymShort(m.ym)), stacks, income: cm.map((m) => m.income) }) + `<div class="legend" style="margin-top:6px">${stacks.map((x) => `<div class="it"><span class="sw" style="background:${x.color}"></span>${esc(x.name)}</div>`).join('')}<div class="it"><span style="width:14px;border-top:2px dashed var(--text)"></span>Renda prevista</div></div>` : '<div class="empty"><p>Sem compromissos futuros registrados (parcelas ou contas recorrentes).</p></div>'}
        </div></div>
        <div class="card"><div class="card-h"><h2>Planejamento × execução</h2><span class="sub">${ymLabel(S.ym)}</span></div><div class="card-b">
          ${r.plan_vs_real.length ? `<div class="pv">${r.plan_vs_real.map((p) => { const d = p.executed - p.planned;
            return `<div class="n" style="display:flex;align-items:center;gap:8px;min-width:0"><span class="dotc" style="background:${p.color}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span></div>
            <div class="bars" data-tip="${esc(`<b>${esc(p.name)}</b><div class='tr'><span>Planejado</span><b>${money(p.planned)}</b></div><div class='tr'><span>Executado</span><b>${money(p.executed)}</b></div>`)}"><span class="pl" style="width:${(p.planned / pvMax) * 100}%"></span><span style="width:${(p.executed / pvMax) * 100}%;background:${p.color}"></span></div>
            <div class="num" style="font-size:12.5px;text-align:right;white-space:nowrap">${d === 0 ? '<span class="faint">—</span>' : `<span class="${d > 0 && !isPersistent(p.type) ? 'neg' : 'faint'}">${d > 0 ? '+' : '−'}${money(Math.abs(d))}</span>`}</div>`; }).join('')}</div>
          <div class="legend"><div class="it"><span class="sw" style="background:var(--surface-3);box-shadow:inset 0 0 0 1px var(--border-strong)"></span>Planejado</div><div class="it"><span class="sw" style="background:var(--text-2)"></span>Executado (cor da caixa)</div></div>` : '<div class="empty"><p>Sem caixas neste mês.</p></div>'}
        </div></div>
      </div>
      <div class="sec-h"><h2>Tabela mensal</h2></div>
      <div class="card"><div class="card-b"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mês</th><th class="r">Salário</th><th class="r">Extras</th><th class="r">Planejado</th><th class="r">Distribuído</th><th class="r">Gasto</th><th class="r">Reservas</th></tr></thead><tbody>
        ${r.months.map((m) => `<tr><td>${ymLabel(m.ym)}</td><td class="r">${money(m.salary)}</td><td class="r">${money(m.extras)}</td><td class="r">${money(m.planned)}</td><td class="r">${money(m.distributed)}</td><td class="r">${money(m.used)}</td><td class="r">${money(m.reserves_total)}</td></tr>`).join('')}
      </tbody></table></div></div></div>`;
  };

  PAGES.configuracoes = async () => {
    const st = S.me.settings;
    return `<div class="card pad" style="margin-top:8px">
      <div class="settings-sec"><div><h3>Perfil</h3><p>Seu nome de exibição.</p></div><form class="form" id="fProfile" style="max-width:420px">${tField('name', 'Nome', S.me.name)}${tField('email', 'E-mail', S.me.email, { attrs: 'disabled' })}<div><button class="btn primary">Salvar perfil</button></div></form></div>
      <div class="settings-sec"><div><h3>Salário padrão</h3><p>Usado para pré-preencher o registro do salário e projetar a renda dos meses futuros.</p></div>
        <form class="form" id="fSalary" style="max-width:420px"><div class="r2">${mField('salary', 'Valor líquido mensal', st.salary || 0)}${tField('salary_day', 'Dia do recebimento', st.salary_day || 5, { type: 'number', attrs: 'min="1" max="31"' })}</div>${tField('salary_desc', 'Descrição', st.salary_desc || 'Salário')}<div><button class="btn primary">Salvar</button></div></form></div>
      <div class="settings-sec"><div><h3>Aparência</h3><p>Modo claro, escuro ou automático conforme o sistema.</p></div>
        <div class="type-tabs">${[['system', 'Sistema', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']].map(([k, l, ic]) => `<button class="chip ${(st.theme || 'system') === k ? 'on' : ''}" data-act="theme-set" data-t="${k}">${icon(ic)}${l}</button>`).join('')}</div></div>
      <div class="settings-sec"><div><h3>Exportar dados</h3><p>Arquivos CSV compatíveis com Excel e Planilhas (separador “;”, valores em reais).</p></div>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:520px">
          ${[['movimentacoes', 'Movimentações', 'Distribuições, gastos, pagamentos e transferências'], ['receitas', 'Receitas', 'Salários e receitas extras'], ['caixas', 'Caixas do mês', `Situação de cada caixa em ${ymLabel(S.ym).toLowerCase()}`], ['cartoes', 'Compras no cartão', 'Todas as compras e parcelamentos']].map(([k, l, d]) =>
            `<div class="row" style="border-top:1px solid var(--border);flex-wrap:wrap"><div class="grow" style="min-width:180px"><div class="t">${l}</div><div class="d">${d}</div></div>${k === 'caixas' || k === 'cartoes' ? '' : csvBtn(k, S.ym, 'Mês atual')}${csvBtn(k, k === 'caixas' ? S.ym : '', k === 'caixas' ? 'Baixar' : 'Tudo')}</div>`).join('')}
        </div></div>
      <div class="settings-sec"><div><h3>Backup</h3><p>Seus dados ficam só neste aparelho. Gere um backup de vez em quando e guarde no app Arquivos ou no iCloud Drive.</p></div>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:520px">
          <div class="faint" style="font-size:13px">${lastBackup() ? `Último backup: ${fdate(lastBackup())}` : 'Nenhum backup feito ainda.'}</div>
          <div class="btn-row"><button type="button" class="btn primary" data-act="backup-now">${icon('download')}Fazer backup agora</button><button type="button" class="btn" data-act="backup-restore">${icon('repeat')}Restaurar backup</button></div>
        </div></div>
      <div class="settings-sec"><div><h3>Apagar dados</h3><p>Remove permanentemente todos os dados deste aparelho.</p></div><div><button class="btn danger" data-act="reset-all">${icon('trash')}Apagar todos os dados</button></div></div>
    </div>`;
  };
  MOUNT.configuracoes = () => {
    const on = (id, fn) => { const f = $(id); f && f.addEventListener('submit', async (e) => { e.preventDefault(); try { await fn(formData(f), f); } catch (ex) { toast(ex.message, 'err'); } }); };
    on('#fProfile', async (d) => { const r = await api('PUT', '/api/me', { name: d.name }); S.me.name = r.name; updateShell(); toast('Perfil atualizado'); });
    on('#fSalary', async (d) => { const r = await api('PUT', '/api/me', { settings: { salary: needMoney(d.salary, 'Salário', { allowZero: true }), salary_day: Number(d.salary_day), salary_desc: d.salary_desc } }); S.me.settings = r.settings; toast('Salário padrão salvo'); });
  };

  // ───────────────────────────── Formulários / fluxos ─────────────────────────────
  function guardOpen() { if (S.view.month.closed) { toast('Este mês está fechado. Reabra-o para editar.', 'err'); return false; } return true; }

  function boxForm(b) {
    const isNew = !b; b = b || { name: '', icon: 'box', color: COLORS[S.view.boxes.length % COLORS.length], type: 'consumo', planned: 0, default_planned: 0, recurring: 1, due_day: '', target: 0, target_date: '', notes: '', card_id: null };
    const cards = S.view.cards.filter((c) => !c.archived);
    const body = `<div class="form">
      ${tField('name', 'Nome da caixa', b.name, { attrs: 'maxlength="60" placeholder="Ex.: Alimentação" autofocus' })}
      <div class="field"><label>Modalidade</label><div class="seg-ctl">${Object.entries(TYPES).map(([k, t]) => `<label><input type="radio" name="type" value="${k}" ${b.type === k ? 'checked' : ''}><span class="t">${icon(t.icon)}${t.label}</span><span class="d">${t.desc}</span></label>`).join('')}</div></div>
      <div class="r2">${mField('planned', `Valor planejado em ${MONTHS[Number(S.ym.slice(5)) - 1].toLowerCase()}`, b.planned_manual ?? b.planned, (b.items || []).length ? { hint: 'Calculado pela soma dos itens da conta.', attrs: 'disabled' } : { hint: '' })}${mField('default_planned', 'Valor padrão (meses seguintes)', b.default_planned, { hint: 'Usado nas caixas recorrentes.' })}</div>
      <label class="check"><input type="checkbox" name="recurring" ${b.recurring ? 'checked' : ''}><span>Caixa recorrente<span class="hint">Aparece automaticamente em todos os meses seguintes.</span></span></label>
      <div class="r2" data-show="pagamento">${tField('due_day', 'Dia de vencimento', b.due_day || '', { type: 'number', attrs: 'min="1" max="31" placeholder="Ex.: 10"' })}
        <div class="field"><label>Cartão vinculado</label><select class="inp" name="card_id"><option value="">Nenhum</option>${cards.map((c) => `<option value="${c.id}" ${b.card_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><div class="hint">O valor planejado passa a ser o total da fatura.</div></div></div>
      <div class="r2" data-show="meta">${mField('target', 'Valor-alvo da meta', b.target)}${tField('target_date', 'Prazo (opcional)', b.target_date || '', { type: 'date' })}</div>
      <div class="field"><label>Ícone</label><div class="icon-pick">${BOX_ICONS.map((ic) => `<label title="${ic}"><input type="radio" name="icon" value="${ic}" ${b.icon === ic ? 'checked' : ''}>${icon(ic)}</label>`).join('')}</div></div>
      <div class="field"><label>Cor</label><div class="color-pick">${COLORS.map((c) => `<label style="background:${c}"><input type="radio" name="color" value="${c}" ${b.color === c ? 'checked' : ''}></label>`).join('')}
        <label class="custom" title="Cor personalizada" style="${!COLORS.includes(b.color) ? `background:${b.color}` : ''}"><input type="radio" name="color" value="${b.color}" id="customColorR" ${!COLORS.includes(b.color) ? 'checked' : ''}>${COLORS.includes(b.color) ? icon('plus') : ''}<input type="color" id="customColor" value="${b.color}"></label></div></div>
      <div class="field"><label>Observações</label><textarea class="inp" name="notes" maxlength="2000" placeholder="Regras, combinados, detalhes…">${esc(b.notes)}</textarea></div>
    </div>`;
    modal({
      title: isNew ? 'Nova caixa' : 'Editar caixa', body, size: 'wide', submit: isNew ? 'Criar caixa' : 'Salvar',
      onOpen: (f) => {
        const sync = () => { const t = f.querySelector('input[name=type]:checked').value; $$('[data-show]', f).forEach((el) => el.classList.toggle('hide', el.dataset.show !== t)); };
        f.addEventListener('change', (e) => { if (e.target.name === 'type') sync(); }); sync();
        const cc = $('#customColor', f); cc.addEventListener('input', () => { const r = $('#customColorR', f); r.value = cc.value; r.checked = true; cc.parentElement.style.background = cc.value; cc.parentElement.querySelector('svg')?.remove(); });
        if (S.view.month.closed) f.querySelector('input[name=planned]').disabled = true;
      },
      onSubmit: async (d) => {
        const payload = { ym: S.ym, name: d.name, type: d.type, icon: d.icon || 'box', color: d.color, recurring: d.recurring, notes: d.notes,
          default_planned: needMoney(d.default_planned, 'Valor padrão', { allowZero: true }),
          due_day: d.type === 'pagamento' && d.due_day ? Number(d.due_day) : null, card_id: d.type === 'pagamento' && d.card_id ? Number(d.card_id) : null,
          target: d.type === 'meta' ? needMoney(d.target, 'Valor-alvo', { allowZero: true }) : 0, target_date: d.type === 'meta' ? d.target_date || null : null };
        if (d.planned !== undefined) payload.planned = needMoney(d.planned, 'Valor planejado', { allowZero: true });
        if (!payload.name.trim()) throw new Error('Informe o nome da caixa.');
        if (isNew) { if (!guardOpen()) return false; await api('POST', '/api/boxes', payload); toast('Caixa criada'); }
        else { await api('PUT', `/api/boxes/${b.id}`, payload); toast('Caixa atualizada'); }
        await refresh();
      },
    });
  }

  // Itens que compõem uma conta (caixas de Pagamento sem cartão vinculado).
  function itemsSection(b, closed) {
    if (b.type !== 'pagamento' || b.card_id) return '';
    const items = b.items || []; const locked = closed || b.paid;
    const rows = items.map((i) => `<div class="row"><div class="grow"><div class="t">${esc(i.description)}</div></div><div class="amt">${money(i.amount)}</div>
      ${locked ? '' : `<div class="acts" style="opacity:1"><button type="button" class="btn ghost icon sm" data-act="item-edit" data-box="${b.id}" data-item="${i.id}" aria-label="Editar item">${icon('edit')}</button><button type="button" class="btn ghost icon sm" data-act="item-del" data-box="${b.id}" data-item="${i.id}" aria-label="Excluir item">${icon('trash')}</button></div>`}</div>`).join('');
    return `<div class="sec-row" style="margin:22px 0 6px"><h2>Itens da conta</h2>${locked ? '' : `<span class="btn-row"><button type="button" class="btn sm" data-act="item-paste" data-box="${b.id}">${icon('copy')}Colar lista</button><button type="button" class="btn sm" data-act="item-add" data-box="${b.id}">${icon('plus')}Item</button></span>`}</div>
      <div class="flat-list">${items.length ? `${rows}<div class="row"><div class="grow"><div class="t">Total</div></div><div class="amt" style="font-size:16px">${money(items.reduce((s, i) => s + i.amount, 0))}</div>${locked ? '' : '<div class="acts" style="opacity:0;width:64px"></div>'}</div>`
        : `<div class="empty" style="padding:18px 0"><p style="margin:0">Detalhe o que compõe esta conta (ex.: compras, parcelas). O valor da conta passa a ser a soma dos itens.</p></div>`}</div>
      ${b.paid && !closed ? '<div class="faint" style="font-size:12.5px;margin-top:6px">Conta paga: desfaça o pagamento para alterar os itens.</div>' : ''}`;
  }
  // Lê linhas como "SHEIN: 436,05" ou "Airbnb - R$ 130". Ignora a linha de total.
  function parseItemList(text) {
    const items = []; const bad = []; let total = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const m = line.match(/^(.*?)[\s:=–—-]*(?:R\$)?\s*(-?\d[\d.,]*)\s*$/i);
      const desc = m ? m[1].replace(/[\s:=–—-]+$/, '').trim() : '';
      const val = m ? parseMoney(m[2]) : NaN;
      if (!m || !desc || !Number.isFinite(val) || val <= 0) { bad.push(line); continue; }
      if (/^(total|soma)$/i.test(desc)) { total = val; continue; }
      items.push({ description: desc, amount: val });
    }
    return { items, bad, total };
  }
  async function reopenBox(id) { closeAllModals(); await refresh(); boxDetail(id); }
  function itemForm(boxId, item) {
    modal({ title: item ? 'Editar item' : 'Novo item', submit: item ? 'Salvar' : 'Adicionar',
      body: `<div class="form">${tField('description', 'Descrição', item ? item.description : '', { attrs: 'maxlength="120" placeholder="Ex.: SHEIN" autofocus' })}${mField('amount', 'Valor', item ? item.amount : 0)}</div>`,
      onSubmit: async (d) => {
        const p = { ym: S.ym, description: d.description, amount: needMoney(d.amount, 'Valor') };
        if (item) await api('PUT', `/api/boxes/${boxId}/items/${item.id}`, p); else await api('POST', `/api/boxes/${boxId}/items`, p);
        await reopenBox(boxId);
      } });
  }
  function itemPasteForm(boxId) {
    modal({ title: 'Colar lista de itens', submit: 'Adicionar itens', size: 'wide',
      body: `<div class="form"><div class="field"><label>Uma linha por item: descrição e valor</label><textarea class="inp" name="text" rows="8" placeholder="SHEIN: 436,05&#10;TIKTOK SHOP: 86,10&#10;AIRBNB: 130&#10;total: 652,15" autofocus></textarea><div class="hint">A linha de “total” é usada só para conferir a soma.</div></div><div id="pastePrev"></div></div>`,
      onOpen: (f) => {
        const ta = f.querySelector('textarea');
        const upd = () => {
          const r = parseItemList(ta.value); const sum = r.items.reduce((s, i) => s + i.amount, 0);
          $('#pastePrev', f).innerHTML = !ta.value.trim() ? '' : `<div class="alert ${r.bad.length || (r.total != null && r.total !== sum) ? 'warning' : 'info'}">${icon(r.bad.length ? 'alert' : 'check')}<div>
            <b>${r.items.length} item(ns)</b> · soma ${money(sum)}${r.total != null ? (r.total === sum ? ' — confere com o total informado' : ` — <b>diferente</b> do total informado (${money(r.total)})`) : ''}
            ${r.bad.length ? `<br>Linhas não entendidas: ${r.bad.map(esc).join(' · ')}` : ''}</div></div>`;
        };
        ta.addEventListener('input', upd);
      },
      onSubmit: async (d) => {
        const r = parseItemList(d.text); if (!r.items.length) throw new Error('Nenhum item encontrado. Use o formato “descrição: valor”, um por linha.');
        await api('POST', `/api/boxes/${boxId}/items`, { ym: S.ym, items: r.items });
        toast(`${r.items.length} item(ns) adicionados`); await reopenBox(boxId);
      } });
  }

  async function boxDetail(id) {
    const b = S.view.boxes.find((x) => x.id === id); if (!b) return;
    const T = TYPES[b.type]; const closed = S.view.month.closed;
    let special = '';
    if (b.type === 'pagamento') {
      special = `<div class="alert ${b.status === 'pago' ? 'info' : b.status === 'vencido' ? 'critical' : 'warning'}" style="margin-top:14px">${icon(b.status === 'pago' ? 'check' : 'clock')}<div>${b.paid ? `Pago em ${fdate(b.paid_at)} · ${money(b.used)}` : `${b.due_date ? `Vence em ${fdate(b.due_date)}` : 'Sem data de vencimento'} · ${funds(b) >= b.planned ? 'Valor totalmente reservado' : `Faltam ${money(b.planned - funds(b))} para cobrir a conta`}`}${b.card_id ? ` · Fatura do cartão ${esc(b.card_name)}` : ''}</div></div>`;
    } else if (b.type === 'consumo') {
      const left = S.ym === curYm() ? daysIn(S.ym) - Number(todayISO().slice(8)) + 1 : null;
      special = `<div class="alert neutral" style="margin-top:14px">${icon('info')}<div>${funds(b) ? `${pct(b.used / Math.max(funds(b), 1))} do valor reservado já foi utilizado.` : 'Nenhum valor reservado ainda.'}${left && b.saldo > 0 ? ` Você pode gastar em média <b>${money(Math.floor(b.saldo / left))}</b> por dia até o fim do mês.` : ''}</div></div>`;
    } else if (b.type === 'meta') {
      const rest = Math.max(b.target - b.saldo, 0); const m = b.target_date ? Math.max(ymDiff(S.ym, b.target_date.slice(0, 7)) + 1, 1) : null;
      special = `<div style="margin-top:14px"><div class="prog" style="height:10px"><span style="width:${Math.min(b.target ? b.saldo / b.target : 0, 1) * 100}%;background:${b.color}"></span></div>
        <div class="stat-line"><span class="l">${pct(b.target ? b.saldo / b.target : 0)} da meta de ${money(b.target)}</span><span class="v">${rest ? `Faltam ${money(rest)}` : 'Meta atingida 🎯'}</span></div>
        ${m && rest ? `<div class="faint" style="font-size:12.5px">Para atingir até ${fdate(b.target_date)}: ${money(Math.ceil(rest / m))} por mês durante ${m} mês(es).</div>` : ''}</div>`;
    } else {
      special = `<div class="alert info" style="margin-top:14px">${icon('repeat')}<div>Caixa de acumulação: o saldo de <b>${money(b.saldo)}</b> segue automaticamente para o próximo mês.</div></div>`;
    }
    const kv = [['Planejado', b.planned], ['Saldo inicial', b.opening], ['Reservado no mês', b.reserved], ['Transferências', b.tin - b.tout], ['Utilizado', b.used], ['Saldo', b.saldo]];
    const m = modal({
      title: `<span style="display:flex;align-items:center;gap:12px">${tile(b)}<span><span style="display:block">${esc(b.name)}</span><span class="faint" style="font-size:12.5px;font-weight:500">${T.label} · ${T.desc}</span></span></span>`,
      size: 'wide', noFoot: true,
      body: `<div class="kv">${kv.map(([l, val]) => `<div><div class="l">${l}</div><div class="v ${l === 'Saldo' && val < 0 ? 'neg' : ''}">${money(val)}</div></div>`).join('')}</div>${special}${itemsSection(b, closed)}
        <div class="btn-row" style="margin-top:16px">${closed ? '<span class="badge">'+icon('lock')+'Mês fechado</span>' : `
          ${b.type === 'pagamento' ? (b.paid ? `<button type="button" class="btn" data-act="box-unpay" data-id="${b.id}">Desfazer pagamento</button>` : `<button type="button" class="btn primary" data-act="box-pay" data-id="${b.id}">${icon('check')}Marcar como pago</button>`) : `<button type="button" class="btn primary" data-act="expense" data-box="${b.id}" data-closeparent>${icon('expense')}${isPersistent(b.type) ? 'Registrar retirada' : 'Registrar gasto'}</button>`}
          <button type="button" class="btn" data-act="distribute" data-focus="${b.id}" data-closeparent>${icon('split')}Ajustar reserva</button>
          <button type="button" class="btn" data-act="transfer" data-box="${b.id}" data-closeparent>${icon('transfer')}Transferir</button>`}
          <span style="flex:1"></span>
          <button type="button" class="btn ghost icon" data-act="box-edit" data-id="${b.id}" title="Editar" aria-label="Editar">${icon('edit')}</button>
          <button type="button" class="btn ghost icon" data-act="box-dup" data-id="${b.id}" title="Duplicar" aria-label="Duplicar">${icon('copy')}</button>
          ${closed ? '' : `<button type="button" class="btn ghost icon" data-act="box-remove-month" data-id="${b.id}" title="Remover deste mês" aria-label="Remover deste mês">${icon('x')}</button>`}
          <button type="button" class="btn ghost icon danger" data-act="box-del" data-id="${b.id}" title="Excluir caixa" aria-label="Excluir">${icon('trash')}</button></div>
        ${b.notes ? `<div class="field" style="margin-top:18px"><span class="lbl-s">Observações</span><div style="white-space:pre-wrap;color:var(--text-2);font-size:13.5px">${esc(b.notes)}</div></div>` : ''}
        <div class="sec-h" style="margin-top:22px"><h2>Histórico de movimentações</h2></div><div id="boxHist"><div class="faint">Carregando…</div></div>`,
    });
    try {
      const h = await api('GET', `/api/boxes/${b.id}/history`);
      const rows = [...h.transactions.map((t) => {
        let sign = '', text = KIND[t.kind], cls = '';
        if (t.kind === 'reserva') { sign = t.amount >= 0 ? '+' : '−'; cls = t.amount >= 0 ? 'pos' : ''; }
        else if (t.kind === 'transferencia') { const inc = t.to_box_id === b.id; sign = inc ? '+' : '−'; cls = inc ? 'pos' : ''; text = inc ? `Recebido de ${esc(t.box_name)}` : `Enviado para ${esc(t.to_box_name)}`; }
        else sign = '−';
        return { date: t.date, ym: t.ym, title: t.description || KIND[t.kind], sub: text, amt: `${sign} ${money(Math.abs(t.amount))}`, cls };
      }), ...h.close_moves.map((cm) => {
        const incoming = cm.dest_box_id === b.id && cm.box_id !== b.id; const label = cm.dest === 'manter' ? 'Saldo mantido para o mês seguinte' : cm.dest === 'livre' ? 'Saldo liberado no fechamento' : incoming ? `Recebido no fechamento de ${esc(cm.box_name)}` : `Enviado no fechamento para ${esc(cm.dest_name)}`;
        return { date: `${cm.ym}-${pad(daysIn(cm.ym))}`, ym: cm.ym, title: `Fechamento de ${ymLabel(cm.ym).toLowerCase()}`, sub: label, amt: money(cm.amount), cls: 'faint' };
      })].sort((a, c) => c.date.localeCompare(a.date));
      const el = $('#boxHist', m.el); if (!el) return;
      el.innerHTML = rows.length ? `<div class="list">${rows.map((r) => `<div class="row"><div class="grow"><div class="t">${esc(r.title)}</div><div class="d">${fdate(r.date)} · ${r.sub}</div></div><div class="amt ${r.cls}">${r.amt}</div></div>`).join('')}</div>` : '<div class="faint">Nenhuma movimentação ainda.</div>';
    } catch (e) { const el = $('#boxHist', m.el); if (el) el.textContent = e.message; }
  }

  function distributeModal(focusId) {
    if (!guardOpen()) return;
    const v = S.view; const total = v.summary.total_income;
    const boxes = v.boxes.map((b) => ({ ...b, cur: b.reserved, saved: b.reserved }));
    const body = `${total <= 0 ? `<div class="alert warning" style="margin-bottom:12px">${icon('alert')}<div>Nenhuma receita registrada neste mês. Registre o salário para ter recursos a distribuir.</div></div>` : ''}
      <div class="btn-row" style="margin-bottom:8px"><button type="button" class="btn sm" data-dist="fill">${icon('sparkle')}Preencher pelo planejado</button><button type="button" class="btn sm ghost" data-dist="zero">Zerar tudo</button><span class="faint" style="font-size:12px;margin-left:auto">Salvo automaticamente</span></div>
      <div class="dist-list">${boxes.map((b) => `<div class="dist-row" data-row="${b.id}"><div class="nm">${tile(b, 'sm')}<div style="min-width:0"><div class="t">${esc(b.name)}</div><div class="d">${TYPES[b.type].label}${b.opening ? ` · saldo anterior ${money(b.opening)}` : ''}${b.used ? ` · gasto ${money(b.used)}` : ''}</div></div></div>
        <div class="pl">${b.planned ? `Planejado<br><button type="button" data-dist="one" data-id="${b.id}">${money(b.planned)}</button>` : '<span class="faint">Sem plano</span>'}</div>
        <div class="inpw"><div class="money-wrap"><input class="inp money" data-money inputmode="decimal" data-res="${b.id}" value="${moneyInput(b.reserved)}" placeholder="0,00"></div></div></div>`).join('')}</div>
      <div class="dist-sum"><div id="distBar"></div><div id="distAlert"></div>
        <div class="nums"><div><div class="l">Recursos do mês</div><div class="v">${money(total)}</div></div><div><div class="l">Distribuído</div><div class="v" id="dDist"></div></div><div><div class="l">Não distribuído</div><div class="v" id="dFree"></div></div></div></div>`;
    let timer = null; let saving = Promise.resolve();
    const m = modal({
      title: `Distribuir ${ymLabel(S.ym).toLowerCase()}`, body, size: 'wide', submit: 'Concluir', cancel: '',
      onOpen: (f) => {
        const recalc = () => {
          boxes.forEach((b) => { const c = parseMoney($(`[data-res="${b.id}"]`, f).value); b.cur = Number.isFinite(c) && c >= 0 ? c : b.cur; });
          const dist = boxes.reduce((s, b) => s + b.cur, 0); const free = total - dist;
          $('#dDist', f).textContent = money(dist); const fe = $('#dFree', f); fe.textContent = money(free); fe.className = `v ${free < 0 ? 'neg' : free === 0 ? 'pos' : ''}`;
          $('#distBar', f).innerHTML = segBar(boxes.map((b) => ({ ...b, reserved: b.cur })), total, { legend: false });
          $('#distAlert', f).innerHTML = free === 0 && total > 0 ? `<div class="alert info" style="margin-top:10px">${icon('check')}<div>Cada real deste mês tem um destino.</div></div>` : '';
        };
        const save = () => { clearTimeout(timer); timer = setTimeout(() => {
          const items = boxes.filter((b) => b.cur !== b.saved).map((b) => ({ box_id: b.id, reserved: b.cur })); if (!items.length) return;
          saving = api('POST', '/api/distribute', { ym: S.ym, items }).then(() => { items.forEach((it) => { boxes.find((b) => b.id === it.box_id).saved = it.reserved; }); }).catch((e) => m.error(e.message));
        }, 650); };
        f.addEventListener('input', (e) => { if (e.target.dataset.res) { recalc(); save(); } });
        f.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-dist]'); if (!btn) return;
          const set = (b, val) => { b.cur = Math.max(val, 0); $(`[data-res="${b.id}"]`, f).value = moneyInput(b.cur); };
          if (btn.dataset.dist === 'fill') boxes.forEach((b) => { if (b.planned) set(b, b.planned - b.opening - b.tin + b.tout); });
          if (btn.dataset.dist === 'zero') boxes.forEach((b) => set(b, 0));
          if (btn.dataset.dist === 'one') { const b = boxes.find((x) => x.id === Number(btn.dataset.id)); set(b, b.planned - b.opening - b.tin + b.tout); }
          recalc(); save();
        });
        recalc();
        if (focusId) setTimeout(() => { const i = $(`[data-res="${focusId}"]`, f); i && (i.scrollIntoView({ block: 'center' }), i.focus()); }, 60);
      },
      onSubmit: async () => { clearTimeout(timer); const items = boxes.filter((b) => b.cur !== b.saved).map((b) => ({ box_id: b.id, reserved: b.cur })); await saving; if (items.length) await api('POST', '/api/distribute', { ym: S.ym, items }); },
      onClose: () => { clearTimeout(timer); const items = boxes.filter((b) => b.cur !== b.saved).map((b) => ({ box_id: b.id, reserved: b.cur })); (items.length ? saving.then(() => api('POST', '/api/distribute', { ym: S.ym, items })) : saving).catch(() => {}).finally(() => { refresh(); refreshOpenBoxDetail(); }); },
    });
  }
  function refreshOpenBoxDetail() { /* o detalhe é reaberto pelo usuário quando necessário */ }

  function incomeForm(inc, kind) {
    if (!guardOpen()) return;
    const st = S.me.settings; const isNew = !inc;
    const k = inc ? inc.kind : kind || 'extra';
    const day = Math.min(st.salary_day || 5, daysIn(S.ym));
    inc = inc || { kind: k, description: k === 'salario' ? (st.salary_desc || 'Salário') : '', amount: k === 'salario' ? st.salary || 0 : 0, date: k === 'salario' ? `${S.ym}-${pad(day)}` : defaultDate(S.ym) };
    modal({
      title: isNew ? (k === 'salario' ? 'Registrar salário' : 'Nova receita extra') : 'Editar receita',
      body: `<div class="form"><div class="field"><label>Tipo</label><select class="inp" name="kind"><option value="salario" ${inc.kind === 'salario' ? 'selected' : ''}>Salário</option><option value="extra" ${inc.kind !== 'salario' ? 'selected' : ''}>Receita extra</option></select></div>
        ${tField('description', 'Descrição', inc.description, { attrs: 'maxlength="120" placeholder="Ex.: Freelance, 13º, restituição…"' })}
        <div class="r2">${mField('amount', 'Valor recebido', inc.amount, { attrs: 'autofocus' })}${tField('date', 'Data do recebimento', inc.date, { type: 'date' })}</div>
        <div class="hint faint" style="font-size:12px">A receita entra na competência de ${ymLabel(S.ym).toLowerCase()}.</div></div>`,
      submit: isNew ? 'Registrar' : 'Salvar',
      onSubmit: async (d) => {
        const p = { ym: S.ym, kind: d.kind, description: d.description, amount: needMoney(d.amount, 'Valor'), date: d.date };
        if (isNew) await api('POST', '/api/incomes', p); else await api('PUT', `/api/incomes/${inc.id}`, p);
        toast(isNew ? 'Receita registrada' : 'Receita atualizada'); await refresh();
        if (isNew && S.view.boxes.length && S.view.summary.undistributed > 0) setTimeout(() => distributeModal(), 120);
      },
    });
  }

  function expenseForm(boxId, tx) {
    if (!guardOpen()) return;
    const isNew = !tx; const bs = S.view.boxes;
    if (!bs.length) return toast('Crie uma caixa antes de registrar gastos.', 'err');
    const sel = tx ? tx.box_id : boxId || (bs.find((b) => b.type === 'consumo') || bs[0]).id;
    modal({
      title: isNew ? 'Registrar gasto' : `Editar ${KIND[tx.kind].toLowerCase()}`,
      body: `<div class="form">${mField('amount', 'Valor', tx ? tx.amount : 0, { attrs: 'autofocus' })}
        ${tField('description', 'Descrição', tx ? tx.description : '', { attrs: 'maxlength="160" placeholder="Ex.: Mercado, farmácia…"' })}
        <div class="r2"><div class="field"><label>Caixa</label><select class="inp" name="box_id" ${tx && tx.kind !== 'gasto' ? 'disabled' : ''}>${boxOpts(sel)}</select></div>${tField('date', 'Data', tx ? tx.date : defaultDate(S.ym), { type: 'date' })}</div>
        <div class="hint faint" style="font-size:12px">O gasto sai do saldo da caixa escolhida. Compras no cartão devem ser lançadas em Cartões, para não contar duas vezes.</div></div>`,
      submit: isNew ? 'Registrar' : 'Salvar',
      onSubmit: async (d) => {
        const p = { ym: S.ym, kind: 'gasto', box_id: Number(d.box_id) || undefined, amount: needMoney(d.amount, 'Valor'), date: d.date, description: d.description };
        if (isNew) await api('POST', '/api/transactions', p); else await api('PUT', `/api/transactions/${tx.id}`, p);
        toast(isNew ? 'Gasto registrado' : 'Movimentação atualizada'); await refresh();
      },
    });
  }

  function transferForm(fromId, tx) {
    if (!guardOpen()) return;
    const bs = S.view.boxes; if (bs.length < 2) return toast('São necessárias ao menos duas caixas.', 'err');
    if (tx) {
      return modal({ title: 'Editar transferência', body: `<div class="form">${mField('amount', 'Valor', tx.amount)}${tField('description', 'Descrição', tx.description)}${tField('date', 'Data', tx.date, { type: 'date' })}</div>`,
        onSubmit: async (d) => { await api('PUT', `/api/transactions/${tx.id}`, { amount: needMoney(d.amount, 'Valor'), description: d.description, date: d.date }); toast('Transferência atualizada'); await refresh(); } });
    }
    const from = fromId || (bs.find((b) => b.saldo > 0) || bs[0]).id; const to = (bs.find((b) => b.id !== from) || bs[0]).id;
    modal({
      title: 'Transferir entre caixas',
      body: `<div class="form"><div class="r2"><div class="field"><label>De</label><select class="inp" name="box_id">${boxOpts(from)}</select></div><div class="field"><label>Para</label><select class="inp" name="to_box_id">${boxOpts(to)}</select></div></div>
        ${mField('amount', 'Valor', 0, { attrs: 'autofocus' })}<div class="r2">${tField('description', 'Motivo (opcional)', '', { attrs: 'maxlength="160"' })}${tField('date', 'Data', defaultDate(S.ym), { type: 'date' })}</div>
        <div class="alert neutral">${icon('info')}<div>Transferências apenas mudam o destino do dinheiro: o saldo total permanece o mesmo.</div></div></div>`,
      submit: 'Transferir',
      onSubmit: async (d) => {
        await api('POST', '/api/transactions', { ym: S.ym, kind: 'transferencia', box_id: Number(d.box_id), to_box_id: Number(d.to_box_id), amount: needMoney(d.amount, 'Valor'), description: d.description, date: d.date });
        toast('Transferência realizada'); await refresh();
      },
    });
  }

  function payBoxForm(id) {
    if (!guardOpen()) return;
    const b = S.view.boxes.find((x) => x.id === id);
    if (b.card_id) return payInvoiceForm(b.card_id, b.id);
    modal({
      title: `Pagar · ${esc(b.name)}`, submit: 'Confirmar pagamento',
      body: `<div class="form"><div class="r2">${mField('amount', 'Valor pago', b.planned || funds(b), { attrs: 'autofocus' })}${tField('date', 'Data do pagamento', defaultDate(S.ym), { type: 'date' })}</div>
        ${b.planned && funds(b) < b.planned ? `<div class="alert warning">${icon('alert')}<div>O valor reservado (${money(funds(b))}) não cobre a conta (${money(b.planned)}). A caixa ficará com saldo negativo.</div></div>` : ''}</div>`,
      onSubmit: async (d) => { await api('POST', `/api/boxes/${b.id}/pay`, { ym: S.ym, amount: needMoney(d.amount, 'Valor'), date: d.date }); toast('Pagamento registrado'); closeAllModals(); await refresh(); },
    });
  }
  function payInvoiceForm(cardId, boxId) {
    if (!guardOpen()) return;
    const c = S.view.cards.find((x) => x.id === cardId); const linked = S.view.boxes.find((b) => b.card_id === cardId);
    const sel = boxId || (linked && linked.id) || (S.view.boxes.find((b) => b.type === 'pagamento') || S.view.boxes[0] || {}).id;
    if (!S.view.boxes.length) return toast('Crie uma caixa de pagamento antes.', 'err');
    modal({
      title: `Pagar fatura · ${esc(c.name)}`, submit: 'Confirmar pagamento',
      body: `<div class="form"><div class="stat-line tot" style="border:0;margin:0;padding:0"><span class="l">Total da fatura de ${ymLabel(S.ym).toLowerCase()}</span><span class="v" style="font-size:18px">${money(c.invoice.total)}</span></div>
        <div class="r2"><div class="field"><label>Pagar com a caixa</label><select class="inp" name="box_id">${boxOpts(sel)}</select></div>${tField('date', 'Data do pagamento', defaultDate(S.ym), { type: 'date' })}</div>
        <div class="alert neutral">${icon('info')}<div>As compras desta fatura já estão registradas no cartão; apenas o pagamento sai da caixa, sem duplicidade.</div></div></div>`,
      onSubmit: async (d) => { await api('POST', `/api/cards/${cardId}/invoices/${S.ym}/pay`, { box_id: Number(d.box_id), date: d.date }); toast('Fatura paga'); closeAllModals(); await refresh(); },
    });
  }

  function cardForm(c) {
    const isNew = !c; c = c || { name: '', holder: '', third_party: 0, closing_day: 1, due_day: 10, limit_amount: 0, color: COLORS[S.view.cards.length % COLORS.length], archived: 0 };
    modal({
      title: isNew ? 'Novo cartão' : 'Editar cartão', submit: isNew ? 'Cadastrar' : 'Salvar',
      footLeft: isNew ? '' : `<button type="button" class="btn ghost danger" data-act="card-del" data-id="${c.id}">${icon('trash')}Excluir</button>`,
      body: `<div class="form">${tField('name', 'Nome do cartão', c.name, { attrs: 'maxlength="60" placeholder="Ex.: Nubank, Itaú Black" autofocus' })}
        <label class="check"><input type="checkbox" name="third_party" ${c.third_party ? 'checked' : ''}><span>Cartão de outra pessoa<span class="hint">Para compras feitas no cartão de terceiros (ex.: cartão do seu pai).</span></span></label>
        ${tField('holder', 'Titular', c.holder, { attrs: 'maxlength="60" placeholder="Ex.: Meu pai"' })}
        <div class="r3">${tField('closing_day', 'Dia de fechamento', c.closing_day, { type: 'number', attrs: 'min="1" max="31"' })}${tField('due_day', 'Dia de vencimento', c.due_day, { type: 'number', attrs: 'min="1" max="31"' })}${mField('limit_amount', 'Limite (opcional)', c.limit_amount)}</div>
        <div class="field"><label>Cor</label><div class="color-pick">${COLORS.map((x) => `<label style="background:${x}"><input type="radio" name="color" value="${x}" ${c.color === x ? 'checked' : ''}></label>`).join('')}</div></div>
        ${isNew ? `<label class="check"><input type="checkbox" name="create_box" checked><span>Criar caixa de pagamento para a fatura<span class="hint">Recorrente; o valor planejado acompanha o total da fatura de cada mês.</span></span></label>` : `<label class="check"><input type="checkbox" name="archived" ${c.archived ? 'checked' : ''}><span>Arquivar cartão<span class="hint">Oculta das projeções sem apagar o histórico.</span></span></label>`}</div>`,
      onSubmit: async (d) => {
        const p = { name: d.name, holder: d.holder, third_party: d.third_party, closing_day: Number(d.closing_day), due_day: Number(d.due_day), limit_amount: needMoney(d.limit_amount, 'Limite', { allowZero: true }), color: d.color || c.color, archived: d.archived, create_box: d.create_box, ym: S.ym };
        if (isNew) { const r = await api('POST', '/api/cards', p); S.cardSel = r.id; toast('Cartão cadastrado'); } else { await api('PUT', `/api/cards/${c.id}`, p); toast('Cartão atualizado'); }
        await refresh();
      },
    });
  }

  function firstInvoiceYm(card, date) {
    const ym = date.slice(0, 7); const day = Number(date.slice(8, 10));
    let base = card.due_day > card.closing_day ? ym : ymAdd(ym, 1); if (day >= card.closing_day) base = ymAdd(base, 1); return base;
  }
  function purchaseForm(cardId, p) {
    const cards = S.view.cards.filter((c) => !c.archived || (p && c.id === p.card_id));
    if (!cards.length) return toast('Cadastre um cartão primeiro.', 'err');
    const isNew = !p; const cid = p ? p.card_id : cardId || S.cardSel || cards[0].id;
    p = p || { description: '', date: defaultDate(S.ym), amount: 0, installments: 1, category: '', notes: '' };
    const cats = [...new Set(S.view.boxes.filter((b) => b.type !== 'pagamento').map((b) => b.name))];
    modal({
      title: isNew ? 'Nova compra no cartão' : 'Editar compra', submit: isNew ? 'Lançar compra' : 'Salvar',
      body: `<div class="form"><div class="field"><label>Cartão</label><select class="inp" name="card_id">${cards.map((c) => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}${c.third_party ? ' (terceiro)' : ''}</option>`).join('')}</select></div>
        ${tField('description', 'Descrição', p.description, { attrs: 'maxlength="120" placeholder="Ex.: Geladeira, passagem…" autofocus' })}
        <div class="r3">${mField('amount', 'Valor total', p.amount)}${tField('installments', 'Parcelas', p.installments, { type: 'number', attrs: 'min="1" max="72"' })}${tField('date', 'Data da compra', p.date, { type: 'date' })}</div>
        ${isNew ? tField('current_installment', 'Parcela atual (compra já em andamento)', '', { type: 'number', attrs: 'min="1" max="72" placeholder="Opcional — ex.: 3 se a fatura deste mês traz a 3ª parcela"' }) : ''}
        <div class="field"><label>Categoria (para relatórios)</label><input class="inp" name="category" list="catList" value="${esc(p.category)}" maxlength="60" placeholder="Ex.: Alimentação"><datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist><div class="hint">Use o nome de uma caixa para agrupar nos relatórios. Não afeta o saldo das caixas.</div></div>
        <div class="alert neutral" id="pPrev"></div></div>`,
      onOpen: (f) => {
        const upd = () => {
          const d = formData(f); const c = S.view.cards.find((x) => x.id === Number(d.card_id)); const total = parseMoney(d.amount); const n = Math.max(1, Number(d.installments) || 1);
          let first = d.date && c ? firstInvoiceYm(c, d.date) : null;
          if (!isNew && d.date === p.date && p.first_ym) first = p.first_ym;
          if (d.current_installment && Number(d.current_installment) > 1) first = ymAdd(S.ym, -(Number(d.current_installment) - 1));
          $('#pPrev', f).innerHTML = `${icon('info')}<div>${Number.isFinite(total) && total > 0 ? `${n > 1 ? `${n}× de ${money(Math.floor(total / n))}` : `À vista: ${money(total)}`}` : 'Informe o valor'}${first ? ` · 1ª parcela na fatura de <b>${ymLabel(first).toLowerCase()}</b>${n > 1 ? `, última em ${ymLabel(ymAdd(first, n - 1)).toLowerCase()}` : ''}` : ''}.</div>`;
        };
        f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
      },
      onSubmit: async (d) => {
        const body = { card_id: Number(d.card_id), description: d.description, date: d.date, amount: needMoney(d.amount, 'Valor'), installments: Number(d.installments) || 1, category: d.category, ym: S.ym };
        if (isNew && d.current_installment) body.current_installment = Number(d.current_installment);
        if (isNew) await api('POST', `/api/cards/${body.card_id}/purchases`, body); else await api('PUT', `/api/purchases/${p.id}`, body);
        S.cardSel = body.card_id; toast(isNew ? 'Compra lançada' : 'Compra atualizada'); await refresh();
      },
    });
  }

  function closeMonthModal() {
    if (!guardOpen()) return;
    const v = S.view; const boxes = v.boxes.filter((b) => b.saldo !== 0);
    const pending = v.boxes.filter((b) => b.type === 'pagamento' && !b.paid && b.planned > 0);
    const next = ymAdd(S.ym, 1);
    modal({
      title: `Fechar ${ymLabel(S.ym).toLowerCase()}`, size: 'wide', submit: 'Fechar mês',
      body: `<p class="muted" style="margin-top:0">Escolha o destino do saldo restante de cada caixa. Após o fechamento, o mês fica protegido contra alterações (é possível reabrir).</p>
        ${pending.length ? `<div class="alert warning" style="margin-bottom:12px">${icon('alert')}<div>${pending.length} conta(s) ainda não marcada(s) como paga(s): ${pending.map((b) => esc(b.name)).join(', ')}.</div></div>` : ''}
        ${boxes.length ? `<div class="dist-list">${boxes.map((b) => `<div class="dist-row" style="grid-template-columns:minmax(0,1fr) 120px 220px"><div class="nm">${tile(b, 'sm')}<div style="min-width:0"><div class="t">${esc(b.name)}</div><div class="d">${TYPES[b.type].label}</div></div></div>
          <div class="pl" style="font-weight:600;color:${b.saldo < 0 ? 'var(--red)' : 'var(--text)'}">${money(b.saldo)}</div>
          <select class="inp sm" name="dest_${b.id}"><option value="manter" ${isPersistent(b.type) ? 'selected' : ''}>Manter na caixa em ${MSHORT[Number(next.slice(5)) - 1]}</option><option value="livre" ${!isPersistent(b.type) ? 'selected' : ''}>Liberar como sobra</option>
            ${v.boxes.filter((x) => x.id !== b.id).map((x) => `<option value="caixa:${x.id}">Enviar para ${esc(x.name)}</option>`).join('')}</select></div>`).join('')}</div>` : '<div class="faint">Nenhuma caixa com saldo restante.</div>'}
        <div class="stat-line tot" style="margin-top:12px"><span class="l">Valor não distribuído (vai como sobra para ${ymLabel(next).toLowerCase()})</span><span class="v">${money(v.summary.undistributed)}</span></div>`,
      onSubmit: async (d) => {
        const moves = boxes.map((b) => { const val = d[`dest_${b.id}`] || 'livre'; return val.startsWith('caixa:') ? { box_id: b.id, dest: 'caixa', dest_box_id: Number(val.slice(6)) } : { box_id: b.id, dest: val }; });
        await api('POST', `/api/month/${S.ym}/close`, { moves }); toast('Mês fechado'); await refresh();
      },
    });
  }

  function quickAdd() {
    modal({ title: 'Lançar', noFoot: true, body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-bottom:12px">
      ${[['salary', 'income', 'Salário', 'Registrar recebimento'], ['income-new', 'plus', 'Receita extra', 'Freelance, bônus…'], ['expense', 'expense', 'Gasto', 'Sai do saldo de uma caixa'], ['transfer', 'transfer', 'Transferência', 'Entre caixas'], ['purchase-new', 'card', 'Compra no cartão', 'À vista ou parcelada'], ['box-new', 'boxes', 'Nova caixa', 'Criar destino']].map(([a, ic, t, d]) =>
        `<button type="button" class="btn" style="height:auto;padding:12px;justify-content:flex-start;text-align:left" data-act="${a}" data-closeparent><span class="ico-tile sm" style="background:var(--surface-2)">${icon(ic)}</span><span><span style="display:block">${t}</span><span class="faint" style="font-weight:400;font-size:12px">${d}</span></span></button>`).join('')}</div>` });
  }
  function exportMenu() {
    modal({ title: 'Exportar CSV', noFoot: true, body: `<div class="list" style="padding-bottom:12px">${[['movimentacoes', 'Movimentações do mês', S.ym], ['movimentacoes', 'Todas as movimentações', ''], ['caixas', 'Caixas do mês', S.ym], ['receitas', 'Receitas (todas)', ''], ['cartoes', 'Compras no cartão', '']].map(([k, l, qs]) => `<div class="row"><div class="grow"><div class="t">${l}</div></div>${csvBtn(k, qs)}</div>`).join('')}</div>` });
  }

  // ───────────────────────────── Ações (delegação) ─────────────────────────────
  const findBox = (id) => S.view.boxes.find((b) => b.id === Number(id));
  const ACT = {
    csv: (el) => exportCsv(el.dataset.kind, el.dataset.ym),
    'item-add': (el) => itemForm(Number(el.dataset.box)),
    'item-paste': (el) => itemPasteForm(Number(el.dataset.box)),
    'item-edit': (el) => { const b = findBox(el.dataset.box); itemForm(b.id, (b.items || []).find((i) => i.id === Number(el.dataset.item))); },
    'item-del': async (el) => { const b = findBox(el.dataset.box); const it = (b.items || []).find((i) => i.id === Number(el.dataset.item)); if (!it) return;
      if (await confirmDlg(`Excluir o item <b>${esc(it.description)}</b> (${money(it.amount)})?`, { ok: 'Excluir', danger: true })) { try { await api('DELETE', `/api/boxes/${b.id}/items/${it.id}`, { ym: S.ym }); await reopenBox(b.id); } catch (e) { toast(e.message, 'err'); } } },
    'toggle-hide': () => { S.hide = !S.hide; try { localStorage.setItem('caixas_hide', S.hide ? '1' : '0'); } catch (e) { /* */ } renderPage(false); },
    'backup-now': () => { backupNow(); if (S.route === 'configuracoes') renderPage(false); },
    'backup-restore': () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        const text = await f.text();
        if (S.me && S.me.has_data && !(await confirmDlg('Restaurar este backup? Os dados atuais deste aparelho serão substituídos pelos do arquivo.', { ok: 'Restaurar', danger: true }))) return;
        try { window.LocalAPI.importBackup(text); toast('Backup restaurado'); await boot(); } catch (e) { toast(e.message, 'err'); }
      };
      inp.click();
    },
    'reset-all': async () => { if (await confirmDlg('Apagar <b>todos</b> os dados deste aparelho? Isso não pode ser desfeito. Se quiser, faça um backup antes.', { ok: 'Apagar tudo', danger: true, title: 'Apagar dados' })) { window.LocalAPI.resetAll(); closeAllModals(); S.view = null; await boot(); } },
    reload: () => renderPage(true),
    'nav-open': () => $('.app').classList.add('nav-open'), 'nav-close': () => $('.app').classList.remove('nav-open'),
    'month-prev': () => setYm(ymAdd(S.ym, -1)), 'month-next': () => setYm(ymAdd(S.ym, 1)), 'month-today': () => setYm(curYm()),
    'goto-month': (el) => { setYm(el.dataset.ym); location.hash = '#/planejamento'; },
    'goto-prev-close': () => { setYm(ymAdd(S.ym, -1)); location.hash = '#/planejamento'; },
    goto: (el) => { location.hash = `#/${el.dataset.to}`; },
    'theme-cycle': () => setTheme({ system: 'light', light: 'dark', dark: 'system' }[S.me.settings.theme || 'system']),
    'theme-set': (el) => setTheme(el.dataset.t),
    onboard: () => run(() => api('POST', '/api/onboarding', { ym: S.ym }), 'Estrutura criada — ajuste os valores planejados'),
    'quick-add': quickAdd, 'export-menu': exportMenu,
    distribute: (el) => distributeModal(el.dataset.focus ? Number(el.dataset.focus) : null),
    salary: () => incomeForm(null, 'salario'), 'income-new': () => incomeForm(null, 'extra'),
    'income-edit': (el) => incomeForm(S.view.incomes.find((i) => i.id === Number(el.dataset.id))),
    'income-del': async (el) => { if (await confirmDlg('Excluir esta receita?', { ok: 'Excluir', danger: true })) run(() => api('DELETE', `/api/incomes/${el.dataset.id}`), 'Receita excluída'); },
    expense: (el) => expenseForm(el.dataset.box ? Number(el.dataset.box) : null),
    transfer: (el) => transferForm(el.dataset.box ? Number(el.dataset.box) : null),
    'tx-edit': async (el) => { const { transactions } = await api('GET', `/api/transactions?ym=${S.ym}`); const t = transactions.find((x) => x.id === Number(el.dataset.id)); if (!t) return; t.kind === 'transferencia' ? transferForm(null, t) : expenseForm(null, t); },
    'tx-del': async (el) => { if (await confirmDlg('Excluir esta movimentação? Se for um pagamento, a conta volta a ficar pendente.', { ok: 'Excluir', danger: true })) run(() => api('DELETE', `/api/transactions/${el.dataset.id}`), 'Movimentação excluída'); },
    'box-new': () => boxForm(null), 'box-open': (el) => boxDetail(Number(el.dataset.id)),
    'box-edit': (el) => { closeAllModals(); boxForm(findBox(el.dataset.id)); },
    'box-filter': (el) => { S.boxFilter = el.dataset.f; renderPage(false); },
    'box-dup': (el) => { if (!guardOpen()) return; closeAllModals(); run(() => api('POST', `/api/boxes/${el.dataset.id}/duplicate`, { ym: S.ym }), 'Caixa duplicada'); },
    'box-del': async (el) => { const b = findBox(el.dataset.id); if (await confirmDlg(`Excluir a caixa <b>${esc(b.name)}</b>? As movimentações dela nos meses abertos também serão removidas. Meses fechados preservam o histórico (a caixa é arquivada).`, { ok: 'Excluir caixa', danger: true, title: 'Excluir caixa' })) { closeAllModals(); run(() => api('DELETE', `/api/boxes/${b.id}`), 'Caixa excluída'); } },
    'box-remove-month': async (el) => { const b = findBox(el.dataset.id); if (await confirmDlg(`Remover <b>${esc(b.name)}</b> apenas de ${ymLabel(S.ym).toLowerCase()}? A caixa continua existindo nos outros meses.`, { ok: 'Remover do mês' })) { closeAllModals(); run(() => api('DELETE', `/api/boxes/${b.id}/month/${S.ym}`), 'Caixa removida do mês'); } },
    'box-add-month': (el) => { if (guardOpen()) run(() => api('POST', `/api/boxes/${el.dataset.id}/month`, { ym: S.ym }), 'Caixa adicionada ao mês'); },
    'box-pay': (el) => payBoxForm(Number(el.dataset.id)),
    'box-unpay': async (el) => { if (await confirmDlg('Desfazer o pagamento? O valor volta para o saldo da caixa.', { ok: 'Desfazer' })) { closeAllModals(); run(() => api('POST', `/api/boxes/${el.dataset.id}/unpay`, { ym: S.ym }), 'Pagamento desfeito'); } },
    'card-new': () => cardForm(null), 'card-edit': (el) => cardForm(S.view.cards.find((c) => c.id === Number(el.dataset.id))),
    'card-sel': (el) => { S.cardSel = Number(el.dataset.id); renderPage(false); },
    'card-del': async (el) => { if (await confirmDlg('Excluir este cartão e todas as compras lançadas nele? Pagamentos já registrados permanecem nas caixas.', { ok: 'Excluir cartão', danger: true })) { closeAllModals(); S.cardSel = null; run(() => api('DELETE', `/api/cards/${el.dataset.id}`), 'Cartão excluído'); } },
    'purchase-new': (el) => purchaseForm(el.dataset.card ? Number(el.dataset.card) : null),
    'purchase-edit': async (el) => { const c = S.view.cards.find((x) => x.id === S.cardSel); const p = c && c.invoice.purchases.find((x) => x.id === Number(el.dataset.id)); if (p) purchaseForm(null, p); },
    'purchase-del': async (el) => { if (await confirmDlg('Excluir esta compra? Todas as parcelas, inclusive as futuras, serão removidas.', { ok: 'Excluir', danger: true })) run(() => api('DELETE', `/api/purchases/${el.dataset.id}`), 'Compra excluída'); },
    'invoice-pay': (el) => payInvoiceForm(Number(el.dataset.id)),
    'invoice-unpay': async (el) => { if (await confirmDlg('Desfazer o pagamento da fatura?', { ok: 'Desfazer' })) run(() => api('POST', `/api/cards/${el.dataset.id}/invoices/${S.ym}/unpay`), 'Pagamento desfeito'); },
    'invoice-adjust': (el) => {
      if (!guardOpen()) return; const c = S.view.cards.find((x) => x.id === Number(el.dataset.id));
      modal({ title: `Ajuste manual · fatura ${esc(c.name)}`, body: `<div class="form">${mField('adjustment', 'Valor do ajuste', c.invoice.adjustment, { hint: 'Use para anuidade, juros, IOF ou estornos. Valores negativos (ex.: -25,00) reduzem a fatura.' })}</div>`,
        onSubmit: async (d) => { await api('PUT', `/api/cards/${c.id}/invoices/${S.ym}`, { adjustment: needMoney(d.adjustment, 'Ajuste', { allowZero: true, allowNeg: true }) }); toast('Fatura ajustada'); await refresh(); } });
    },
    replicate: async () => { try { const r = await api('POST', `/api/month/${S.ym}/replicate`); toast(r.added || r.updated ? `${r.added} caixa(s) adicionada(s), ${r.updated} planejamento(s) copiado(s)` : 'A estrutura já está igual à do mês anterior'); await refresh(); } catch (e) { toast(e.message, 'err'); } },
    'month-close': closeMonthModal,
    'month-reopen': async () => { if (await confirmDlg(`Reabrir ${ymLabel(S.ym).toLowerCase()}? Os destinos escolhidos no fechamento serão desfeitos.`, { ok: 'Reabrir' })) run(() => api('POST', `/api/month/${S.ym}/reopen`), 'Mês reaberto'); },
    'cal-day': (el) => { S.calDay = el.dataset.d || null; renderPage(false); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    if (el.closest('.box') && e.target.closest('[data-grip]')) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault();
    if (el.hasAttribute('data-closeparent')) closeAllModals();
    if (el.closest('.nav, .side')) $('.app')?.classList.remove('nav-open');
    Promise.resolve(fn(el, e)).catch((ex) => toast(ex.message, 'err'));
  });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.box[data-act], .ccard[data-act]')) { e.preventDefault(); e.target.click(); } });
  let mvTimer;
  document.addEventListener('input', (e) => { const k = e.target.dataset.mv; if (!k) return; S.mv[k] = e.target.value; clearTimeout(mvTimer); mvTimer = setTimeout(async () => { await renderPage(false); if (k === 'q') { const i = $('[data-mv="q"]'); i && (i.focus(), i.setSelectionRange(i.value.length, i.value.length)); } }, k === 'q' ? 250 : 0); });

  function setYm(ym) { S.ym = ym; try { sessionStorage.setItem('caixas_ym', ym); } catch (e) { /* */ } S.view = null; renderPage(true); }
  async function setTheme(t) {
    S.me.settings.theme = t; try { localStorage.setItem('caixas_theme', JSON.stringify(t)); } catch (e) { /* */ }
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    updateShell(); if (S.route === 'configuracoes') renderPage(false);
    api('PUT', '/api/me', { settings: { theme: t } }).catch((e) => toast(e.message, 'err'));
  }

  // ───────────────────────────── Arrastar e soltar (mouse e toque) ─────────────────────────────
  function initDrag() {
    const grid = $('#boxGrid'); if (!grid) return;
    grid.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('[data-grip]'); if (!grip) return;
      e.preventDefault(); e.stopPropagation();
      const el = grip.closest('.box'); const r = el.getBoundingClientRect();
      const ph = document.createElement('div'); ph.className = 'box ph'; ph.style.height = `${r.height}px`;
      el.after(ph); el.classList.add('dragging');
      Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, pointerEvents: 'none' });
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        el.style.left = `${ev.clientX - dx}px`; el.style.top = `${ev.clientY - dy}px`;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#boxGrid .box[data-id]:not(.dragging)');
        if (over) { const or = over.getBoundingClientRect(); const after = ev.clientY > or.top + or.height / 2 || (ev.clientX > or.left + or.width / 2 && ev.clientY > or.top); after ? over.after(ph) : over.before(ph); }
        if (ev.clientY < 60) scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) scrollBy(0, 12);
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        ph.replaceWith(el); el.classList.remove('dragging'); el.removeAttribute('style'); el.style.setProperty('--c', findBox(el.dataset.id).color);
        const ids = $$('#boxGrid .box[data-id]').map((x) => Number(x.dataset.id));
        const before = S.view.boxes.map((b) => b.id);
        if (ids.join() !== before.join()) {
          S.view.boxes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
          api('POST', '/api/boxes/reorder', { ids }).catch((ex) => { toast(ex.message, 'err'); refresh(); });
        }
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });
  }

  // ───────────────────────────── Roteamento / boot ─────────────────────────────
  function onHash() {
    const r = (location.hash.replace(/^#\/?/, '') || 'visao-geral').split('?')[0];
    S.route = ROUTES[r] ? r : 'visao-geral';
    if (S.me) { S.view = null; renderShell(); renderPage(true); scrollTo(0, 0); }
  }
  addEventListener('hashchange', onHash);
  async function boot() {
    try { S.me = await api('GET', '/api/me'); } catch (e) { S.me = null; }
    if (S.me) {
      const t = S.me.settings.theme || 'system'; try { localStorage.setItem('caixas_theme', JSON.stringify(t)); } catch (e) { /* */ }
      if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    }
    S.view = null; const r = (location.hash.replace(/^#\/?/, '') || 'visao-geral'); S.route = ROUTES[r] ? r : 'visao-geral';
    root.innerHTML = ''; render();
  }
  boot();
})();
