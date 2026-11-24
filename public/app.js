/* Caixas — caixinhas de depósito para as despesas que você precisa pagar (faturas, pessoas, contas).
 * Você adiciona a despesa numa caixinha e vai depositando o dinheiro do débito nela até cobrir.
 * Tudo fica salvo no próprio aparelho (localStorage). Valores em centavos. */
'use strict';
(function () {
  // ───────────── utilidades ─────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (c) => (S.hide ? 'R$ ••••' : BRL.format((c || 0) / 100));
  const moneyInput = (c) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
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
  const fdate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const tint = (hex, a = 0.16) => `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0e7c86', '#52514e'];
  const BOX_ICONS = window.BOX_ICONS;

  // ───────────── dados (no aparelho) ─────────────
  const KEY = 'caixas_v3';
  let DB;
  const emptyDb = () => ({ version: 3, name: '', settings: { theme: 'system' }, seq: 0, boxes: [], entries: [], flags: {} });
  function load() {
    try { DB = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { DB = null; }
    if (!DB) { DB = emptyDb(); migrateFromV1(); }
    DB.flags = DB.flags || {}; DB.settings = DB.settings || { theme: 'system' };
    seedEloyse();
    save();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); return true; }
    catch (e) { toast('Não foi possível salvar no aparelho.', 'err'); return false; }
  }
  const nid = () => ++DB.seq;
  // Traz as caixas e os itens de contas da versão anterior do app (se houver).
  function migrateFromV1() {
    let old; try { old = JSON.parse(localStorage.getItem('caixas_db_v1') || 'null'); } catch (e) { old = null; }
    if (!old || !Array.isArray(old.boxes)) return;
    DB.name = (old.profile && old.profile.name) || '';
    if (old.profile && old.profile.settings && old.profile.settings.theme) DB.settings.theme = old.profile.settings.theme;
    const map = new Map();
    for (const b of old.boxes) {
      if (b.archived) continue;
      const nb = { id: nid(), name: b.name, icon: b.icon || 'box', color: b.color || COLORS[0], notes: b.notes || '', position: b.position || 0, created_at: todayISO() };
      DB.boxes.push(nb); map.set(b.id, nb.id);
    }
    for (const bm of old.box_months || []) for (const it of bm.items || []) {
      if (!map.has(bm.box_id)) continue;
      DB.entries.push({ id: nid(), box_id: map.get(bm.box_id), kind: 'gasto', description: it.description, amount: it.amount, date: todayISO(), settled_at: null });
    }
  }
  // Caixinha pedida: Eloyse — o que você tem que pagar a ela, já com as despesas lançadas. Criada uma única vez (se você apagar, não volta).
  function seedEloyse() {
    if (DB.flags.eloyse) return;
    DB.flags.eloyse = true;
    let box = DB.boxes.find((b) => b.name.trim().toLowerCase() === 'eloyse');
    if (box && DB.entries.some((e) => e.box_id === box.id && e.kind === 'gasto')) return; // já tem gastos: não mexe
    if (box && !box.notes) box.notes = 'O que tenho que pagar à Eloyse';
    if (!box) { box = { id: nid(), name: 'Eloyse', icon: 'users', color: '#e87ba4', notes: 'O que tenho que pagar à Eloyse', position: -1, created_at: todayISO() }; DB.boxes.push(box); }
    const id = box.id;
    [['SHEIN', 43605], ['SHEIN', 12667], ['TIKTOK SHOP', 8610], ['AIRBNB', 13000], ['INGRESSO F1', 6130]]
      .forEach(([description, amount]) => DB.entries.push({ id: nid(), box_id: id, kind: 'gasto', description, amount, date: todayISO(), settled_at: null }));
  }

  // ───────────── cálculos ─────────────
  function stats(boxId) {
    const es = DB.entries.filter((e) => e.box_id === boxId);
    const dep = es.filter((e) => e.kind === 'deposito').reduce((s, e) => s + e.amount, 0);
    const ret = es.filter((e) => e.kind === 'retirada').reduce((s, e) => s + e.amount, 0);
    const open = es.filter((e) => e.kind === 'gasto' && !e.settled_at);
    const aberto = open.reduce((s, e) => s + e.amount, 0);
    const guardado = dep - ret;
    return { guardado, aberto, falta: Math.max(aberto - guardado, 0), sobra: Math.max(guardado - aberto, 0), open, count: es.length };
  }
  const sortedBoxes = () => [...DB.boxes].sort((a, b) => a.position - b.position || a.id - b.id);
  // Cada dívida só é coberta pelo dinheiro guardado na própria caixinha (o da viagem não paga a Eloyse).
  function totals() {
    return sortedBoxes().reduce((t, b) => {
      const s = stats(b.id); t.guardado += s.guardado; t.aberto += s.aberto; t.falta += s.falta;
      if (s.aberto > 0) { t.coberto += Math.min(Math.max(s.guardado, 0), s.aberto); t.dividas.push(b); } else { t.reservas += s.guardado; t.outras.push(b); }
      return t;
    }, { guardado: 0, aberto: 0, falta: 0, coberto: 0, reservas: 0, dividas: [], outras: [] });
  }
  const boxById = (id) => DB.boxes.find((b) => b.id === Number(id));

  // ───────────── estado / interface base ─────────────
  const S = { route: 'inicio', boxId: null, hide: (() => { try { return localStorage.getItem('caixas_hide') === '1'; } catch (e) { return false; } })(), hist: { box: '', kind: '', q: '' } };
  function toast(msg, type = '') {
    const t = document.createElement('div'); t.className = `toast ${type}`; t.innerHTML = `${icon(type === 'err' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, type === 'err' ? 4200 : 2200);
  }
  const modals = [];
  const closeAllModals = () => { while (modals.length) modals[modals.length - 1].close(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modals.length) { e.preventDefault(); modals[modals.length - 1].close(); } });
  function modal({ title, body, submit = 'Salvar', cancel = 'Cancelar', size = '', danger = false, onSubmit, onOpen, onClose, noFoot = false }) {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<form class="modal ${size}" novalidate autocomplete="off">
      <div class="modal-h"><h3>${title}</h3><button type="button" class="btn ghost icon sm" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="modal-b">${body}<div class="err-box hide" style="margin-top:14px"></div></div>
      ${noFoot ? '' : `<div class="modal-f">${cancel ? `<button type="button" class="btn" data-close>${cancel}</button>` : ''}<button class="btn ${danger ? 'danger solid' : 'primary'}" type="submit">${submit}</button></div>`}</form>`;
    document.body.appendChild(ov);
    const form = ov.querySelector('form'); const err = ov.querySelector('.err-box');
    const m = { form, el: ov, close() { const i = modals.indexOf(m); if (i < 0) return; modals.splice(i, 1); ov.remove(); onClose && onClose(); }, error(msg) { err.textContent = msg; err.classList.toggle('hide', !msg); } };
    modals.push(m);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) m.close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault(); if (!onSubmit) return m.close(); m.error('');
      try { const r = onSubmit(formData(form), form, m); if (r !== false) m.close(); } catch (ex) { m.error(ex.message); }
    });
    bindMoneyInputs(form); onOpen && onOpen(form, m);
    setTimeout(() => { const f = form.querySelector('[autofocus]'); f && f.focus(); }, 40);
    return m;
  }
  function formData(form) { const o = {}; for (const [k, v] of new FormData(form)) o[k] = v; return o; }
  function confirmDlg(text, { title = 'Confirmar', ok = 'Confirmar', danger = false } = {}) {
    return new Promise((resolve) => { let done = false; modal({ title, body: `<p style="margin:0;color:var(--text-2)">${text}</p>`, submit: ok, danger, onSubmit: () => { done = true; resolve(true); }, onClose: () => { if (!done) resolve(false); } }); });
  }
  function bindMoneyInputs(root) {
    $$('input[data-money]', root).forEach((inp) => {
      inp.addEventListener('blur', () => { const c = parseMoney(inp.value); if (inp.value.trim() && Number.isFinite(c)) inp.value = moneyInput(Math.abs(c)); });
    });
  }
  const mField = (name, label, cents, { hint = '', attrs = '' } = {}) => `<div class="field"><label>${label}</label><div class="money-wrap"><input class="inp money" data-money inputmode="decimal" name="${name}" value="${moneyInput(cents)}" placeholder="0,00" ${attrs}></div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const tField = (name, label, value = '', { type = 'text', hint = '', attrs = '' } = {}) => `<div class="field"><label>${label}</label><input class="inp" type="${type}" name="${name}" value="${esc(value)}" ${attrs}>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  function needMoney(v, label = 'Valor') { const c = parseMoney(v); if (!Number.isFinite(c) || c <= 0) throw new Error(`${label}: informe um valor maior que zero.`); return c; }
  const needText = (v, label) => { const s = String(v || '').trim(); if (!s) throw new Error(`Informe ${label}.`); return s.slice(0, 120); };
  const tile = (b, cls = '') => `<div class="ico-tile ${cls}" style="background:${tint(b.color)};color:${b.color}">${icon(b.icon)}</div>`;
  const boxOpts = (sel) => sortedBoxes().map((b) => `<option value="${b.id}" ${b.id === Number(sel) ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  function download(filename, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const lastBackup = () => { try { return localStorage.getItem('caixas_last_backup') || ''; } catch (e) { return ''; } };

  // ───────────── telas ─────────────
  const root = $('#root');
  const ROUTES = { inicio: ['Caixinhas', 'boxes'], historico: ['Histórico', 'list'], config: ['Configurações', 'settings'] };
  function shell() {
    if ($('.app')) return;
    root.innerHTML = `<div class="app">
      <aside class="side"><div class="brand"><span class="brand-mark"></span>Caixas</div>
        <nav class="nav" id="nav">${Object.entries(ROUTES).map(([k, [t, ic]]) => `<a href="#/${k}" data-route="${k}">${icon(ic)}<span>${t}</span></a>`).join('')}</nav>
        <div class="side-foot"><button class="btn ghost" data-act="theme-cycle" style="justify-content:flex-start" id="themeBtn"></button></div></aside>
      <div class="mobile-scrim" data-act="nav-close"></div>
      <main class="main"><header class="top" id="top">
        <button class="btn ghost icon menu-btn" data-act="nav-open" aria-label="Menu" id="menuBtn">${icon('menu')}</button>
        <button class="btn ghost icon" data-act="back" aria-label="Voltar" id="backBtn">${icon('left')}</button>
        <h1 id="pageTitle"></h1><div class="spacer"></div><div class="btn-row" id="topActs"></div></header>
        <div class="page" id="page"></div></main></div>`;
    addEventListener('scroll', () => $('#top')?.classList.toggle('scrolled', scrollY > 4), { passive: true });
  }
  function render(animate = true) {
    if (!DB.name) return renderWelcome();
    shell();
    const route = S.route === 'caixa' && !boxById(S.boxId) ? 'inicio' : S.route;
    $('.app').dataset.route = route;
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === (route === 'caixa' ? 'inicio' : route)));
    $('#backBtn').style.display = route === 'caixa' ? '' : 'none';
    $('#pageTitle').textContent = route === 'caixa' ? boxById(S.boxId).name : ROUTES[route][0];
    const th = DB.settings.theme || 'system';
    $('#themeBtn').innerHTML = `${icon(th === 'dark' ? 'moon' : th === 'light' ? 'sun' : 'monitor')}<span>Tema: ${th === 'dark' ? 'escuro' : th === 'light' ? 'claro' : 'sistema'}</span>`;
    $('#topActs').innerHTML = route === 'inicio' ? `<button class="btn primary" data-act="box-new">${icon('plus')}<span class="act-txt">Nova caixinha</span></button>` : '';
    const page = $('#page'); const y = scrollY;
    page.innerHTML = PAGES[route]();
    if (animate) { page.style.animation = 'none'; void page.offsetWidth; page.style.animation = ''; scrollTo(0, 0); } else scrollTo(0, y);
    bindMoneyInputs(page); MOUNT[route] && MOUNT[route]();
  }
  function renderWelcome() {
    root.innerHTML = `<div class="auth" style="grid-template-columns:1fr"><div class="auth-r"><form class="auth-form form" id="wf" novalidate>
      <div class="brand" style="padding:0 0 8px"><span class="brand-mark"></span>Caixas</div>
      <div><h2>Bem-vindo</h2><p class="sub">Separe em caixinhas o dinheiro do que você precisa pagar. Funciona sem internet e os dados ficam só neste aparelho.</p></div>
      ${tField('name', 'Como você quer ser chamado?', '', { attrs: 'required maxlength="80" autofocus' })}
      <div class="err-box hide"></div><button class="btn primary" type="submit">Começar</button>
      <div class="auth-switch">Já usa o Caixas? <a data-act="backup-restore">Restaurar um backup</a></div></form></div></div>`;
    $('#wf').addEventListener('submit', (e) => {
      e.preventDefault(); const n = String(new FormData(e.target).get('name') || '').trim();
      if (!n) { const eb = $('#wf .err-box'); eb.textContent = 'Digite seu nome.'; eb.classList.remove('hide'); return; }
      DB.name = n.slice(0, 80); save(); render();
    });
  }

  function boxRow(b) {
    const s = stats(b.id); const p = s.aberto ? Math.min(s.guardado / s.aberto, 1) : s.guardado > 0 ? 1 : 0;
    const sub = s.aberto ? (s.falta ? `Faltam ${money(s.falta)} de ${money(s.aberto)}` : `Tudo guardado · ${money(s.aberto)} a pagar`) : s.guardado ? 'Reserva · sem dívida' : 'Vazia';
    return `<div class="lrow" data-act="box-open" data-id="${b.id}" tabindex="0">${tile(b, 'xl')}
      <div class="grow"><div class="nm">${esc(b.name)}</div><div class="sub">${sub}</div>
        ${s.aberto ? `<div class="prog thin"><span style="width:${Math.max(0, p) * 100}%;background:${!s.falta ? 'var(--green-soft)' : b.color}"></span></div>` : ''}</div>
      <div class="val ${s.guardado < 0 ? 'neg' : ''}">${money(s.guardado)}</div></div>`;
  }
  const circ = (act, ic, label, extra = '') => `<button class="circ" data-act="${act}" ${extra}><span>${icon(ic)}</span>${label}</button>`;

  const PAGES = {};
  const MOUNT = {};
  PAGES.inicio = () => {
    const t = totals(); const boxes = sortedBoxes();
    const lb = lastBackup(); const days = lb ? Math.floor((Date.parse(todayISO()) - Date.parse(lb)) / 864e5) : null;
    const backupHint = DB.entries.length && (days == null || days >= 14) ? `<div class="banner">${icon('shield')}<div class="grow">${lb ? `Último backup há ${days} dias.` : 'Você ainda não fez backup.'} Os dados ficam só neste aparelho.</div><button class="btn sm" data-act="backup-now">${icon('download')}Fazer backup</button></div>` : '';
    return `<section class="hero">
        <button class="hero-l" data-act="toggle-hide">Guardado nas caixinhas ${icon(S.hide ? 'eyeoff' : 'eye')}</button>
        <div class="hero-v">${money(t.guardado)}</div>
        ${t.aberto ? `<span class="pill-tag ${t.falta ? 'warnp' : 'ok'}">${t.falta ? `Falta guardar ${money(t.falta)}` : 'Tudo já guardado'}</span>` : '<span class="pill-tag neutral">Nenhuma despesa a pagar</span>'}
        <div class="circles">${circ('deposit', 'income', 'Depositar')}${circ('expense', 'file', 'Nova despesa')}${circ('pay', 'check', 'Paguei')}${circ('box-new', 'plus', 'Nova caixinha')}</div>
      </section>${backupHint}
      <div class="duo">
        <div class="flat-card" style="cursor:default"><div class="l">${icon('file')} Dívidas a pagar</div><div class="v">${money(t.aberto)}</div>
          ${t.aberto ? `<div class="prog" style="margin-top:12px;height:8px"><span style="width:${(t.coberto / t.aberto) * 100}%;background:var(--green-soft)"></span></div>
            <div class="faint" style="font-size:13px;margin-top:8px">${money(t.coberto)} guardado nas caixinhas delas · falta ${money(t.falta)}</div>` : '<div class="faint" style="font-size:13px;margin-top:6px">Nenhuma dívida em aberto</div>'}</div>
        <div class="flat-card" style="cursor:default"><div class="l">${icon('piggy')} Guardado em reservas</div><div class="v">${money(t.reservas)}</div>
          <div class="faint" style="font-size:13px;margin-top:6px">Caixinhas sem dívida (viagem, metas…). Não entra no pagamento das dívidas.</div></div>
      </div>
      ${boxes.length ? `${t.dividas.length ? `<div class="sec-row"><h2>Dívidas</h2><a data-act="box-new">Criar nova</a></div><div class="lrows">${t.dividas.map(boxRow).join('')}</div>` : ''}
        <div class="sec-row"><h2>${t.dividas.length ? 'Reservas e outras' : 'Caixinhas'}</h2>${t.dividas.length ? '' : '<a data-act="box-new">Criar nova</a>'}</div><div class="lrows">${t.outras.map(boxRow).join('') || '<div class="faint" style="padding:8px 0">Nenhuma.</div>'}</div>`
        : `<div class="empty"><div class="ico-tile">${icon('boxes')}</div><h3>Nenhuma caixinha</h3><p>Crie uma caixinha para cada fatura, pessoa ou conta que você precisa pagar.</p><button class="btn primary" data-act="box-new">${icon('plus')}Criar caixinha</button></div>`}
      <div class="bottom-bar"><div><div class="v">${money(t.falta)}</div><div class="l">Falta guardar</div></div><button class="pill" data-act="deposit">Depositar</button></div>`;
  };

  PAGES.caixa = () => {
    const b = boxById(S.boxId); const s = stats(b.id);
    const es = DB.entries.filter((e) => e.box_id === b.id);
    const moves = es.filter((e) => e.kind !== 'gasto').sort((a, c) => c.date.localeCompare(a.date) || c.id - a.id);
    const paid = es.filter((e) => e.kind === 'gasto' && e.settled_at).sort((a, c) => c.settled_at.localeCompare(a.settled_at) || c.id - a.id);
    const entryRow = (e, sign = '', cls = '') => `<div class="row"><div class="grow"><div class="t">${esc(e.description || (e.kind === 'deposito' ? 'Depósito' : e.kind === 'retirada' ? 'Retirada' : 'Despesa'))}</div><div class="d">${e.kind === 'deposito' ? 'Depósito' : e.kind === 'retirada' ? 'Retirada' : 'Despesa'} · ${fdate(e.date)}${e.settled_at ? ` · pago em ${fdate(e.settled_at)}` : ''}</div></div>
      <div class="amt ${cls}">${sign}${money(e.amount)}</div><div class="acts" style="opacity:1"><button type="button" class="btn ghost icon sm" data-act="entry-edit" data-id="${e.id}" aria-label="Editar">${icon('edit')}</button><button type="button" class="btn ghost icon sm" data-act="entry-del" data-id="${e.id}" aria-label="Excluir">${icon('trash')}</button></div></div>`;
    return `<section class="hero compact">${tile(b, 'xl')}
        <button class="hero-l" data-act="toggle-hide" style="margin-top:10px">Guardado ${icon(S.hide ? 'eyeoff' : 'eye')}</button>
        <div class="hero-v ${s.guardado < 0 ? 'neg' : ''}">${money(s.guardado)}</div>
        ${s.aberto ? `<span class="pill-tag ${s.falta ? 'warnp' : 'ok'}">${s.falta ? `Faltam ${money(s.falta)} de ${money(s.aberto)}` : s.sobra ? `Coberto · sobram ${money(s.sobra)}` : 'Tudo guardado'}</span>` : ''}
        <div class="circles">${circ('deposit', 'income', 'Depositar', `data-box="${b.id}"`)}${circ('expense', 'file', 'Nova despesa', `data-box="${b.id}"`)}${circ('pay', 'check', 'Paguei', `data-box="${b.id}"`)}${circ('withdraw', 'expense', 'Retirar', `data-box="${b.id}"`)}</div>
      </section>
      <div class="sec-row"><h2>Despesas a pagar</h2><span class="btn-row"><button type="button" class="btn sm" data-act="paste" data-box="${b.id}">${icon('copy')}Colar lista</button></span></div>
      <div class="flat-list">${s.open.length ? s.open.sort((a, c) => a.id - c.id).map((e) => entryRow(e)).join('') + `<div class="row"><div class="grow"><div class="t">Total</div></div><div class="amt" style="font-size:16px">${money(s.aberto)}</div><div style="width:64px"></div></div>`
        : '<div class="empty" style="padding:18px 0"><p style="margin:0">Nenhuma despesa a pagar. Adicione aqui o que você precisa pagar (fatura, pessoa, conta) para saber quanto guardar.</p></div>'}</div>
      <div class="sec-row"><h2>Depósitos e retiradas</h2></div>
      <div class="flat-list">${moves.length ? moves.map((e) => entryRow(e, e.kind === 'deposito' ? '+ ' : '− ', e.kind === 'deposito' ? 'pos' : '')).join('') : '<div class="empty" style="padding:18px 0"><p style="margin:0">Nenhum depósito ainda.</p></div>'}</div>
      ${paid.length ? `<div class="sec-row"><h2>Despesas já pagas</h2></div><div class="flat-list">${paid.map((e) => entryRow(e, '', 'faint')).join('')}</div>` : ''}
      ${b.notes ? `<div class="sec-row"><h2>Observações</h2></div><div class="flat-card" style="cursor:default;white-space:pre-wrap;color:var(--text-2)">${esc(b.notes)}</div>` : ''}
      <div class="btn-row" style="margin-top:24px"><button class="btn" data-act="box-edit" data-id="${b.id}">${icon('edit')}Editar caixinha</button><button class="btn ghost danger" data-act="box-del" data-id="${b.id}">${icon('trash')}Excluir</button></div>
      <div class="bottom-bar"><div><div class="v">${money(s.falta)}</div><div class="l">Falta guardar</div></div><button class="pill" data-act="deposit" data-box="${b.id}">Depositar</button></div>`;
  };

  PAGES.historico = () => {
    const f = S.hist; const q = f.q.trim().toLowerCase();
    const list = DB.entries.filter((e) => (!f.box || e.box_id === Number(f.box)) && (!f.kind || e.kind === f.kind) && (!q || (e.description || '').toLowerCase().includes(q) || (boxById(e.box_id)?.name || '').toLowerCase().includes(q)))
      .sort((a, c) => c.date.localeCompare(a.date) || c.id - a.id);
    const label = { deposito: 'Depósito', retirada: 'Retirada', gasto: 'Despesa' };
    return `<div class="btn-row" style="margin:8px 0 12px">
        <input class="inp sm" style="flex:1;min-width:160px" placeholder="Buscar" value="${esc(f.q)}" data-h="q">
        <select class="inp sm" style="width:auto" data-h="box"><option value="">Todas as caixinhas</option>${sortedBoxes().map((b) => `<option value="${b.id}" ${f.box === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <select class="inp sm" style="width:auto" data-h="kind"><option value="">Tudo</option>${Object.entries(label).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="flat-list">${list.length ? list.map((e) => { const b = boxById(e.box_id) || { name: '—', color: '#8a8a8a', icon: 'box' };
        return `<div class="row">${tile(b, 'sm')}<div class="grow"><div class="t">${esc(e.description || label[e.kind])}</div><div class="d">${label[e.kind]} · ${esc(b.name)} · ${fdate(e.date)}${e.settled_at ? ' · pago' : ''}</div></div>
          <div class="amt ${e.kind === 'deposito' ? 'pos' : ''}">${e.kind === 'deposito' ? '+ ' : e.kind === 'retirada' ? '− ' : ''}${money(e.amount)}</div>
          <div class="acts"><button type="button" class="btn ghost icon sm" data-act="entry-edit" data-id="${e.id}" aria-label="Editar">${icon('edit')}</button><button type="button" class="btn ghost icon sm" data-act="entry-del" data-id="${e.id}" aria-label="Excluir">${icon('trash')}</button></div></div>`; }).join('')
        : '<div class="empty"><p>Nada por aqui ainda.</p></div>'}</div>`;
  };
  MOUNT.historico = () => {
    $$('[data-h]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      S.hist[el.dataset.h] = el.value; const pos = el.selectionStart; render(false);
      if (el.dataset.h === 'q') { const i = $('[data-h="q"]'); i.focus(); i.setSelectionRange(pos, pos); }
    }));
  };

  PAGES.config = () => {
    const th = DB.settings.theme || 'system'; const lb = lastBackup();
    return `<div class="card pad" style="margin-top:8px">
      <div class="settings-sec"><div><h3>Seu nome</h3></div><form class="form" id="fName" style="max-width:420px">${tField('name', 'Nome', DB.name, { attrs: 'maxlength="80"' })}<div><button class="btn primary">Salvar</button></div></form></div>
      <div class="settings-sec"><div><h3>Aparência</h3></div><div class="type-tabs">${[['system', 'Sistema', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']].map(([k, l, ic]) => `<button class="chip ${th === k ? 'on' : ''}" data-act="theme-set" data-t="${k}">${icon(ic)}${l}</button>`).join('')}</div></div>
      <div class="settings-sec"><div><h3>Backup</h3><p>Os dados ficam só neste aparelho. Guarde um backup no app Arquivos ou no iCloud Drive.</p></div>
        <div style="display:flex;flex-direction:column;gap:10px"><div class="faint" style="font-size:13px">${lb ? `Último backup: ${fdate(lb)}` : 'Nenhum backup feito ainda.'}</div>
          <div class="btn-row"><button class="btn primary" data-act="backup-now">${icon('download')}Fazer backup</button><button class="btn" data-act="backup-restore">${icon('repeat')}Restaurar</button><button class="btn" data-act="csv">${icon('download')}Exportar CSV</button></div></div></div>
      <div class="settings-sec"><div><h3>Apagar dados</h3><p>Remove tudo deste aparelho.</p></div><div><button class="btn danger" data-act="reset-all">${icon('trash')}Apagar todos os dados</button></div></div></div>`;
  };
  MOUNT.config = () => { $('#fName').addEventListener('submit', (e) => { e.preventDefault(); const n = String(new FormData(e.target).get('name') || '').trim(); if (!n) return toast('Digite seu nome.', 'err'); DB.name = n.slice(0, 80); save(); toast('Nome salvo'); }); };

  // ───────────── formulários ─────────────
  function boxForm(b) {
    const isNew = !b; b = b || { name: '', icon: 'card', color: COLORS[DB.boxes.length % COLORS.length], notes: '' };
    modal({ title: isNew ? 'Nova caixinha' : 'Editar caixinha', submit: isNew ? 'Criar' : 'Salvar',
      body: `<div class="form">${tField('name', 'Nome', b.name, { attrs: 'maxlength="60" placeholder="Ex.: Fatura Nubank, Eloyse, Cartão do pai" autofocus' })}
        <div class="field"><label>Ícone</label><div class="icon-pick">${BOX_ICONS.map((ic) => `<label><input type="radio" name="icon" value="${ic}" ${b.icon === ic ? 'checked' : ''}>${icon(ic)}</label>`).join('')}</div></div>
        <div class="field"><label>Cor</label><div class="color-pick">${COLORS.map((c) => `<label style="background:${c}"><input type="radio" name="color" value="${c}" ${b.color === c ? 'checked' : ''}></label>`).join('')}</div></div>
        <div class="field"><label>Observações</label><textarea class="inp" name="notes" maxlength="1000">${esc(b.notes)}</textarea></div></div>`,
      onSubmit: (d) => {
        const p = { name: needText(d.name, 'o nome').slice(0, 60), icon: d.icon || 'box', color: d.color || b.color, notes: String(d.notes || '').slice(0, 1000) };
        if (isNew) { const nb = { id: nid(), ...p, position: DB.boxes.reduce((m, x) => Math.max(m, x.position), 0) + 1, created_at: todayISO() }; DB.boxes.push(nb); save(); toast('Caixinha criada'); go('caixa', nb.id); }
        else { Object.assign(b, p); save(); toast('Caixinha atualizada'); render(false); }
      } });
  }
  function needBoxes() { if (DB.boxes.length) return true; toast('Crie uma caixinha primeiro.', 'err'); boxForm(); return false; }
  function entryForm(kind, boxId, entry) {
    if (!needBoxes()) return;
    const isNew = !entry; const sel = entry ? entry.box_id : boxId || (S.route === 'caixa' ? S.boxId : sortedBoxes()[0].id);
    const T = { deposito: ['Depositar', 'Depósito do débito'], retirada: ['Retirar', 'Ex.: paguei parte da fatura'], gasto: ['Nova despesa', 'Ex.: SHEIN, aluguel, fatura'] }[kind];
    const sb = stats(Number(sel));
    modal({ title: isNew ? T[0] : 'Editar lançamento', submit: isNew ? (kind === 'gasto' ? 'Adicionar despesa' : T[0]) : 'Salvar',
      body: `<div class="form">${mField('amount', 'Valor', entry ? entry.amount : (kind === 'deposito' && isNew ? sb.falta : 0), { attrs: 'autofocus' })}
        <div class="field"><label>Caixinha</label><select class="inp" name="box_id">${boxOpts(sel)}</select></div>
        ${tField('description', 'Descrição', entry ? entry.description : '', { attrs: `maxlength="120" placeholder="${T[1]}"` })}
        ${tField('date', 'Data', entry ? entry.date : todayISO(), { type: 'date' })}</div>`,
      onSubmit: (d) => {
        const p = { amount: needMoney(d.amount), box_id: Number(d.box_id), description: String(d.description || '').trim().slice(0, 120), date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayISO() };
        if (kind === 'gasto' && !p.description) throw new Error('Informe a descrição da despesa.');
        if (isNew) DB.entries.push({ id: nid(), kind, settled_at: null, ...p }); else Object.assign(entry, p);
        save(); toast(isNew ? (kind === 'deposito' ? 'Depósito registrado' : kind === 'retirada' ? 'Retirada registrada' : 'Despesa adicionada') : 'Lançamento atualizado'); render(false);
      } });
  }
  function parseItemList(text) {
    const items = []; const bad = []; let total = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const m = line.match(/^(.*?)[\s:=–—-]*(?:R\$)?\s*(-?\d[\d.,]*)\s*$/i);
      const desc = m ? m[1].replace(/[\s:=–—-]+$/, '').trim() : ''; const val = m ? parseMoney(m[2]) : NaN;
      if (!m || !desc || !Number.isFinite(val) || val <= 0) { bad.push(line); continue; }
      if (/^(total|soma)$/i.test(desc)) { total = val; continue; }
      items.push({ description: desc.slice(0, 120), amount: val });
    }
    return { items, bad, total };
  }
  function pasteForm(boxId) {
    modal({ title: 'Colar lista de despesas', submit: 'Adicionar despesas', size: 'wide',
      body: `<div class="form"><div class="field"><label>Uma linha por despesa: descrição e valor</label><textarea class="inp" name="text" rows="8" placeholder="SHEIN: 436,05&#10;AIRBNB: 130&#10;total: 566,05" autofocus></textarea><div class="hint">A linha de “total” serve só para conferir a soma.</div></div><div id="pastePrev"></div></div>`,
      onOpen: (f) => { const ta = f.querySelector('textarea'); ta.addEventListener('input', () => {
        const r = parseItemList(ta.value); const sum = r.items.reduce((s, i) => s + i.amount, 0);
        $('#pastePrev', f).innerHTML = !ta.value.trim() ? '' : `<div class="alert ${r.bad.length || (r.total != null && r.total !== sum) ? 'warning' : 'info'}">${icon('info')}<div><b>${r.items.length} despesa(s)</b> · soma ${money(sum)}${r.total != null ? (r.total === sum ? ' — confere com o total' : ` — <b>diferente</b> do total (${money(r.total)})`) : ''}${r.bad.length ? `<br>Não entendi: ${r.bad.map(esc).join(' · ')}` : ''}</div></div>`;
      }); },
      onSubmit: (d) => {
        const r = parseItemList(d.text); if (!r.items.length) throw new Error('Nenhuma despesa encontrada. Use “descrição: valor”, um por linha.');
        r.items.forEach((i) => DB.entries.push({ id: nid(), box_id: boxId, kind: 'gasto', settled_at: null, date: todayISO(), ...i }));
        save(); toast(`${r.items.length} despesa(s) adicionada(s)`); render(false);
      } });
  }
  function payForm(boxId) {
    if (!needBoxes()) return;
    const withOpen = sortedBoxes().filter((b) => stats(b.id).aberto > 0);
    if (!withOpen.length) return toast('Nenhuma caixinha tem despesas a pagar.', 'err');
    const sel = boxId && withOpen.some((b) => b.id === boxId) ? boxId : withOpen[0].id;
    const body = (id) => { const s = stats(id); const out = Math.min(Math.max(s.guardado, 0), s.aberto);
      return `<div class="stat-line"><span class="l">Despesas a pagar</span><span class="v">${money(s.aberto)}</span></div>
        <div class="stat-line"><span class="l">Guardado na caixinha</span><span class="v">${money(s.guardado)}</span></div>
        <div class="stat-line tot"><span class="l">Sai da caixinha</span><span class="v">${money(out)}</span></div>
        ${s.falta ? `<div class="alert warning" style="margin-top:10px">${icon('alert')}<div>Faltavam ${money(s.falta)}: essa parte foi paga com dinheiro de fora da caixinha.</div></div>` : ''}
        ${s.sobra ? `<div class="alert info" style="margin-top:10px">${icon('info')}<div>Sobram ${money(s.sobra)} guardados na caixinha.</div></div>` : ''}`; };
    modal({ title: 'Registrar pagamento', submit: 'Confirmar pagamento',
      body: `<div class="form"><div class="field"><label>Caixinha</label><select class="inp" name="box_id" id="payBox">${withOpen.map((b) => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div><div id="payInfo">${body(sel)}</div>
        <p class="faint" style="font-size:12.5px;margin:0">As despesas passam para “Despesas já pagas” e o valor guardado sai da caixinha.</p></div>`,
      onOpen: (f) => { $('#payBox', f).addEventListener('change', (e) => { $('#payInfo', f).innerHTML = body(Number(e.target.value)); }); },
      onSubmit: (d) => {
        const id = Number(d.box_id); const s = stats(id); const out = Math.min(Math.max(s.guardado, 0), s.aberto); const today = todayISO();
        s.open.forEach((e) => { e.settled_at = today; });
        if (out > 0) DB.entries.push({ id: nid(), box_id: id, kind: 'retirada', amount: out, description: 'Pagamento', date: today, settled_at: null });
        save(); toast('Pagamento registrado'); render(false);
      } });
  }

  // ───────────── ações ─────────────
  function go(route, id) { location.hash = route === 'caixa' ? `#/caixa/${id}` : `#/${route}`; }
  function setTheme(t) {
    DB.settings.theme = t; save(); try { localStorage.setItem('caixas_theme', JSON.stringify(t)); } catch (e) { /* */ }
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    render(false);
  }
  const ACT = {
    'nav-open': () => $('.app').classList.add('nav-open'), 'nav-close': () => $('.app').classList.remove('nav-open'),
    back: () => go('inicio'),
    'toggle-hide': () => { S.hide = !S.hide; try { localStorage.setItem('caixas_hide', S.hide ? '1' : '0'); } catch (e) { /* */ } render(false); },
    'theme-cycle': () => setTheme({ system: 'light', light: 'dark', dark: 'system' }[DB.settings.theme || 'system']),
    'theme-set': (el) => setTheme(el.dataset.t),
    'box-new': () => boxForm(), 'box-open': (el) => go('caixa', el.dataset.id),
    'box-edit': (el) => boxForm(boxById(el.dataset.id)),
    'box-del': async (el) => { const b = boxById(el.dataset.id); const n = DB.entries.filter((e) => e.box_id === b.id).length;
      if (await confirmDlg(`Excluir a caixinha <b>${esc(b.name)}</b>${n ? ` e os ${n} lançamento(s) dela` : ''}? Isso não pode ser desfeito.`, { ok: 'Excluir', danger: true })) {
        DB.boxes = DB.boxes.filter((x) => x.id !== b.id); DB.entries = DB.entries.filter((e) => e.box_id !== b.id); save(); toast('Caixinha excluída'); go('inicio'); } },
    deposit: (el) => entryForm('deposito', el.dataset.box ? Number(el.dataset.box) : null),
    withdraw: (el) => entryForm('retirada', el.dataset.box ? Number(el.dataset.box) : null),
    expense: (el) => entryForm('gasto', el.dataset.box ? Number(el.dataset.box) : null),
    pay: (el) => payForm(el.dataset.box ? Number(el.dataset.box) : null),
    paste: (el) => pasteForm(Number(el.dataset.box)),
    'entry-edit': (el) => { const e = DB.entries.find((x) => x.id === Number(el.dataset.id)); if (e) entryForm(e.kind, e.box_id, e); },
    'entry-del': async (el) => { const e = DB.entries.find((x) => x.id === Number(el.dataset.id)); if (!e) return;
      if (await confirmDlg(`Excluir “${esc(e.description || 'lançamento')}” (${money(e.amount)})?`, { ok: 'Excluir', danger: true })) { DB.entries = DB.entries.filter((x) => x.id !== e.id); save(); render(false); } },
    'backup-now': () => { download(`caixas-backup-${todayISO()}.json`, JSON.stringify({ app: 'caixas', version: 3, exported_at: new Date().toISOString(), db: DB }, null, 1), 'application/json');
      try { localStorage.setItem('caixas_last_backup', todayISO()); } catch (e) { /* */ } toast('Backup gerado — guarde no app Arquivos ou no iCloud Drive'); if (DB.name) render(false); },
    'backup-restore': () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return;
        let data; try { data = JSON.parse(await f.text()); } catch (e) { return toast('Arquivo de backup inválido.', 'err'); }
        const db = data && data.app === 'caixas' && data.db && data.db.version === 3 ? data.db : null;
        if (!db || !Array.isArray(db.boxes) || !Array.isArray(db.entries)) return toast('Este arquivo não é um backup desta versão do Caixas.', 'err');
        if (DB.entries.length && !(await confirmDlg('Substituir os dados deste aparelho pelos do backup?', { ok: 'Restaurar', danger: true }))) return;
        DB = db; DB.flags = DB.flags || {}; DB.flags.eloyse = true; save(); toast('Backup restaurado'); root.innerHTML = ''; render(); };
      inp.click();
    },
    csv: () => { const lab = { deposito: 'Depósito', retirada: 'Retirada', gasto: 'Despesa' };
      const cell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const rows = [['Data', 'Caixinha', 'Tipo', 'Descrição', 'Valor (R$)', 'Pago em'], ...[...DB.entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [fdate(e.date), (boxById(e.box_id) || {}).name, lab[e.kind], e.description, (e.amount / 100).toFixed(2).replace('.', ','), e.settled_at ? fdate(e.settled_at) : ''])];
      download(`caixas-${todayISO()}.csv`, '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8'); },
    'reset-all': async () => { if (await confirmDlg('Apagar <b>todos</b> os dados deste aparelho? Isso não pode ser desfeito.', { ok: 'Apagar tudo', danger: true })) { DB = emptyDb(); DB.flags.eloyse = true; save(); root.innerHTML = ''; render(); } },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault();
    if (el.closest('.nav, .side')) $('.app')?.classList.remove('nav-open');
    Promise.resolve(fn(el, e)).catch((ex) => toast(ex.message, 'err'));
  });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.lrow[data-act]')) { e.preventDefault(); e.target.click(); } });

  // ───────────── rotas ─────────────
  function onHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const m = h.match(/^caixa\/(\d+)$/);
    if (m) { S.route = 'caixa'; S.boxId = Number(m[1]); } else S.route = ROUTES[h] ? h : 'inicio';
    closeAllModals(); render(true);
  }
  addEventListener('hashchange', onHash);
  load();
  const t = DB.settings.theme || 'system'; if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  root.innerHTML = ''; onHash();
})();
