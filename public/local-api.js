/* Caixas — "servidor" local: toda a lógica roda no navegador e os dados ficam salvos no aparelho.
 * Mesmas rotas da versão com servidor, para a interface continuar igual. Valores em centavos. */
(function () {
  'use strict';
  const KEY = 'caixas_db_v1';
  const TABLES = ['months', 'incomes', 'cards', 'boxes', 'box_months', 'transactions', 'card_purchases', 'card_invoices', 'close_moves'];
  const emptyDb = () => ({ version: 1, seq: {}, profile: { name: '', settings: { theme: 'system', salary: 0, salary_day: 5 }, created_at: new Date().toISOString() }, ...Object.fromEntries(TABLES.map((t) => [t, []])) });
  let DB;
  function load() {
    try { const raw = localStorage.getItem(KEY); DB = raw ? JSON.parse(raw) : emptyDb(); } catch (e) { DB = emptyDb(); }
    for (const t of TABLES) DB[t] = DB[t] || []; DB.seq = DB.seq || {};
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); }
    catch (e) { throw new HttpError(500, 'Não foi possível salvar no aparelho (armazenamento cheio ou bloqueado).'); }
  }
  load();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* */ }

  // ───────────── utilidades ─────────────
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const bad = (msg) => { throw new HttpError(400, msg); };
  const pad = (n) => String(n).padStart(2, '0');
  const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  const currentYm = () => todayISO().slice(0, 7);
  function ymAdd(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${pad(m)}`; }
  function ymDiff(a, b) { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); }
  const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const dayDate = (ym, day) => `${ym}-${pad(Math.min(Math.max(1, day), daysIn(ym)))}`;
  function vYm(v) { if (typeof v !== 'string' || !YM_RE.test(v)) bad('Mês inválido.'); return v; }
  function vDate(v, fallback) { if (v == null || v === '') { if (fallback) return fallback; bad('Data inválida.'); } if (!DATE_RE.test(v) || isNaN(Date.parse(v))) bad('Data inválida.'); return v; }
  function vMoney(v, { allowZero = true, allowNeg = false } = {}) {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) bad('Valor inválido.');
    if (!allowNeg && n < 0) bad('O valor não pode ser negativo.');
    if (!allowZero && n === 0) bad('Informe um valor maior que zero.');
    if (Math.abs(n) > 1e13) bad('Valor muito alto.');
    return n;
  }
  function vStr(v, max = 200, required = false, label = 'Campo') { const s = (v == null ? '' : String(v)).trim(); if (required && !s) bad(`${label} é obrigatório.`); if (s.length > max) bad(`${label} muito longo.`); return s; }
  function vInt(v, min, max, label) { if (v == null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) bad(`${label} inválido.`); return n; }
  function vColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#2a78d6'; }
  const BOX_TYPES = ['pagamento', 'consumo', 'acumulacao', 'meta'];
  const isPersistent = (type) => type === 'acumulacao' || type === 'meta';
  const nextId = (t) => (DB.seq[t] = (DB.seq[t] || DB[t].reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1);
  const insert = (t, row) => { if (t !== 'months' && t !== 'box_months' && t !== 'card_invoices') row.id = nextId(t); DB[t].push(row); return row; };
  const remove = (t, pred) => { DB[t] = DB[t].filter((r) => !pred(r)); };
  const byId = (t, id) => DB[t].find((r) => r.id === Number(id));
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  // ───────────── domínio ─────────────
  const monthRow = (ym) => DB.months.find((m) => m.ym === ym);
  const isClosed = (ym) => { const m = monthRow(ym); return !!(m && m.closed); };
  function assertOpen(ym) { if (isClosed(ym)) bad('Este mês está fechado. Reabra o mês para fazer alterações.'); }
  function boxOwned(id) { const b = byId('boxes', id); if (!b) throw new HttpError(404, 'Caixa não encontrada.'); return b; }
  function cardOwned(id) { const c = byId('cards', id); if (!c) throw new HttpError(404, 'Cartão não encontrado.'); return c; }
  const bmOf = (boxId, ym) => DB.box_months.find((r) => r.box_id === boxId && r.ym === ym);
  function addBoxToMonth(box, ym, planned) {
    if (bmOf(box.id, ym)) return;
    DB.box_months.push({ box_id: box.id, ym, planned: planned ?? box.default_planned ?? 0, paid: 0, paid_at: null, paid_tx: null, due_date: box.due_day ? dayDate(ym, box.due_day) : null });
  }
  function ensureMonth(ym) {
    let m = monthRow(ym);
    if (m && m.initialized) return;
    if (!m) m = insert('months', { ym, initialized: 0, closed: 0, closed_at: null, notes: '' });
    for (const b of DB.boxes) if (!b.archived && b.start_ym <= ym && (b.recurring || isPersistent(b.type))) addBoxToMonth(b, ym);
    m.initialized = 1;
  }
  function firstInvoiceYm(card, date) {
    const ym = date.slice(0, 7); const day = Number(date.slice(8, 10));
    let base = card.due_day > card.closing_day ? ym : ymAdd(ym, 1);
    if (day >= card.closing_day) base = ymAdd(base, 1);
    return base;
  }
  function installmentValue(p, k) { const base = Math.floor(p.amount / p.installments); return k === 1 ? p.amount - base * (p.installments - 1) : base; }
  function purchasesInInvoice(purchases, ym) {
    const out = [];
    for (const p of purchases) { const k = ymDiff(p.first_ym, ym) + 1; if (k >= 1 && k <= p.installments) out.push({ ...p, k, value: installmentValue(p, k), remaining: p.installments - k }); }
    return out;
  }
  function makeCtx() {
    const boxes = new Map(DB.boxes.map((b) => [b.id, b]));
    const agg = new Map();
    const A = (box, ym) => { const k = `${box}|${ym}`; let a = agg.get(k); if (!a) { a = { reserved: 0, used: 0, tin: 0, tout: 0 }; agg.set(k, a); } return a; };
    for (const t of DB.transactions) {
      if (t.kind === 'reserva') A(t.box_id, t.ym).reserved += t.amount;
      else if (t.kind === 'gasto' || t.kind === 'pagamento') A(t.box_id, t.ym).used += t.amount;
      else if (t.kind === 'transferencia') { A(t.box_id, t.ym).tout += t.amount; A(t.to_box_id, t.ym).tin += t.amount; }
    }
    const closed = new Set(DB.months.filter((m) => m.closed).map((m) => m.ym));
    const moves = new Map();
    for (const m of DB.close_moves) { if (!moves.has(m.ym)) moves.set(m.ym, []); moves.get(m.ym).push(m); }
    const memo = new Map(); const empty = { reserved: 0, used: 0, tin: 0, tout: 0 };
    function opening(boxId, ym) {
      const prev = ymAdd(ym, -1);
      if (closed.has(prev)) return sum(moves.get(prev) || [], (m) => (((m.dest === 'manter' && m.box_id === boxId) || (m.dest === 'caixa' && m.dest_box_id === boxId)) ? m.amount : 0));
      const b = boxes.get(boxId);
      if (b && isPersistent(b.type) && b.start_ym <= prev) return saldo(boxId, prev);
      return 0;
    }
    function saldo(boxId, ym) {
      const k = `${boxId}|${ym}`; if (memo.has(k)) return memo.get(k);
      const a = agg.get(k) || empty; const v = opening(boxId, ym) + a.reserved + a.tin - a.tout - a.used;
      memo.set(k, v); return v;
    }
    function carryIn(ym) { const prev = ymAdd(ym, -1); return closed.has(prev) ? sum((moves.get(prev) || []).filter((m) => m.dest === 'livre'), (m) => m.amount) : 0; }
    return { boxes, agg: (b, ym) => agg.get(`${b}|${ym}`) || empty, opening, saldo, carryIn };
  }
  function purchasesMap() {
    const m = new Map();
    for (const p of DB.card_purchases) { if (!m.has(p.card_id)) m.set(p.card_id, []); m.get(p.card_id).push(p); }
    return m;
  }
  const invRow = (cardId, ym) => DB.card_invoices.find((r) => r.card_id === cardId && r.ym === ym);
  function cardInvoice(card, ym, pm) {
    const list = purchasesInInvoice(pm.get(card.id) || [], ym);
    const inv = invRow(card.id, ym) || { paid: 0, adjustment: 0 };
    const total = sum(list, (p) => p.value) + (inv.adjustment || 0);
    const due_date = dayDate(ym, card.due_day);
    const closing_date = dayDate(card.due_day > card.closing_day ? ym : ymAdd(ym, -1), card.closing_day);
    const status = inv.paid ? 'pago' : (total > 0 && due_date < todayISO() ? 'vencido' : 'pendente');
    return { ym, total, adjustment: inv.adjustment || 0, paid: !!inv.paid, paid_at: inv.paid_at || null, paid_tx: inv.paid_tx || null, due_date, closing_date, status, purchases: list.sort((a, b) => a.date.localeCompare(b.date)) };
  }
  const sortPos = (a, b) => (a.archived - b.archived) || (a.position - b.position) || (a.id - b.id);

  function monthView(ym) {
    ensureMonth(ym);
    const ctx = makeCtx(); const m = monthRow(ym); const prev = monthRow(ymAdd(ym, -1)); const today = todayISO(); const pm = purchasesMap();
    const cards = [...DB.cards].sort(sortPos).map((c) => ({
      ...c, invoice: cardInvoice(c, ym, pm),
      next: Array.from({ length: 6 }, (_, i) => { const y = ymAdd(ym, i + 1); return { ym: y, total: sum(purchasesInInvoice(pm.get(c.id) || [], y), (p) => p.value) }; }),
    }));
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const rows = DB.box_months.filter((r) => r.ym === ym).map((r) => ({ bm: r, b: ctx.boxes.get(r.box_id) })).filter((x) => x.b)
      .sort((x, y) => (x.b.position - y.b.position) || (x.b.id - y.b.id));
    const boxes = rows.map(({ bm, b }) => {
      const a = ctx.agg(b.id, ym); const opening = ctx.opening(b.id, ym);
      const card = b.card_id ? cardById.get(b.card_id) : null;
      const items = bm.items || [];
      const planned = card ? card.invoice.total : items.length ? sum(items, (i) => i.amount) : bm.planned;
      const paid = card ? card.invoice.paid : !!bm.paid;
      const due_date = card ? card.invoice.due_date : bm.due_date;
      let status = null;
      if (b.type === 'pagamento') status = paid ? 'pago' : (due_date && due_date < today ? 'vencido' : 'pendente');
      return {
        id: b.id, name: b.name, icon: b.icon, color: b.color, type: b.type, target: b.target, target_date: b.target_date,
        due_day: b.due_day, notes: b.notes, recurring: b.recurring, default_planned: b.default_planned, position: b.position,
        card_id: b.card_id, card_name: card ? card.name : null, archived: b.archived, start_ym: b.start_ym,
        planned, planned_manual: bm.planned, items: items.map((i) => ({ ...i })), opening, reserved: a.reserved, used: a.used, tin: a.tin, tout: a.tout,
        saldo: opening + a.reserved + a.tin - a.tout - a.used, paid, paid_at: card ? card.invoice.paid_at : bm.paid_at, due_date, status,
      };
    });
    const inMonth = new Set(boxes.map((b) => b.id));
    const other_boxes = DB.boxes.filter((b) => !inMonth.has(b.id) && !b.archived).map((b) => ({ id: b.id, name: b.name, icon: b.icon, color: b.color, type: b.type }));
    const incomes = DB.incomes.filter((i) => i.ym === ym).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const salary = sum(incomes.filter((i) => i.kind === 'salario'), (i) => i.amount);
    const extras = sum(incomes.filter((i) => i.kind !== 'salario'), (i) => i.amount);
    const carry_in = ctx.carryIn(ym); const total_income = salary + extras + carry_in;
    const distributed = sum(boxes, (b) => b.reserved);
    const payBoxes = boxes.filter((b) => b.type === 'pagamento');
    const boxes_balance = sum(boxes, (b) => b.saldo); const undistributed = total_income - distributed;
    const summary = {
      salary, extras, carry_in, total_income, distributed, undistributed, opening_total: sum(boxes, (b) => b.opening), used_total: sum(boxes, (b) => b.used),
      paid_total: sum(payBoxes, (b) => b.used), pending_total: sum(payBoxes.filter((b) => !b.paid), (b) => Math.max(b.planned - b.used, 0)),
      boxes_balance, balance: undistributed + boxes_balance, planned_total: sum(boxes, (b) => b.planned || 0),
      available: sum(boxes, (b) => Math.max(b.saldo, 0)), organization: total_income > 0 ? Math.min(distributed / total_income, 9.99) : 0,
      overdue_count: payBoxes.filter((b) => b.status === 'vencido').length,
    };
    const alerts = [];
    if (undistributed < 0) alerts.push({ level: 'critical', text: 'A distribuição ultrapassa os recursos disponíveis.', amount: -undistributed, code: 'over' });
    for (const b of boxes) if (b.saldo < 0) alerts.push({ level: 'warning', code: 'neg', box_id: b.id, text: `A caixa “${b.name}” está com saldo negativo.`, amount: b.saldo });
    if (summary.overdue_count) alerts.push({ level: 'critical', code: 'overdue', text: `${summary.overdue_count} conta(s) vencida(s) sem pagamento.` });
    return { ym, today, month: { closed: !!m.closed, closed_at: m.closed_at, notes: m.notes, prev_exists: !!prev, prev_closed: !!(prev && prev.closed) }, incomes, boxes, other_boxes, cards, summary, alerts };
  }
  function txView(t) {
    const b1 = byId('boxes', t.box_id), b2 = byId('boxes', t.to_box_id), c = byId('cards', t.card_id);
    return { ...t, box_name: b1 ? b1.name : null, box_color: b1 ? b1.color : null, box_icon: b1 ? b1.icon : null, to_box_name: b2 ? b2.name : null, to_box_color: b2 ? b2.color : null, card_name: c ? c.name : null };
  }
  const txSort = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;

  function projection(ym, n) {
    const st = DB.profile.settings || {}; const pm = purchasesMap();
    const cards = DB.cards.filter((c) => !c.archived);
    const recurring = DB.boxes.filter((b) => !b.archived && b.recurring && b.type === 'pagamento' && !b.card_id);
    const salYms = DB.incomes.filter((i) => i.kind === 'salario' && i.ym <= ym).map((i) => i.ym).sort();
    const lastYm = salYms[salYms.length - 1];
    const lastSalary = lastYm ? sum(DB.incomes.filter((i) => i.kind === 'salario' && i.ym === lastYm), (i) => i.amount) : 0;
    const expected = Number(st.salary) || lastSalary || 0;
    return Array.from({ length: n }, (_, i) => {
      const m = ymAdd(ym, i + 1);
      const cardsTotal = cards.map((c) => ({ id: c.id, name: c.name, color: c.color, total: sum(purchasesInInvoice(pm.get(c.id) || [], m), (p) => p.value) }));
      const bills = recurring.map((b) => { const row = bmOf(b.id, m); return { id: b.id, name: b.name, color: b.color, total: row ? row.planned : b.default_planned }; });
      const income = sum(DB.incomes.filter((x) => x.ym === m), (x) => x.amount) || expected;
      const committed = sum(cardsTotal, (c) => c.total) + sum(bills, (b) => b.total);
      return { ym: m, income, committed, cards: cardsTotal, bills, ratio: income > 0 ? committed / income : null };
    });
  }
  function reports(ym) {
    const months = Array.from({ length: 6 }, (_, i) => ymAdd(ym, i - 5));
    const ctx = makeCtx(); const persistent = DB.boxes.filter((b) => isPersistent(b.type));
    const series = months.map((m) => {
      const inc = DB.incomes.filter((i) => i.ym === m); const tx = DB.transactions.filter((t) => t.ym === m);
      const sal = sum(inc.filter((i) => i.kind === 'salario'), (i) => i.amount), ext = sum(inc.filter((i) => i.kind !== 'salario'), (i) => i.amount);
      const reserves = persistent.filter((b) => b.start_ym <= m).map((b) => ({ id: b.id, name: b.name, color: b.color, saldo: ctx.saldo(b.id, m) }));
      return { ym: m, salary: sal, extras: ext, income: sal + ext, distributed: sum(tx.filter((t) => t.kind === 'reserva'), (t) => t.amount),
        used: sum(tx.filter((t) => t.kind === 'gasto' || t.kind === 'pagamento'), (t) => t.amount), planned: sum(DB.box_months.filter((r) => r.ym === m), (r) => r.planned),
        reserves, reserves_total: sum(reserves, (r) => r.saldo) };
    });
    const view = monthView(ym);
    const distribution = view.boxes.filter((b) => b.reserved > 0).map((b) => ({ id: b.id, name: b.name, color: b.color, value: b.reserved }));
    // Compras no cartão entram pela parcela da fatura; o pagamento da fatura não é contado de novo.
    const cat = new Map();
    const addCat = (key, name, color, v) => { const c = cat.get(key) || { name, color, value: 0 }; c.value += v; cat.set(key, c); };
    for (const t of DB.transactions) if (t.ym === ym && (t.kind === 'gasto' || t.kind === 'pagamento') && !t.card_id) { const b = byId('boxes', t.box_id); if (b) addCat(`b${b.id}`, b.name, b.color, t.amount); }
    const boxByName = new Map(DB.boxes.map((b) => [b.name.toLowerCase(), b]));
    for (const c of view.cards) for (const p of c.invoice.purchases) {
      const name = p.category || `Cartão · ${c.name}`; const b = boxByName.get(name.toLowerCase());
      addCat(b ? `b${b.id}` : `c:${name}`, b ? b.name : name, b ? b.color : c.color, p.value);
    }
    const categories = [...cat.values()].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
    const plan_vs_real = view.boxes.map((b) => ({ id: b.id, name: b.name, color: b.color, type: b.type, planned: b.planned, executed: isPersistent(b.type) ? b.reserved + b.tin - b.tout : b.used }));
    return { months: series, distribution, categories, plan_vs_real, commitment: projection(ym, 6), summary: view.summary };
  }
  function calendar(ym) {
    const v = monthView(ym); const ev = []; const today = todayISO();
    for (const i of v.incomes) ev.push({ date: i.date, type: 'recebimento', title: i.description || (i.kind === 'salario' ? 'Salário' : 'Receita extra'), amount: i.amount, status: i.date <= today ? 'recebido' : 'previsto' });
    for (const b of v.boxes) {
      if (b.type === 'pagamento' && b.due_date && !b.card_id) ev.push({ date: b.due_date, type: 'vencimento', title: b.name, amount: b.planned, status: b.status, box_id: b.id, color: b.color });
      if (b.type === 'meta' && b.target_date && b.target_date.slice(0, 7) === ym) ev.push({ date: b.target_date, type: 'meta', title: `Meta: ${b.name}`, amount: b.target, status: b.saldo >= b.target ? 'pago' : 'pendente', color: b.color });
    }
    for (const c of v.cards) {
      if (c.archived) continue;
      if (c.invoice.total > 0 || c.invoice.paid) ev.push({ date: c.invoice.due_date, type: 'fatura', title: `Fatura ${c.name}`, amount: c.invoice.total, status: c.invoice.status, card_id: c.id, color: c.color });
      if (c.invoice.closing_date.slice(0, 7) === ym) ev.push({ date: c.invoice.closing_date, type: 'fechamento', title: `Fechamento ${c.name}`, amount: null, status: 'info', card_id: c.id, color: c.color });
      for (const p of c.invoice.purchases) if (p.installments > 1) ev.push({ date: c.invoice.due_date, type: 'parcela', title: `${p.description} (${p.k}/${p.installments})`, amount: p.value, status: c.invoice.status, card_id: c.id, color: c.color });
    }
    for (const t of DB.transactions) if (t.ym === ym && t.kind === 'pagamento') { const b = byId('boxes', t.box_id); ev.push({ date: t.date, type: 'pagamento', title: `Pago: ${(t.card_id ? t.description : b && b.name) || t.description || ''}`, amount: t.amount, status: 'pago' }); }
    ev.sort((a, b) => a.date.localeCompare(b.date));
    return { ym, events: ev };
  }

  // ───────────── CSV ─────────────
  const brMoney = (c) => (c / 100).toFixed(2).replace('.', ',');
  const brDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const brYm = (ym) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
  const KIND_LABEL = { reserva: 'Distribuição', gasto: 'Gasto', pagamento: 'Pagamento', transferencia: 'Transferência' };
  const TYPE_LABEL = { pagamento: 'Pagamento', consumo: 'Consumo', acumulacao: 'Acumulação', meta: 'Meta' };
  function csv(rows) { const cell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'); }
  function exportCsv(kind, ym) {
    if (kind === 'movimentacoes') {
      const rows = DB.transactions.filter((t) => !ym || t.ym === ym).map(txView).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      return csv([['Data', 'Competência', 'Tipo', 'Caixa', 'Caixa destino', 'Cartão', 'Descrição', 'Valor (R$)'], ...rows.map((t) => [brDate(t.date), brYm(t.ym), KIND_LABEL[t.kind] || t.kind, t.box_name, t.to_box_name, t.card_name, t.description, brMoney(t.amount)])]);
    }
    if (kind === 'receitas') {
      const rows = DB.incomes.filter((i) => !ym || i.ym === ym).sort((a, b) => a.date.localeCompare(b.date));
      return csv([['Competência', 'Tipo', 'Descrição', 'Data', 'Valor (R$)'], ...rows.map((i) => [brYm(i.ym), i.kind === 'salario' ? 'Salário' : 'Extra', i.description, brDate(i.date), brMoney(i.amount)])]);
    }
    if (kind === 'caixas') {
      const m = ym || currentYm(); const v = monthView(m);
      return csv([['Competência', 'Caixa', 'Modalidade', 'Planejado', 'Saldo inicial', 'Reservado', 'Transf. recebidas', 'Transf. enviadas', 'Utilizado', 'Saldo', 'Meta', 'Vencimento', 'Status', 'Observações'],
        ...v.boxes.map((b) => [brYm(m), b.name, TYPE_LABEL[b.type], brMoney(b.planned), brMoney(b.opening), brMoney(b.reserved), brMoney(b.tin), brMoney(b.tout), brMoney(b.used), brMoney(b.saldo), b.type === 'meta' ? brMoney(b.target) : '', brDate(b.due_date), b.status || '', b.notes])]);
    }
    if (kind === 'cartoes') {
      const rows = DB.card_purchases.map((p) => ({ ...p, c: byId('cards', p.card_id) || {} })).sort((a, b) => (a.c.name || '').localeCompare(b.c.name || '') || a.date.localeCompare(b.date));
      return csv([['Cartão', 'Titular', 'Descrição', 'Data da compra', 'Valor total (R$)', 'Parcelas', 'Valor da parcela (R$)', 'Primeira fatura', 'Última fatura', 'Categoria'],
        ...rows.map((p) => [p.c.name, p.c.holder, p.description, brDate(p.date), brMoney(p.amount), p.installments, brMoney(installmentValue(p, p.installments >= 2 ? 2 : 1)), brYm(p.first_ym), brYm(ymAdd(p.first_ym, p.installments - 1)), p.category])]);
    }
    bad('Tipo de exportação inválido.');
  }

  // ───────────── rotas ─────────────
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

  route('GET', '/api/me', () => ({ id: 1, name: DB.profile.name || '', email: 'Dados salvos neste aparelho', settings: DB.profile.settings, created_at: DB.profile.created_at, has_data: DB.boxes.length > 0 }));
  route('PUT', '/api/me', ({ body }) => {
    if (body.name != null) DB.profile.name = vStr(body.name, 80, true, 'Nome');
    const s = { ...DB.profile.settings };
    if (body.settings) {
      const b = body.settings;
      if (b.theme && ['system', 'light', 'dark'].includes(b.theme)) s.theme = b.theme;
      if (b.salary != null) s.salary = vMoney(b.salary);
      if (b.salary_day != null) s.salary_day = vInt(b.salary_day, 1, 31, 'Dia do salário');
      if (b.salary_desc != null) s.salary_desc = vStr(b.salary_desc, 80);
    }
    DB.profile.settings = s; return { ok: true, settings: s, name: DB.profile.name || 'Você' };
  });
  route('POST', '/api/onboarding', ({ body }) => {
    const ym = vYm(body.ym); ensureMonth(ym);
    const tpl = [['Fatura do meu cartão', 'card', '#2a78d6', 'pagamento'], ['Cartão do meu pai', 'users', '#6250d6', 'pagamento'], ['Contas fixas', 'home', '#eb6834', 'pagamento'],
      ['Alimentação', 'cart', '#1baf7a', 'consumo'], ['Transporte', 'car', '#eda100', 'consumo'], ['Lazer', 'smile', '#e87ba4', 'consumo'],
      ['Compras pessoais', 'bag', '#e34948', 'consumo'], ['Reserva financeira', 'shield', '#008300', 'acumulacao'], ['Metas futuras', 'target', '#6250d6', 'meta']];
    tpl.forEach(([name, icon, color, type], i) => { const b = insert('boxes', newBox({ name, icon, color, type, position: i, start_ym: ym })); addBoxToMonth(b, ym); });
    return { ok: true };
  });
  function newBox(o) { return { name: '', icon: 'box', color: '#2a78d6', type: 'consumo', target: 0, target_date: null, due_day: null, notes: '', recurring: 1, default_planned: 0, position: 0, card_id: null, archived: 0, start_ym: currentYm(), created_at: new Date().toISOString(), ...o }; }

  route('GET', '/api/month/:ym', ({ params }) => monthView(vYm(params.ym)));
  route('PUT', '/api/month/:ym/notes', ({ params, body }) => { const ym = vYm(params.ym); ensureMonth(ym); monthRow(ym).notes = vStr(body.notes, 4000); return { ok: true }; });
  route('POST', '/api/month/:ym/replicate', ({ params }) => {
    const ym = vYm(params.ym); assertOpen(ym); ensureMonth(ym); const prev = ymAdd(ym, -1);
    const rows = DB.box_months.filter((r) => r.ym === prev); if (!rows.length) bad('O mês anterior não possui caixas para replicar.');
    let added = 0, updated = 0;
    for (const r of rows) {
      const b = byId('boxes', r.box_id); if (!b || b.archived) continue;
      const ex = bmOf(b.id, ym);
      if (!ex) { addBoxToMonth(b, ym, r.planned); added++; } else if (!ex.planned && r.planned) { ex.planned = r.planned; updated++; }
    }
    return { ok: true, added, updated };
  });
  route('POST', '/api/month/:ym/close', ({ params, body }) => {
    const ym = vYm(params.ym); assertOpen(ym);
    const v = monthView(ym); const dest = new Map((body.moves || []).map((m) => [Number(m.box_id), m])); const nxt = ymAdd(ym, 1);
    for (const b of v.boxes) {
      if (b.saldo === 0) continue;
      const m = dest.get(b.id) || { dest: isPersistent(b.type) ? 'manter' : 'livre' };
      let d = ['manter', 'caixa', 'livre'].includes(m.dest) ? m.dest : 'livre'; let destBox = null;
      if (d === 'caixa') { destBox = boxOwned(m.dest_box_id).id; if (destBox === b.id) d = 'manter'; }
      insert('close_moves', { ym, box_id: b.id, dest: d, dest_box_id: destBox, amount: b.saldo });
      const target = d === 'manter' ? b.id : d === 'caixa' ? destBox : null;
      if (target) { ensureMonth(nxt); addBoxToMonth(boxOwned(target), nxt); }
    }
    if (v.summary.undistributed !== 0) insert('close_moves', { ym, box_id: null, dest: 'livre', dest_box_id: null, amount: v.summary.undistributed });
    const row = monthRow(ym); row.closed = 1; row.closed_at = new Date().toISOString();
    return { ok: true };
  });
  route('POST', '/api/month/:ym/reopen', ({ params }) => {
    const ym = vYm(params.ym); if (isClosed(ymAdd(ym, 1))) bad('Reabra primeiro o mês seguinte, que também está fechado.');
    remove('close_moves', (m) => m.ym === ym); const row = monthRow(ym); if (row) { row.closed = 0; row.closed_at = null; }
    return { ok: true };
  });

  function incomeBody(body) { const kind = body.kind === 'salario' ? 'salario' : 'extra'; const date = vDate(body.date); return { kind, date, ym: body.ym ? vYm(body.ym) : date.slice(0, 7), description: vStr(body.description, 120), amount: vMoney(body.amount, { allowZero: false }) }; }
  route('POST', '/api/incomes', ({ body }) => { const i = incomeBody(body); assertOpen(i.ym); ensureMonth(i.ym); const r = insert('incomes', { ...i, created_at: new Date().toISOString() }); return { ok: true, id: r.id }; });
  route('PUT', '/api/incomes/:id', ({ params, body }) => { const ex = byId('incomes', params.id); if (!ex) throw new HttpError(404, 'Receita não encontrada.'); const i = incomeBody({ ym: ex.ym, ...body }); assertOpen(ex.ym); assertOpen(i.ym); Object.assign(ex, i); return { ok: true }; });
  route('DELETE', '/api/incomes/:id', ({ params }) => { const ex = byId('incomes', params.id); if (!ex) throw new HttpError(404, 'Receita não encontrada.'); assertOpen(ex.ym); remove('incomes', (r) => r.id === ex.id); return { ok: true }; });

  function boxBody(body, ex = {}) {
    const type = body.type ?? ex.type; if (!BOX_TYPES.includes(type)) bad('Modalidade inválida.');
    const td = body.target_date !== undefined ? body.target_date : ex.target_date;
    return {
      name: vStr(body.name ?? ex.name, 60, true, 'Nome'), icon: vStr(body.icon ?? ex.icon ?? 'box', 20) || 'box', color: vColor(body.color ?? ex.color), type,
      target: vMoney(body.target ?? ex.target ?? 0), target_date: td ? vDate(td) : null,
      due_day: vInt(body.due_day !== undefined ? body.due_day : ex.due_day, 1, 31, 'Dia de vencimento'),
      notes: vStr(body.notes ?? ex.notes ?? '', 2000), recurring: (body.recurring ?? ex.recurring ?? 1) ? 1 : 0,
      default_planned: vMoney(body.default_planned ?? ex.default_planned ?? 0), card_id: body.card_id !== undefined ? (body.card_id ? Number(body.card_id) : null) : (ex.card_id ?? null),
    };
  }
  route('POST', '/api/boxes', ({ body }) => {
    const ym = vYm(body.ym); const b = boxBody(body); if (b.card_id) cardOwned(b.card_id); assertOpen(ym); ensureMonth(ym);
    const pos = DB.boxes.reduce((m, x) => Math.max(m, x.position), -1) + 1;
    const box = insert('boxes', newBox({ ...b, position: pos, start_ym: ym }));
    addBoxToMonth(box, ym, body.planned != null ? vMoney(body.planned) : b.default_planned);
    if (b.recurring || isPersistent(b.type)) for (const m of DB.months) if (m.initialized && m.ym > ym && !m.closed) addBoxToMonth(box, m.ym);
    return { ok: true, id: box.id };
  });
  route('PUT', '/api/boxes/:id', ({ params, body }) => {
    const ex = boxOwned(params.id); const b = boxBody(body, ex); if (b.card_id) cardOwned(b.card_id); Object.assign(ex, b);
    if (body.ym && YM_RE.test(body.ym) && !isClosed(body.ym)) {
      const bm = bmOf(ex.id, body.ym);
      if (bm && body.planned != null) bm.planned = vMoney(body.planned);
      if (bm && body.due_day !== undefined) bm.due_date = b.due_day ? dayDate(body.ym, b.due_day) : null;
    }
    return { ok: true };
  });
  function deleteBoxCascade(id) {
    const txIds = new Set(DB.transactions.filter((t) => t.box_id === id || t.to_box_id === id).map((t) => t.id));
    for (const inv of DB.card_invoices) if (txIds.has(inv.paid_tx)) { inv.paid = 0; inv.paid_tx = null; inv.paid_at = null; }
    remove('transactions', (t) => txIds.has(t.id)); remove('box_months', (r) => r.box_id === id); remove('boxes', (b) => b.id === id);
  }
  route('DELETE', '/api/boxes/:id', ({ params }) => {
    const ex = boxOwned(params.id);
    const closedUse = DB.transactions.some((t) => (t.box_id === ex.id || t.to_box_id === ex.id) && isClosed(t.ym));
    if (closedUse) {
      ex.archived = 1;
      remove('box_months', (r) => r.box_id === ex.id && !isClosed(r.ym));
      remove('transactions', (t) => (t.box_id === ex.id || t.to_box_id === ex.id) && !isClosed(t.ym));
      return { ok: true, archived: true };
    }
    deleteBoxCascade(ex.id); return { ok: true };
  });
  route('POST', '/api/boxes/:id/duplicate', ({ params, body }) => {
    const ex = boxOwned(params.id); const ym = vYm(body.ym); assertOpen(ym); const bm = bmOf(ex.id, ym);
    for (const b of DB.boxes) if (b.position > ex.position) b.position++;
    const { id, created_at, ...rest } = ex;
    const nb = insert('boxes', newBox({ ...rest, name: `${ex.name} (cópia)`.slice(0, 60), card_id: null, archived: 0, position: ex.position + 1, start_ym: ym }));
    addBoxToMonth(nb, ym, bm ? bm.planned : ex.default_planned);
    return { ok: true, id: nb.id };
  });
  route('POST', '/api/boxes/reorder', ({ body }) => {
    const ids = (body.ids || []).map(Number);
    const full = [...DB.boxes].sort((a, b) => a.position - b.position || a.id - b.id).map((b) => b.id);
    const visible = new Set(ids.filter((id) => full.includes(id))); const queue = ids.filter((id) => visible.has(id));
    full.map((id) => (visible.has(id) ? queue.shift() : id)).forEach((id, i) => { byId('boxes', id).position = i; });
    return { ok: true };
  });
  route('POST', '/api/boxes/:id/month', ({ params, body }) => { const ex = boxOwned(params.id); const ym = vYm(body.ym); assertOpen(ym); ensureMonth(ym); ex.archived = 0; addBoxToMonth(ex, ym); return { ok: true }; });
  route('DELETE', '/api/boxes/:id/month/:ym', ({ params }) => {
    const ex = boxOwned(params.id); const ym = vYm(params.ym); assertOpen(ym);
    if (DB.transactions.some((t) => (t.box_id === ex.id || t.to_box_id === ex.id) && t.ym === ym)) bad('A caixa possui movimentações neste mês. Remova-as antes de retirá-la do mês.');
    remove('box_months', (r) => r.box_id === ex.id && r.ym === ym); return { ok: true };
  });
  // Itens de uma conta (ex.: compras que compõem um pagamento). O valor da conta passa a ser a soma dos itens.
  function itemsCtx(params, body) {
    const b = boxOwned(params.id); const ym = vYm(body.ym); assertOpen(ym); ensureMonth(ym);
    if (b.type !== 'pagamento') bad('Itens só podem ser usados em caixas de Pagamento.');
    if (b.card_id) bad('Esta caixa segue a fatura do cartão vinculado; lance as compras no cartão.');
    addBoxToMonth(b, ym); const bm = bmOf(b.id, ym); bm.items = bm.items || [];
    if (bm.paid) bad('Esta conta já foi paga. Desfaça o pagamento para alterar os itens.');
    return { b, bm, sync: () => { if (bm.items.length) bm.planned = sum(bm.items, (i) => i.amount); } };
  }
  const itemBody = (it) => ({ description: vStr(it.description, 120, true, 'Descrição do item'), amount: vMoney(it.amount, { allowZero: false }) });
  route('POST', '/api/boxes/:id/items', ({ params, body }) => {
    const { bm, sync } = itemsCtx(params, body);
    const list = Array.isArray(body.items) ? body.items : [body]; if (!list.length) bad('Nenhum item para adicionar.');
    const parsed = list.map(itemBody);
    for (const it of parsed) bm.items.push({ id: (DB.seq.items = (DB.seq.items || 0) + 1), ...it });
    sync(); return { ok: true, added: parsed.length };
  });
  route('PUT', '/api/boxes/:id/items/:item', ({ params, body }) => {
    const { bm, sync } = itemsCtx(params, body);
    const it = bm.items.find((i) => i.id === Number(params.item)); if (!it) throw new HttpError(404, 'Item não encontrado.');
    Object.assign(it, itemBody(body)); sync(); return { ok: true };
  });
  route('DELETE', '/api/boxes/:id/items/:item', ({ params, body }) => {
    const { bm, sync } = itemsCtx(params, body);
    const before = bm.items.length; bm.items = bm.items.filter((i) => i.id !== Number(params.item));
    if (bm.items.length === before) throw new HttpError(404, 'Item não encontrado.');
    if (bm.items.length) sync(); else bm.planned = 0; return { ok: true };
  });

  route('GET', '/api/boxes/:id/history', ({ params }) => {
    const id = boxOwned(params.id).id;
    const transactions = DB.transactions.filter((t) => t.box_id === id || t.to_box_id === id).map(txView).sort(txSort).slice(0, 500);
    const close_moves = DB.close_moves.filter((m) => m.box_id === id || m.dest_box_id === id).map((m) => ({ ...m, box_name: (byId('boxes', m.box_id) || {}).name, dest_name: (byId('boxes', m.dest_box_id) || {}).name }));
    return { transactions, close_moves };
  });

  route('POST', '/api/distribute', ({ body }) => {
    const ym = vYm(body.ym); assertOpen(ym); ensureMonth(ym);
    const now = Date.now(); const date = vDate(body.date, currentYm() === ym ? todayISO() : `${ym}-01`);
    for (const it of body.items || []) {
      const b = boxOwned(it.box_id); const target = vMoney(it.reserved); addBoxToMonth(b, ym);
      const mine = DB.transactions.filter((t) => t.box_id === b.id && t.ym === ym && t.kind === 'reserva');
      const delta = target - sum(mine, (t) => t.amount); if (!delta) continue;
      const recent = mine.filter((t) => t.created_at > now - 5 * 60e3).sort((a, c) => c.id - a.id)[0];
      if (recent) { const nv = recent.amount + delta; if (nv === 0) remove('transactions', (t) => t.id === recent.id); else { recent.amount = nv; recent.created_at = now; } }
      else insert('transactions', { ym, date, kind: 'reserva', box_id: b.id, to_box_id: null, card_id: null, amount: delta, description: delta > 0 ? 'Distribuição do mês' : 'Ajuste de distribuição', created_at: now });
    }
    return { ok: true };
  });

  route('POST', '/api/boxes/:id/pay', ({ params, body }) => {
    const b = boxOwned(params.id); const ym = vYm(body.ym); assertOpen(ym);
    if (b.card_id) return payInvoice(cardOwned(b.card_id), ym, b.id, body.date);
    const bm = bmOf(b.id, ym); if (!bm) bad('A caixa não faz parte deste mês.'); if (bm.paid) bad('Esta conta já está marcada como paga.');
    const amount = vMoney(body.amount ?? bm.planned, { allowZero: false }); const date = vDate(body.date, todayISO());
    const t = insert('transactions', { ym, date, kind: 'pagamento', box_id: b.id, to_box_id: null, card_id: null, amount, description: vStr(body.description, 120) || `Pagamento: ${b.name}`, created_at: Date.now() });
    Object.assign(bm, { paid: 1, paid_at: date, paid_tx: t.id });
    return { ok: true };
  });
  route('POST', '/api/boxes/:id/unpay', ({ params, body }) => {
    const b = boxOwned(params.id); const ym = vYm(body.ym); assertOpen(ym);
    if (b.card_id) return unpayInvoice(cardOwned(b.card_id), ym);
    const bm = bmOf(b.id, ym); if (bm) { if (bm.paid_tx) remove('transactions', (t) => t.id === bm.paid_tx); Object.assign(bm, { paid: 0, paid_at: null, paid_tx: null }); }
    return { ok: true };
  });

  route('GET', '/api/transactions', ({ query }) => { const ym = query.get('ym'); if (ym) vYm(ym); return { transactions: DB.transactions.filter((t) => !ym || t.ym === ym).map(txView).sort(txSort).slice(0, 2000) }; });
  route('POST', '/api/transactions', ({ body }) => {
    const ym = vYm(body.ym); assertOpen(ym); ensureMonth(ym);
    const kind = body.kind; if (!['gasto', 'transferencia'].includes(kind)) bad('Tipo de movimentação inválido.');
    const amount = vMoney(body.amount, { allowZero: false }); const date = vDate(body.date, todayISO());
    const from = boxOwned(body.box_id); if (!bmOf(from.id, ym)) bad('A caixa de origem não faz parte deste mês.');
    let to = null;
    if (kind === 'transferencia') {
      to = boxOwned(body.to_box_id); if (to.id === from.id) bad('Escolha caixas diferentes para a transferência.');
      const s = makeCtx().saldo(from.id, ym); if (amount > s) bad(`Saldo insuficiente na caixa “${from.name}”. Disponível: R$ ${brMoney(Math.max(s, 0))}.`);
      addBoxToMonth(to, ym);
    }
    const t = insert('transactions', { ym, date, kind, box_id: from.id, to_box_id: to ? to.id : null, card_id: null, amount, description: vStr(body.description, 160), created_at: Date.now() });
    return { ok: true, id: t.id };
  });
  route('PUT', '/api/transactions/:id', ({ params, body }) => {
    const t = byId('transactions', params.id); if (!t) throw new HttpError(404, 'Movimentação não encontrada.'); assertOpen(t.ym);
    if (t.kind === 'reserva') bad('Distribuições são ajustadas pela tela de distribuição.');
    if (body.amount != null) t.amount = vMoney(body.amount, { allowZero: false });
    if (body.date) t.date = vDate(body.date);
    if (body.description != null) t.description = vStr(body.description, 160);
    if (body.box_id && t.kind === 'gasto') t.box_id = boxOwned(body.box_id).id;
    return { ok: true };
  });
  route('DELETE', '/api/transactions/:id', ({ params }) => {
    const t = byId('transactions', params.id); if (!t) throw new HttpError(404, 'Movimentação não encontrada.'); assertOpen(t.ym);
    for (const bm of DB.box_months) if (bm.paid_tx === t.id) Object.assign(bm, { paid: 0, paid_at: null, paid_tx: null });
    for (const inv of DB.card_invoices) if (inv.paid_tx === t.id) Object.assign(inv, { paid: 0, paid_at: null, paid_tx: null });
    remove('transactions', (x) => x.id === t.id); return { ok: true };
  });

  function cardBody(body, ex = {}) {
    return {
      name: vStr(body.name ?? ex.name, 60, true, 'Nome do cartão'), holder: vStr(body.holder ?? ex.holder ?? '', 60), third_party: (body.third_party ?? ex.third_party) ? 1 : 0,
      closing_day: vInt(body.closing_day ?? ex.closing_day, 1, 31, 'Dia de fechamento') ?? bad('Informe o dia de fechamento.'),
      due_day: vInt(body.due_day ?? ex.due_day, 1, 31, 'Dia de vencimento') ?? bad('Informe o dia de vencimento.'),
      limit_amount: vMoney(body.limit_amount ?? ex.limit_amount ?? 0), color: vColor(body.color ?? ex.color), archived: (body.archived ?? ex.archived) ? 1 : 0,
    };
  }
  route('POST', '/api/cards', ({ body }) => {
    const c = insert('cards', { ...cardBody(body), position: DB.cards.reduce((m, x) => Math.max(m, x.position), -1) + 1 });
    if (body.create_box && body.ym && YM_RE.test(body.ym)) {
      const ym = body.ym; ensureMonth(ym);
      const b = insert('boxes', newBox({ name: `Fatura ${c.name}`.slice(0, 60), icon: c.third_party ? 'users' : 'card', color: c.color, type: 'pagamento', due_day: c.due_day, card_id: c.id, position: DB.boxes.reduce((m, x) => Math.max(m, x.position), -1) + 1, start_ym: ym }));
      if (!isClosed(ym)) addBoxToMonth(b, ym);
    }
    return { ok: true, id: c.id };
  });
  route('PUT', '/api/cards/:id', ({ params, body }) => { const ex = cardOwned(params.id); Object.assign(ex, cardBody(body, ex)); return { ok: true }; });
  route('DELETE', '/api/cards/:id', ({ params }) => {
    const ex = cardOwned(params.id);
    remove('card_purchases', (p) => p.card_id === ex.id); remove('card_invoices', (i) => i.card_id === ex.id);
    for (const t of DB.transactions) if (t.card_id === ex.id) t.card_id = null;
    for (const b of DB.boxes) if (b.card_id === ex.id) b.card_id = null;
    remove('cards', (c) => c.id === ex.id); return { ok: true };
  });
  function purchaseBody(card, body, ex = {}) {
    const date = vDate(body.date ?? ex.date);
    const installments = vInt(body.installments ?? ex.installments ?? 1, 1, 72, 'Número de parcelas') || 1;
    let first_ym = body.first_ym ?? (body.date && body.date !== ex.date ? null : ex.first_ym);
    first_ym = first_ym ? vYm(first_ym) : firstInvoiceYm(card, date);
    return { description: vStr(body.description ?? ex.description, 120, true, 'Descrição'), date, amount: vMoney(body.amount ?? ex.amount, { allowZero: false }), installments, first_ym, category: vStr(body.category ?? ex.category ?? '', 60), notes: vStr(body.notes ?? ex.notes ?? '', 500) };
  }
  route('POST', '/api/cards/:id/purchases', ({ params, body }) => {
    const card = cardOwned(params.id); const p = purchaseBody(card, body);
    if (body.current_installment && Number(body.current_installment) > 1 && !body.first_ym) { const k = vInt(body.current_installment, 1, p.installments, 'Parcela atual'); p.first_ym = ymAdd(vYm(body.ym || currentYm()), -(k - 1)); }
    const r = insert('card_purchases', { card_id: card.id, ...p }); return { ok: true, id: r.id, first_ym: p.first_ym };
  });
  route('PUT', '/api/purchases/:id', ({ params, body }) => {
    const ex = byId('card_purchases', params.id); if (!ex) throw new HttpError(404, 'Compra não encontrada.');
    const card = cardOwned(body.card_id || ex.card_id); Object.assign(ex, { card_id: card.id, ...purchaseBody(card, body, ex) }); return { ok: true };
  });
  route('DELETE', '/api/purchases/:id', ({ params }) => { const ex = byId('card_purchases', params.id); if (!ex) throw new HttpError(404, 'Compra não encontrada.'); remove('card_purchases', (p) => p.id === ex.id); return { ok: true }; });
  function payInvoice(card, ym, boxId, date) {
    assertOpen(ym); ensureMonth(ym);
    const inv = cardInvoice(card, ym, purchasesMap()); if (inv.paid) bad('Esta fatura já está paga.'); if (inv.total <= 0) bad('A fatura deste mês não possui valor.');
    const box = boxOwned(boxId); const d = vDate(date, todayISO()); addBoxToMonth(box, ym);
    const t = insert('transactions', { ym, date: d, kind: 'pagamento', box_id: box.id, to_box_id: null, card_id: card.id, amount: inv.total, description: `Fatura ${card.name}`, created_at: Date.now() });
    const row = invRow(card.id, ym); if (row) Object.assign(row, { paid: 1, paid_at: d, paid_tx: t.id }); else insert('card_invoices', { card_id: card.id, ym, paid: 1, paid_at: d, paid_tx: t.id, adjustment: 0 });
    return { ok: true };
  }
  function unpayInvoice(card, ym) {
    assertOpen(ym); const inv = invRow(card.id, ym);
    if (inv) { if (inv.paid_tx) remove('transactions', (t) => t.id === inv.paid_tx); Object.assign(inv, { paid: 0, paid_at: null, paid_tx: null }); }
    return { ok: true };
  }
  route('POST', '/api/cards/:id/invoices/:ym/pay', ({ params, body }) => {
    const card = cardOwned(params.id); const ym = vYm(params.ym); let boxId = body.box_id;
    if (!boxId) { const lb = DB.boxes.find((b) => b.card_id === card.id && !b.archived); if (!lb) bad('Escolha a caixa de onde sairá o pagamento.'); boxId = lb.id; }
    return payInvoice(card, ym, boxId, body.date);
  });
  route('POST', '/api/cards/:id/invoices/:ym/unpay', ({ params }) => unpayInvoice(cardOwned(params.id), vYm(params.ym)));
  route('PUT', '/api/cards/:id/invoices/:ym', ({ params, body }) => {
    const card = cardOwned(params.id); const ym = vYm(params.ym); assertOpen(ym); const adj = vMoney(body.adjustment ?? 0, { allowNeg: true });
    const row = invRow(card.id, ym); if (row) row.adjustment = adj; else insert('card_invoices', { card_id: card.id, ym, paid: 0, paid_at: null, paid_tx: null, adjustment: adj });
    return { ok: true };
  });
  route('GET', '/api/projection', ({ query }) => ({ months: projection(vYm(query.get('ym')), Number(query.get('n')) || 6) }));
  route('GET', '/api/reports', ({ query }) => reports(vYm(query.get('ym'))));
  route('GET', '/api/calendar', ({ query }) => calendar(vYm(query.get('ym'))));

  // ───────────── despacho ─────────────
  function call(method, url, body) {
    const u = new URL(url, 'http://local');
    const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
    if (!r) throw new HttpError(404, 'Operação não encontrada.');
    const before = JSON.stringify(DB);
    try {
      const out = r.handler({ body: body || {}, params: u.pathname.match(r.re).groups || {}, query: u.searchParams });
      save();
      return JSON.parse(JSON.stringify(out));
    } catch (e) { DB = JSON.parse(before); throw e; } // desfaz alterações parciais em caso de erro
  }

  // ───────────── backup ─────────────
  function exportBackup() { return JSON.stringify({ app: 'caixas', exported_at: new Date().toISOString(), db: DB }, null, 1); }
  function importBackup(text) {
    let data; try { data = JSON.parse(text); } catch (e) { bad('Arquivo de backup inválido.'); }
    const db = data && data.app === 'caixas' ? data.db : null;
    if (!db || !Array.isArray(db.boxes) || !db.profile) bad('Este arquivo não é um backup do Caixas.');
    DB = db; for (const t of TABLES) DB[t] = DB[t] || []; DB.seq = DB.seq || {}; save();
  }
  function resetAll() { DB = emptyDb(); save(); }
  const lastChange = () => DB.transactions.reduce((m, t) => Math.max(m, t.created_at || 0), 0);

  window.LocalAPI = { call, exportCsv: (kind, ym) => exportCsv(kind, ym), exportBackup, importBackup, resetAll, lastChange, HttpError };
})();
