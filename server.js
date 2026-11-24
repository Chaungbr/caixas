'use strict';
/*
 * Caixas — servidor HTTP + API + banco SQLite (sem dependências externas).
 * Requer Node.js >= 22.5 (módulo nativo node:sqlite).
 * Todos os valores monetários são armazenados em centavos (inteiros).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.CAIXAS_DATA || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ───────────────────────────── Banco de dados ─────────────────────────────
const db = new DatabaseSync(path.join(DATA_DIR, 'caixas.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS months(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ym TEXT NOT NULL,
  initialized INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, closed_at TEXT,
  notes TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, ym));
CREATE TABLE IF NOT EXISTS incomes(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ym TEXT NOT NULL, kind TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL,
  date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cards(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, holder TEXT NOT NULL DEFAULT '', third_party INTEGER NOT NULL DEFAULT 0,
  closing_day INTEGER NOT NULL DEFAULT 1, due_day INTEGER NOT NULL DEFAULT 10, limit_amount INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#52514e', position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS boxes(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'box', color TEXT NOT NULL DEFAULT '#2a78d6',
  type TEXT NOT NULL, target INTEGER NOT NULL DEFAULT 0, target_date TEXT, due_day INTEGER,
  notes TEXT NOT NULL DEFAULT '', recurring INTEGER NOT NULL DEFAULT 1, default_planned INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0, card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0, start_ym TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS box_months(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  box_id INTEGER NOT NULL REFERENCES boxes(id) ON DELETE CASCADE, ym TEXT NOT NULL,
  planned INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, paid_at TEXT, paid_tx INTEGER,
  due_date TEXT, PRIMARY KEY(box_id, ym));
CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ym TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL,
  box_id INTEGER REFERENCES boxes(id) ON DELETE CASCADE, to_box_id INTEGER REFERENCES boxes(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tx_user_ym ON transactions(user_id, ym);
CREATE TABLE IF NOT EXISTS card_purchases(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, description TEXT NOT NULL,
  date TEXT NOT NULL, amount INTEGER NOT NULL, installments INTEGER NOT NULL DEFAULT 1,
  first_ym TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS card_invoices(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, ym TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0, paid_at TEXT, paid_tx INTEGER, adjustment INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(card_id, ym));
CREATE TABLE IF NOT EXISTS close_moves(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ym TEXT NOT NULL, box_id INTEGER, dest TEXT NOT NULL, dest_box_id INTEGER, amount INTEGER NOT NULL);
`);

const stmts = new Map();
const q = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
const all = (sql, ...p) => q(sql).all(...p);
const get = (sql, ...p) => q(sql).get(...p);
const run = (sql, ...p) => q(sql).run(...p);
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) { txDepth++; try { return fn(); } finally { txDepth--; } }
  db.exec('BEGIN'); txDepth = 1;
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth = 0; }
}

// ───────────────────────────── Utilidades ─────────────────────────────
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

// ───────────────────────────── Autenticação ─────────────────────────────
const SESSION_DAYS = 30;
function hashPassword(pw) { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 64); return `${salt.toString('hex')}:${h.toString('hex')}`; }
function checkPassword(pw, stored) {
  const [s, h] = stored.split(':'); const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
// Atrás de um proxy HTTPS (Railway, Render…) o cookie é marcado como Secure.
const isHttps = (req) => req && (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const cookieFlags = (req) => `HttpOnly; SameSite=Lax; Path=/${isHttps(req) ? '; Secure' : ''}`;
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', tokenHash(token), userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', `caixas_sid=${token}; ${cookieFlags(res.req)}; Max-Age=${SESSION_DAYS * 86400}`);
}
function parseCookies(h) { const o = {}; (h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function sessionUser(req) {
  const t = parseCookies(req.headers.cookie).caixas_sid; if (!t) return null;
  const s = get('SELECT s.user_id, s.expires, u.id, u.email, u.name, u.settings, u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', tokenHash(t));
  if (!s || s.expires < Date.now()) return null;
  return { id: s.id, email: s.email, name: s.name, settings: JSON.parse(s.settings || '{}'), created_at: s.created_at, token: tokenHash(t) };
}
const clientIp = (req) => (isHttps(req) && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const attempts = new Map();
function rateLimit(key) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  if (a.length >= 10) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  a.push(now); attempts.set(key, a);
}

// ───────────────────────────── Domínio ─────────────────────────────
function monthRow(uid, ym) { return get('SELECT * FROM months WHERE user_id=? AND ym=?', uid, ym); }
function isClosed(uid, ym) { const m = monthRow(uid, ym); return !!(m && m.closed); }
function assertOpen(uid, ym) { if (isClosed(uid, ym)) bad('Este mês está fechado. Reabra o mês para fazer alterações.'); }
function boxOwned(uid, id) { const b = get('SELECT * FROM boxes WHERE id=? AND user_id=?', Number(id), uid); if (!b) throw new HttpError(404, 'Caixa não encontrada.'); return b; }
function cardOwned(uid, id) { const c = get('SELECT * FROM cards WHERE id=? AND user_id=?', Number(id), uid); if (!c) throw new HttpError(404, 'Cartão não encontrado.'); return c; }

function addBoxToMonth(uid, box, ym, planned) {
  run('INSERT OR IGNORE INTO box_months(user_id,box_id,ym,planned,due_date) VALUES(?,?,?,?,?)',
    uid, box.id, ym, planned ?? box.default_planned, box.due_day ? dayDate(ym, box.due_day) : null);
}
function ensureMonth(uid, ym) {
  const m = monthRow(uid, ym);
  if (m && m.initialized) return;
  tx(() => {
    run('INSERT OR IGNORE INTO months(user_id,ym) VALUES(?,?)', uid, ym);
    const boxes = all("SELECT * FROM boxes WHERE user_id=? AND archived=0 AND start_ym<=? AND (recurring=1 OR type IN ('acumulacao','meta'))", uid, ym);
    for (const b of boxes) addBoxToMonth(uid, b, ym);
    run('UPDATE months SET initialized=1 WHERE user_id=? AND ym=?', uid, ym);
  });
}

// Fatura: competência (mês de vencimento) da primeira parcela de uma compra.
function firstInvoiceYm(card, date) {
  const ym = date.slice(0, 7); const day = Number(date.slice(8, 10));
  let base = card.due_day > card.closing_day ? ym : ymAdd(ym, 1);
  if (day >= card.closing_day) base = ymAdd(base, 1);
  return base;
}
function installmentValue(p, k) { const base = Math.floor(p.amount / p.installments); return k === 1 ? p.amount - base * (p.installments - 1) : base; }
function purchasesInInvoice(purchases, ym) {
  const out = [];
  for (const p of purchases) {
    const k = ymDiff(p.first_ym, ym) + 1;
    if (k >= 1 && k <= p.installments) out.push({ ...p, k, value: installmentValue(p, k), remaining: p.installments - k });
  }
  return out;
}

/** Contexto de cálculo por requisição (carrega tudo do usuário uma vez). */
function makeCtx(uid) {
  const boxes = new Map(all('SELECT * FROM boxes WHERE user_id=?', uid).map((b) => [b.id, b]));
  const agg = new Map();
  const A = (box, ym) => { const k = `${box}|${ym}`; let a = agg.get(k); if (!a) { a = { reserved: 0, used: 0, tin: 0, tout: 0 }; agg.set(k, a); } return a; };
  for (const r of all('SELECT box_id,to_box_id,ym,kind,SUM(amount) s FROM transactions WHERE user_id=? GROUP BY box_id,to_box_id,ym,kind', uid)) {
    if (r.kind === 'reserva') A(r.box_id, r.ym).reserved += r.s;
    else if (r.kind === 'gasto' || r.kind === 'pagamento') A(r.box_id, r.ym).used += r.s;
    else if (r.kind === 'transferencia') { A(r.box_id, r.ym).tout += r.s; A(r.to_box_id, r.ym).tin += r.s; }
  }
  const closed = new Set(all('SELECT ym FROM months WHERE user_id=? AND closed=1', uid).map((r) => r.ym));
  const moves = new Map();
  for (const m of all('SELECT * FROM close_moves WHERE user_id=?', uid)) { if (!moves.has(m.ym)) moves.set(m.ym, []); moves.get(m.ym).push(m); }
  const memo = new Map();
  const empty = { reserved: 0, used: 0, tin: 0, tout: 0 };
  function opening(boxId, ym) {
    const prev = ymAdd(ym, -1);
    if (closed.has(prev)) {
      return (moves.get(prev) || []).reduce((s, m) => s + (((m.dest === 'manter' && m.box_id === boxId) || (m.dest === 'caixa' && m.dest_box_id === boxId)) ? m.amount : 0), 0);
    }
    const b = boxes.get(boxId);
    if (b && isPersistent(b.type) && b.start_ym <= prev) return saldo(boxId, prev);
    return 0;
  }
  function saldo(boxId, ym) {
    const k = `${boxId}|${ym}`; if (memo.has(k)) return memo.get(k);
    const a = agg.get(k) || empty; const v = opening(boxId, ym) + a.reserved + a.tin - a.tout - a.used;
    memo.set(k, v); return v;
  }
  function carryIn(ym) { const prev = ymAdd(ym, -1); return closed.has(prev) ? (moves.get(prev) || []).filter((m) => m.dest === 'livre').reduce((s, m) => s + m.amount, 0) : 0; }
  return { boxes, agg: (b, ym) => agg.get(`${b}|${ym}`) || empty, opening, saldo, carryIn, closed };
}

function cardInvoice(uid, card, ym, purchasesByCard) {
  const list = purchasesInInvoice(purchasesByCard.get(card.id) || [], ym);
  const inv = get('SELECT * FROM card_invoices WHERE card_id=? AND ym=?', card.id, ym) || { paid: 0, adjustment: 0 };
  const total = list.reduce((s, p) => s + p.value, 0) + (inv.adjustment || 0);
  const due_date = dayDate(ym, card.due_day);
  const closing_date = dayDate(card.due_day > card.closing_day ? ym : ymAdd(ym, -1), card.closing_day);
  const status = inv.paid ? 'pago' : (total > 0 && due_date < todayISO() ? 'vencido' : 'pendente');
  return { ym, total, adjustment: inv.adjustment || 0, paid: !!inv.paid, paid_at: inv.paid_at || null, paid_tx: inv.paid_tx || null, due_date, closing_date, status, purchases: list.sort((a, b) => a.date.localeCompare(b.date)) };
}
function purchasesMap(uid) {
  const m = new Map();
  for (const p of all('SELECT * FROM card_purchases WHERE user_id=?', uid)) { if (!m.has(p.card_id)) m.set(p.card_id, []); m.get(p.card_id).push(p); }
  return m;
}

function monthView(uid, ym) {
  ensureMonth(uid, ym);
  const ctx = makeCtx(uid);
  const m = monthRow(uid, ym);
  const prev = monthRow(uid, ymAdd(ym, -1));
  const today = todayISO();
  const pm = purchasesMap(uid);
  const cards = all('SELECT * FROM cards WHERE user_id=? ORDER BY archived, position, id', uid).map((c) => ({
    ...c, invoice: cardInvoice(uid, c, ym, pm),
    next: Array.from({ length: 6 }, (_, i) => { const y = ymAdd(ym, i + 1); return { ym: y, total: purchasesInInvoice(pm.get(c.id) || [], y).reduce((s, p) => s + p.value, 0) }; }),
  }));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const rows = all('SELECT bm.*, b.* , bm.box_id AS id FROM box_months bm JOIN boxes b ON b.id=bm.box_id WHERE bm.user_id=? AND bm.ym=? ORDER BY b.position, b.id', uid, ym);
  const boxes = rows.map((r) => {
    const a = ctx.agg(r.id, ym); const opening = ctx.opening(r.id, ym);
    const card = r.card_id ? cardById.get(r.card_id) : null;
    const planned = card ? card.invoice.total : r.planned;
    const paid = card ? card.invoice.paid : !!r.paid;
    const due_date = card ? card.invoice.due_date : r.due_date;
    let status = null;
    if (r.type === 'pagamento') status = paid ? 'pago' : (due_date && due_date < today ? 'vencido' : 'pendente');
    return {
      id: r.id, name: r.name, icon: r.icon, color: r.color, type: r.type, target: r.target, target_date: r.target_date,
      due_day: r.due_day, notes: r.notes, recurring: r.recurring, default_planned: r.default_planned, position: r.position,
      card_id: r.card_id, card_name: card ? card.name : null, archived: r.archived, start_ym: r.start_ym,
      planned, planned_manual: r.planned, opening, reserved: a.reserved, used: a.used, tin: a.tin, tout: a.tout,
      saldo: opening + a.reserved + a.tin - a.tout - a.used, paid, paid_at: card ? card.invoice.paid_at : r.paid_at, due_date, status,
    };
  });
  const inMonth = new Set(boxes.map((b) => b.id));
  const other_boxes = [...ctx.boxes.values()].filter((b) => !inMonth.has(b.id) && !b.archived).map((b) => ({ id: b.id, name: b.name, icon: b.icon, color: b.color, type: b.type }));
  const incomes = all('SELECT * FROM incomes WHERE user_id=? AND ym=? ORDER BY date, id', uid, ym);
  const salary = incomes.filter((i) => i.kind === 'salario').reduce((s, i) => s + i.amount, 0);
  const extras = incomes.filter((i) => i.kind !== 'salario').reduce((s, i) => s + i.amount, 0);
  const carry_in = ctx.carryIn(ym);
  const total_income = salary + extras + carry_in;
  const distributed = boxes.reduce((s, b) => s + b.reserved, 0);
  const opening_total = boxes.reduce((s, b) => s + b.opening, 0);
  const used_total = boxes.reduce((s, b) => s + b.used, 0);
  const payBoxes = boxes.filter((b) => b.type === 'pagamento');
  const paid_total = payBoxes.reduce((s, b) => s + b.used, 0);
  const pending_total = payBoxes.filter((b) => !b.paid).reduce((s, b) => s + Math.max(b.planned - b.used, 0), 0);
  const boxes_balance = boxes.reduce((s, b) => s + b.saldo, 0);
  const undistributed = total_income - distributed;
  const planned_total = boxes.reduce((s, b) => s + (b.planned || 0), 0);
  const summary = {
    salary, extras, carry_in, total_income, distributed, undistributed, opening_total, used_total, paid_total, pending_total,
    boxes_balance, balance: undistributed + boxes_balance, planned_total,
    available: boxes.reduce((s, b) => s + Math.max(b.saldo, 0), 0),
    organization: total_income > 0 ? Math.min(distributed / total_income, 9.99) : 0,
    overdue_count: payBoxes.filter((b) => b.status === 'vencido').length,
  };
  const alerts = [];
  if (undistributed < 0) alerts.push({ level: 'critical', text: 'A distribuição ultrapassa os recursos disponíveis.',amount: -undistributed, code: 'over' });
  for (const b of boxes) if (b.saldo < 0) alerts.push({ level: 'warning', code: 'neg', box_id: b.id, text: `A caixa “${b.name}” está com saldo negativo.`, amount: b.saldo });
  if (summary.overdue_count) alerts.push({ level: 'critical', code: 'overdue', text: `${summary.overdue_count} conta(s) vencida(s) sem pagamento.` });
  return {
    ym, today, month: { closed: !!m.closed, closed_at: m.closed_at, notes: m.notes, prev_exists: !!prev, prev_closed: !!(prev && prev.closed) },
    incomes, boxes, other_boxes, cards, summary, alerts,
  };
}

function boxHistory(uid, boxId) {
  const rows = all(`SELECT t.*, b1.name AS box_name, b2.name AS to_box_name, c.name AS card_name FROM transactions t
    LEFT JOIN boxes b1 ON b1.id=t.box_id LEFT JOIN boxes b2 ON b2.id=t.to_box_id LEFT JOIN cards c ON c.id=t.card_id
    WHERE t.user_id=? AND (t.box_id=? OR t.to_box_id=?) ORDER BY t.date DESC, t.id DESC LIMIT 500`, uid, boxId, boxId);
  const moves = all(`SELECT cm.*, b.name AS box_name, d.name AS dest_name FROM close_moves cm LEFT JOIN boxes b ON b.id=cm.box_id
    LEFT JOIN boxes d ON d.id=cm.dest_box_id WHERE cm.user_id=? AND (cm.box_id=? OR cm.dest_box_id=?)`, uid, boxId, boxId);
  return { transactions: rows, close_moves: moves };
}

// ───────────────────────────── Relatórios ─────────────────────────────
function reports(uid, ym) {
  const months = Array.from({ length: 6 }, (_, i) => ymAdd(ym, i - 5));
  const ctx = makeCtx(uid);
  const persistent = [...ctx.boxes.values()].filter((b) => isPersistent(b.type));
  const series = months.map((m) => {
    const inc = get("SELECT COALESCE(SUM(CASE WHEN kind='salario' THEN amount END),0) sal, COALESCE(SUM(CASE WHEN kind<>'salario' THEN amount END),0) ext FROM incomes WHERE user_id=? AND ym=?", uid, m);
    const t = get("SELECT COALESCE(SUM(CASE WHEN kind='reserva' THEN amount END),0) dist, COALESCE(SUM(CASE WHEN kind IN ('gasto','pagamento') THEN amount END),0) used FROM transactions WHERE user_id=? AND ym=?", uid, m);
    const planned = get('SELECT COALESCE(SUM(planned),0) p FROM box_months WHERE user_id=? AND ym=?', uid, m).p;
    const reserves = persistent.filter((b) => b.start_ym <= m).map((b) => ({ id: b.id, name: b.name, color: b.color, saldo: ctx.saldo(b.id, m) }));
    return { ym: m, salary: inc.sal, extras: inc.ext, income: inc.sal + inc.ext, distributed: t.dist, used: t.used, planned, reserves, reserves_total: reserves.reduce((s, r) => s + r.saldo, 0) };
  });
  const view = monthView(uid, ym);
  const distribution = view.boxes.filter((b) => b.reserved > 0).map((b) => ({ id: b.id, name: b.name, color: b.color, value: b.reserved }));
  // Gastos por categoria — compras no cartão entram pela parcela da fatura; o pagamento da fatura não é contado (evita duplicidade).
  const cat = new Map();
  const addCat = (key, name, color, v) => { const c = cat.get(key) || { name, color, value: 0 }; c.value += v; cat.set(key, c); };
  for (const r of all("SELECT t.box_id, b.name, b.color, SUM(t.amount) s FROM transactions t JOIN boxes b ON b.id=t.box_id WHERE t.user_id=? AND t.ym=? AND t.kind IN ('gasto','pagamento') AND t.card_id IS NULL GROUP BY t.box_id", uid, ym))
    addCat(`b${r.box_id}`, r.name, r.color, r.s);
  const boxByName = new Map([...ctx.boxes.values()].map((b) => [b.name.toLowerCase(), b]));
  for (const c of view.cards) for (const p of c.invoice.purchases) {
    const name = p.category || `Cartão · ${c.name}`; const b = boxByName.get(name.toLowerCase());
    addCat(b ? `b${b.id}` : `c:${name}`, b ? b.name : name, b ? b.color : c.color, p.value);
  }
  const categories = [...cat.values()].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  const plan_vs_real = view.boxes.map((b) => ({ id: b.id, name: b.name, color: b.color, type: b.type, planned: b.planned, executed: isPersistent(b.type) ? b.reserved + b.tin - b.tout : b.used }));
  return { months: series, distribution, categories, plan_vs_real, commitment: projection(uid, ym, 6), summary: view.summary };
}

function projection(uid, ym, n) {
  const user = get('SELECT settings FROM users WHERE id=?', uid); const st = JSON.parse(user.settings || '{}');
  const pm = purchasesMap(uid);
  const cards = all('SELECT * FROM cards WHERE user_id=? AND archived=0', uid);
  const recurring = all("SELECT * FROM boxes WHERE user_id=? AND archived=0 AND recurring=1 AND type='pagamento' AND card_id IS NULL", uid);
  const lastSalary = get("SELECT COALESCE(SUM(amount),0) s FROM incomes WHERE user_id=? AND kind='salario' AND ym=(SELECT MAX(ym) FROM incomes WHERE user_id=? AND kind='salario' AND ym<=?)", uid, uid, ym).s;
  const expected = Number(st.salary) || lastSalary || 0;
  return Array.from({ length: n }, (_, i) => {
    const m = ymAdd(ym, i + 1);
    const cardsTotal = cards.map((c) => ({ id: c.id, name: c.name, color: c.color, total: purchasesInInvoice(pm.get(c.id) || [], m).reduce((s, p) => s + p.value, 0) }));
    const bills = recurring.map((b) => {
      const row = get('SELECT planned FROM box_months WHERE box_id=? AND ym=?', b.id, m);
      return { id: b.id, name: b.name, color: b.color, total: row ? row.planned : b.default_planned };
    });
    const income = get('SELECT COALESCE(SUM(amount),0) s FROM incomes WHERE user_id=? AND ym=?', uid, m).s || expected;
    const committed = cardsTotal.reduce((s, c) => s + c.total, 0) + bills.reduce((s, b) => s + b.total, 0);
    return { ym: m, income, committed, cards: cardsTotal, bills, ratio: income > 0 ? committed / income : null };
  });
}

function calendar(uid, ym) {
  const v = monthView(uid, ym); const ev = []; const today = todayISO();
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
    // Vencimentos de faturas cujo dia cai neste mês mas pertencem ao mês (já cobertos acima)
  }
  for (const t of all("SELECT t.*, b.name bname FROM transactions t LEFT JOIN boxes b ON b.id=t.box_id WHERE t.user_id=? AND t.ym=? AND t.kind='pagamento'", uid, ym))
    ev.push({ date: t.date, type: 'pagamento', title: `Pago: ${(t.card_id ? t.description : t.bname) || t.description || ''}`, amount: t.amount, status: 'pago' });
  ev.sort((a, b) => a.date.localeCompare(b.date));
  return { ym, events: ev };
}

// ───────────────────────────── CSV ─────────────────────────────
const brMoney = (c) => (c / 100).toFixed(2).replace('.', ',');
const brDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const brYm = (ym) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const KIND_LABEL = { reserva: 'Distribuição', gasto: 'Gasto', pagamento: 'Pagamento', transferencia: 'Transferência' };
const TYPE_LABEL = { pagamento: 'Pagamento', consumo: 'Consumo', acumulacao: 'Acumulação', meta: 'Meta' };
function csv(rows) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
function exportCsv(uid, kind, ym) {
  if (kind === 'movimentacoes') {
    const rows = all(`SELECT t.*, b1.name b1, b2.name b2, c.name cn FROM transactions t LEFT JOIN boxes b1 ON b1.id=t.box_id
      LEFT JOIN boxes b2 ON b2.id=t.to_box_id LEFT JOIN cards c ON c.id=t.card_id WHERE t.user_id=? ${ym ? 'AND t.ym=?' : ''} ORDER BY t.date, t.id`, ...(ym ? [uid, ym] : [uid]));
    return csv([['Data', 'Competência', 'Tipo', 'Caixa', 'Caixa destino', 'Cartão', 'Descrição', 'Valor (R$)'],
      ...rows.map((t) => [brDate(t.date), brYm(t.ym), KIND_LABEL[t.kind] || t.kind, t.b1, t.b2, t.cn, t.description, brMoney(t.amount)])]);
  }
  if (kind === 'receitas') {
    const rows = all(`SELECT * FROM incomes WHERE user_id=? ${ym ? 'AND ym=?' : ''} ORDER BY date`, ...(ym ? [uid, ym] : [uid]));
    return csv([['Competência', 'Tipo', 'Descrição', 'Data', 'Valor (R$)'], ...rows.map((i) => [brYm(i.ym), i.kind === 'salario' ? 'Salário' : 'Extra', i.description, brDate(i.date), brMoney(i.amount)])]);
  }
  if (kind === 'caixas') {
    const m = ym || currentYm(); const v = monthView(uid, m);
    return csv([['Competência', 'Caixa', 'Modalidade', 'Planejado', 'Saldo inicial', 'Reservado', 'Transf. recebidas', 'Transf. enviadas', 'Utilizado', 'Saldo', 'Meta', 'Vencimento', 'Status', 'Observações'],
      ...v.boxes.map((b) => [brYm(m), b.name, TYPE_LABEL[b.type], brMoney(b.planned), brMoney(b.opening), brMoney(b.reserved), brMoney(b.tin), brMoney(b.tout), brMoney(b.used), brMoney(b.saldo), b.type === 'meta' ? brMoney(b.target) : '', brDate(b.due_date), b.status || '', b.notes])]);
  }
  if (kind === 'cartoes') {
    const rows = all('SELECT p.*, c.name cn, c.holder FROM card_purchases p JOIN cards c ON c.id=p.card_id WHERE p.user_id=? ORDER BY c.name, p.date', uid);
    return csv([['Cartão', 'Titular', 'Descrição', 'Data da compra', 'Valor total (R$)', 'Parcelas', 'Valor da parcela (R$)', 'Primeira fatura', 'Última fatura', 'Categoria'],
      ...rows.map((p) => [p.cn, p.holder, p.description, brDate(p.date), brMoney(p.amount), p.installments, brMoney(installmentValue(p, 2 <= p.installments ? 2 : 1)), brYm(p.first_ym), brYm(ymAdd(p.first_ym, p.installments - 1)), p.category])]);
  }
  bad('Tipo de exportação inválido.');
}

// ───────────────────────────── Rotas ─────────────────────────────
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, ...opts });

route('POST', '/api/auth/register', ({ body, res, req }) => {
  rateLimit(`reg:${clientIp(req)}`);
  const name = vStr(body.name, 80, true, 'Nome'); const email = vStr(body.email, 160, true, 'E-mail').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('E-mail inválido.');
  const pw = String(body.password || ''); if (pw.length < 8) bad('A senha precisa ter pelo menos 8 caracteres.');
  if (get('SELECT id FROM users WHERE email=?', email)) bad('Já existe uma conta com este e-mail.');
  const r = run('INSERT INTO users(email,name,pass,settings) VALUES(?,?,?,?)', email, name, hashPassword(pw), JSON.stringify({ theme: 'system', salary: 0, salary_day: 5 }));
  createSession(res, Number(r.lastInsertRowid));
  return { ok: true };
}, { public: true });
route('POST', '/api/auth/login', ({ body, res, req }) => {
  const email = vStr(body.email, 160, true, 'E-mail').toLowerCase();
  rateLimit(`login:${email}:${clientIp(req)}`);
  const u = get('SELECT * FROM users WHERE email=?', email);
  if (!u || !checkPassword(String(body.password || ''), u.pass)) throw new HttpError(401, 'E-mail ou senha incorretos.');
  attempts.delete(`login:${email}:${clientIp(req)}`);
  createSession(res, u.id); return { ok: true };
}, { public: true });
route('POST', '/api/auth/logout', ({ user, res, req }) => {
  run('DELETE FROM sessions WHERE token=?', user.token);
  res.setHeader('Set-Cookie', `caixas_sid=; ${cookieFlags(req)}; Max-Age=0`); return { ok: true };
});
route('GET', '/api/health', () => ({ ok: true }), { public: true });
route('GET', '/api/me', ({ user }) => ({ id: user.id, email: user.email, name: user.name, settings: user.settings, created_at: user.created_at,
  has_data: !!get('SELECT 1 FROM boxes WHERE user_id=? LIMIT 1', user.id) }));
route('PUT', '/api/me', ({ user, body }) => {
  const name = body.name != null ? vStr(body.name, 80, true, 'Nome') : user.name;
  const s = { ...user.settings };
  if (body.settings) {
    const b = body.settings;
    if (b.theme && ['system', 'light', 'dark'].includes(b.theme)) s.theme = b.theme;
    if (b.salary != null) s.salary = vMoney(b.salary);
    if (b.salary_day != null) s.salary_day = vInt(b.salary_day, 1, 31, 'Dia do salário');
    if (b.salary_desc != null) s.salary_desc = vStr(b.salary_desc, 80);
  }
  run('UPDATE users SET name=?, settings=? WHERE id=?', name, JSON.stringify(s), user.id); return { ok: true, settings: s, name };
});
route('PUT', '/api/me/password', ({ user, body }) => {
  const u = get('SELECT pass FROM users WHERE id=?', user.id);
  if (!checkPassword(String(body.current || ''), u.pass)) bad('Senha atual incorreta.');
  if (String(body.next || '').length < 8) bad('A nova senha precisa ter pelo menos 8 caracteres.');
  run('UPDATE users SET pass=? WHERE id=?', hashPassword(String(body.next)), user.id);
  run('DELETE FROM sessions WHERE user_id=? AND token<>?', user.id, user.token); return { ok: true };
});
route('DELETE', '/api/me', ({ user, body, res, req }) => {
  const u = get('SELECT pass FROM users WHERE id=?', user.id);
  if (!checkPassword(String(body.password || ''), u.pass)) bad('Senha incorreta.');
  run('DELETE FROM users WHERE id=?', user.id);
  res.setHeader('Set-Cookie', `caixas_sid=; ${cookieFlags(req)}; Max-Age=0`); return { ok: true };
});

route('POST', '/api/onboarding', ({ user, body }) => {
  const ym = vYm(body.ym);
  const tpl = [
    ['Fatura do meu cartão', 'card', '#2a78d6', 'pagamento'], ['Cartão do meu pai', 'users', '#6250d6', 'pagamento'],
    ['Contas fixas', 'home', '#eb6834', 'pagamento'], ['Alimentação', 'cart', '#1baf7a', 'consumo'],
    ['Transporte', 'car', '#eda100', 'consumo'], ['Lazer', 'smile', '#e87ba4', 'consumo'],
    ['Compras pessoais', 'bag', '#e34948', 'consumo'], ['Reserva financeira', 'shield', '#008300', 'acumulacao'],
    ['Metas futuras', 'target', '#6250d6', 'meta'],
  ];
  tx(() => {
    ensureMonth(user.id, ym);
    tpl.forEach(([name, icon, color, type], i) => {
      const r = run('INSERT INTO boxes(user_id,name,icon,color,type,position,start_ym,recurring) VALUES(?,?,?,?,?,?,?,1)', user.id, name, icon, color, type, i, ym);
      addBoxToMonth(user.id, { id: Number(r.lastInsertRowid), default_planned: 0, due_day: null }, ym);
    });
  });
  return { ok: true };
});

// Mês
route('GET', '/api/month/:ym', ({ user, params }) => monthView(user.id, vYm(params.ym)));
route('PUT', '/api/month/:ym/notes', ({ user, params, body }) => { const ym = vYm(params.ym); ensureMonth(user.id, ym); run('UPDATE months SET notes=? WHERE user_id=? AND ym=?', vStr(body.notes, 4000), user.id, ym); return { ok: true }; });
route('POST', '/api/month/:ym/replicate', ({ user, params }) => {
  const ym = vYm(params.ym); assertOpen(user.id, ym); ensureMonth(user.id, ym); const prev = ymAdd(ym, -1);
  const rows = all('SELECT bm.*, b.due_day, b.archived FROM box_months bm JOIN boxes b ON b.id=bm.box_id WHERE bm.user_id=? AND bm.ym=?', user.id, prev);
  if (!rows.length) bad('O mês anterior não possui caixas para replicar.');
  let added = 0, updated = 0;
  tx(() => {
    for (const r of rows) {
      if (r.archived) continue;
      const ex = get('SELECT * FROM box_months WHERE box_id=? AND ym=?', r.box_id, ym);
      if (!ex) { run('INSERT INTO box_months(user_id,box_id,ym,planned,due_date) VALUES(?,?,?,?,?)', user.id, r.box_id, ym, r.planned, r.due_day ? dayDate(ym, r.due_day) : null); added++; }
      else if (!ex.planned && r.planned) { run('UPDATE box_months SET planned=? WHERE box_id=? AND ym=?', r.planned, r.box_id, ym); updated++; }
    }
  });
  return { ok: true, added, updated };
});
route('POST', '/api/month/:ym/close', ({ user, params, body }) => {
  const ym = vYm(params.ym); assertOpen(user.id, ym);
  const v = monthView(user.id, ym); const dest = new Map((body.moves || []).map((m) => [Number(m.box_id), m]));
  tx(() => {
    for (const b of v.boxes) {
      if (b.saldo === 0) continue;
      const m = dest.get(b.id) || { dest: isPersistent(b.type) ? 'manter' : 'livre' };
      let d = ['manter', 'caixa', 'livre'].includes(m.dest) ? m.dest : 'livre'; let destBox = null;
      if (d === 'caixa') { destBox = boxOwned(user.id, m.dest_box_id).id; if (destBox === b.id) d = 'manter'; }
      run('INSERT INTO close_moves(user_id,ym,box_id,dest,dest_box_id,amount) VALUES(?,?,?,?,?,?)', user.id, ym, b.id, d, destBox, b.saldo);
      const nxt = ymAdd(ym, 1);
      const target = d === 'manter' ? b.id : d === 'caixa' ? destBox : null;
      if (target) { ensureMonth(user.id, nxt); addBoxToMonth(user.id, boxOwned(user.id, target), nxt); }
    }
    if (v.summary.undistributed !== 0) run('INSERT INTO close_moves(user_id,ym,box_id,dest,dest_box_id,amount) VALUES(?,?,NULL,?,NULL,?)', user.id, ym, 'livre', v.summary.undistributed);
    run('UPDATE months SET closed=1, closed_at=? WHERE user_id=? AND ym=?', new Date().toISOString(), user.id, ym);
  });
  return { ok: true };
});
route('POST', '/api/month/:ym/reopen', ({ user, params }) => {
  const ym = vYm(params.ym);
  if (isClosed(user.id, ymAdd(ym, 1))) bad('Reabra primeiro o mês seguinte, que também está fechado.');
  tx(() => { run('DELETE FROM close_moves WHERE user_id=? AND ym=?', user.id, ym); run('UPDATE months SET closed=0, closed_at=NULL WHERE user_id=? AND ym=?', user.id, ym); });
  return { ok: true };
});

// Receitas
function incomeBody(body) {
  const kind = body.kind === 'salario' ? 'salario' : 'extra';
  const date = vDate(body.date); return { kind, date, ym: body.ym ? vYm(body.ym) : date.slice(0, 7), description: vStr(body.description, 120), amount: vMoney(body.amount, { allowZero: false }) };
}
route('POST', '/api/incomes', ({ user, body }) => {
  const i = incomeBody(body); assertOpen(user.id, i.ym); ensureMonth(user.id, i.ym);
  const r = run('INSERT INTO incomes(user_id,ym,kind,description,amount,date) VALUES(?,?,?,?,?,?)', user.id, i.ym, i.kind, i.description, i.amount, i.date);
  return { ok: true, id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/incomes/:id', ({ user, params, body }) => {
  const ex = get('SELECT * FROM incomes WHERE id=? AND user_id=?', Number(params.id), user.id); if (!ex) throw new HttpError(404, 'Receita não encontrada.');
  const i = incomeBody({ ym: ex.ym, ...body }); assertOpen(user.id, ex.ym); assertOpen(user.id, i.ym);
  run('UPDATE incomes SET ym=?,kind=?,description=?,amount=?,date=? WHERE id=?', i.ym, i.kind, i.description, i.amount, i.date, ex.id); return { ok: true };
});
route('DELETE', '/api/incomes/:id', ({ user, params }) => {
  const ex = get('SELECT * FROM incomes WHERE id=? AND user_id=?', Number(params.id), user.id); if (!ex) throw new HttpError(404, 'Receita não encontrada.');
  assertOpen(user.id, ex.ym); run('DELETE FROM incomes WHERE id=?', ex.id); return { ok: true };
});

// Caixas
function boxBody(body, ex = {}) {
  const type = body.type ?? ex.type; if (!BOX_TYPES.includes(type)) bad('Modalidade inválida.');
  return {
    name: vStr(body.name ?? ex.name, 60, true, 'Nome'), icon: vStr(body.icon ?? ex.icon ?? 'box', 20) || 'box', color: vColor(body.color ?? ex.color), type,
    target: vMoney(body.target ?? ex.target ?? 0), target_date: (body.target_date ?? ex.target_date) ? vDate(body.target_date ?? ex.target_date) : null,
    due_day: vInt(body.due_day !== undefined ? body.due_day : ex.due_day, 1, 31, 'Dia de vencimento'),
    notes: vStr(body.notes ?? ex.notes ?? '', 2000), recurring: (body.recurring ?? ex.recurring ?? 1) ? 1 : 0,
    default_planned: vMoney(body.default_planned ?? ex.default_planned ?? 0), card_id: body.card_id !== undefined ? (body.card_id ? Number(body.card_id) : null) : (ex.card_id ?? null),
  };
}
route('POST', '/api/boxes', ({ user, body }) => {
  const ym = vYm(body.ym); const b = boxBody(body); if (b.card_id) cardOwned(user.id, b.card_id);
  assertOpen(user.id, ym); ensureMonth(user.id, ym);
  const pos = get('SELECT COALESCE(MAX(position),-1)+1 p FROM boxes WHERE user_id=?', user.id).p;
  return tx(() => {
    const r = run(`INSERT INTO boxes(user_id,name,icon,color,type,target,target_date,due_day,notes,recurring,default_planned,card_id,position,start_ym)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, user.id, b.name, b.icon, b.color, b.type, b.target, b.target_date, b.due_day, b.notes, b.recurring, b.default_planned, b.card_id, pos, ym);
    const box = { id: Number(r.lastInsertRowid), ...b };
    const planned = body.planned != null ? vMoney(body.planned) : b.default_planned;
    addBoxToMonth(user.id, box, ym, planned);
    if (b.recurring || isPersistent(b.type)) for (const m of all('SELECT ym FROM months WHERE user_id=? AND initialized=1 AND ym>? AND closed=0', user.id, ym)) addBoxToMonth(user.id, box, m.ym);
    return { ok: true, id: box.id };
  });
});
route('PUT', '/api/boxes/:id', ({ user, params, body }) => {
  const ex = boxOwned(user.id, params.id); const b = boxBody(body, ex); if (b.card_id) cardOwned(user.id, b.card_id);
  run('UPDATE boxes SET name=?,icon=?,color=?,type=?,target=?,target_date=?,due_day=?,notes=?,recurring=?,default_planned=?,card_id=? WHERE id=?',
    b.name, b.icon, b.color, b.type, b.target, b.target_date, b.due_day, b.notes, b.recurring, b.default_planned, b.card_id, ex.id);
  if (body.ym && YM_RE.test(body.ym) && !isClosed(user.id, body.ym)) {
    if (body.planned != null) run('UPDATE box_months SET planned=? WHERE box_id=? AND ym=?', vMoney(body.planned), ex.id, body.ym);
    if (body.due_day !== undefined) run('UPDATE box_months SET due_date=? WHERE box_id=? AND ym=?', b.due_day ? dayDate(body.ym, b.due_day) : null, ex.id, body.ym);
  }
  return { ok: true };
});
route('DELETE', '/api/boxes/:id', ({ user, params }) => {
  const ex = boxOwned(user.id, params.id);
  const closedUse = get('SELECT 1 FROM transactions t JOIN months m ON m.user_id=t.user_id AND m.ym=t.ym AND m.closed=1 WHERE t.box_id=? OR t.to_box_id=? LIMIT 1', ex.id, ex.id);
  if (closedUse) {
    // Preserva o histórico de meses fechados: arquiva em vez de apagar.
    tx(() => {
      run('UPDATE boxes SET archived=1 WHERE id=?', ex.id);
      run('DELETE FROM box_months WHERE box_id=? AND ym IN (SELECT ym FROM months WHERE user_id=? AND closed=0)', ex.id, user.id);
      run('DELETE FROM transactions WHERE (box_id=? OR to_box_id=?) AND ym IN (SELECT ym FROM months WHERE user_id=? AND closed=0)', ex.id, ex.id, user.id);
    });
    return { ok: true, archived: true };
  }
  tx(() => { run('UPDATE card_invoices SET paid=0, paid_tx=NULL, paid_at=NULL WHERE paid_tx IN (SELECT id FROM transactions WHERE box_id=?)', ex.id); run('DELETE FROM boxes WHERE id=?', ex.id); });
  return { ok: true };
});
route('POST', '/api/boxes/:id/duplicate', ({ user, params, body }) => {
  const ex = boxOwned(user.id, params.id); const ym = vYm(body.ym); assertOpen(user.id, ym);
  const bm = get('SELECT planned FROM box_months WHERE box_id=? AND ym=?', ex.id, ym);
  return tx(() => {
    run('UPDATE boxes SET position=position+1 WHERE user_id=? AND position>?', user.id, ex.position);
    const r = run(`INSERT INTO boxes(user_id,name,icon,color,type,target,target_date,due_day,notes,recurring,default_planned,card_id,position,start_ym)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`, user.id, `${ex.name} (cópia)`.slice(0, 60), ex.icon, ex.color, ex.type, ex.target, ex.target_date, ex.due_day, ex.notes, ex.recurring, ex.default_planned, ex.position + 1, ym);
    addBoxToMonth(user.id, { ...ex, id: Number(r.lastInsertRowid) }, ym, bm ? bm.planned : ex.default_planned);
    return { ok: true, id: Number(r.lastInsertRowid) };
  });
});
route('POST', '/api/boxes/reorder', ({ user, body }) => {
  // Reordena apenas as caixas visíveis, mantendo as demais em suas posições relativas.
  const ids = (body.ids || []).map(Number);
  const full = all('SELECT id FROM boxes WHERE user_id=? ORDER BY position, id', user.id).map((r) => r.id);
  const visible = new Set(ids.filter((id) => full.includes(id)));
  const queue = ids.filter((id) => visible.has(id));
  const order = full.map((id) => (visible.has(id) ? queue.shift() : id));
  tx(() => order.forEach((id, i) => run('UPDATE boxes SET position=? WHERE id=? AND user_id=?', i, id, user.id)));
  return { ok: true };
});
route('POST', '/api/boxes/:id/month', ({ user, params, body }) => {
  const ex = boxOwned(user.id, params.id); const ym = vYm(body.ym); assertOpen(user.id, ym); ensureMonth(user.id, ym);
  if (ex.archived) run('UPDATE boxes SET archived=0 WHERE id=?', ex.id);
  addBoxToMonth(user.id, ex, ym); return { ok: true };
});
route('DELETE', '/api/boxes/:id/month/:ym', ({ user, params }) => {
  const ex = boxOwned(user.id, params.id); const ym = vYm(params.ym); assertOpen(user.id, ym);
  if (get('SELECT 1 FROM transactions WHERE (box_id=? OR to_box_id=?) AND ym=? LIMIT 1', ex.id, ex.id, ym)) bad('A caixa possui movimentações neste mês. Remova-as antes de retirá-la do mês.');
  run('DELETE FROM box_months WHERE box_id=? AND ym=?', ex.id, ym); return { ok: true };
});
route('GET', '/api/boxes/:id/history', ({ user, params }) => boxHistory(user.id, boxOwned(user.id, params.id).id));

// Distribuição (define o valor reservado de cada caixa no mês)
route('POST', '/api/distribute', ({ user, body }) => {
  const ym = vYm(body.ym); assertOpen(user.id, ym); ensureMonth(user.id, ym);
  const now = Date.now(); const date = vDate(body.date, todayISO().slice(0, 7) === ym ? todayISO() : `${ym}-01`);
  tx(() => {
    for (const it of body.items || []) {
      const b = boxOwned(user.id, it.box_id); const target = vMoney(it.reserved);
      if (!get('SELECT 1 FROM box_months WHERE box_id=? AND ym=?', b.id, ym)) addBoxToMonth(user.id, b, ym);
      const cur = get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id=? AND box_id=? AND ym=? AND kind='reserva'", user.id, b.id, ym).s;
      const delta = target - cur; if (!delta) continue;
      const recent = get("SELECT * FROM transactions WHERE user_id=? AND box_id=? AND ym=? AND kind='reserva' AND created_at>? ORDER BY id DESC LIMIT 1", user.id, b.id, ym, now - 5 * 60e3);
      if (recent) {
        const nv = recent.amount + delta;
        if (nv === 0) run('DELETE FROM transactions WHERE id=?', recent.id); else run('UPDATE transactions SET amount=?, created_at=? WHERE id=?', nv, now, recent.id);
      } else {
        run("INSERT INTO transactions(user_id,ym,date,kind,box_id,amount,description,created_at) VALUES(?,?,?,'reserva',?,?,?,?)", user.id, ym, date, b.id, delta, delta > 0 ? 'Distribuição do mês' : 'Ajuste de distribuição', now);
      }
    }
  });
  return { ok: true };
});

// Pagamento de caixa (boletos, contas)
route('POST', '/api/boxes/:id/pay', ({ user, params, body }) => {
  const b = boxOwned(user.id, params.id); const ym = vYm(body.ym); assertOpen(user.id, ym);
  if (b.card_id) return payInvoice(user.id, cardOwned(user.id, b.card_id), ym, b.id, body.date);
  const bm = get('SELECT * FROM box_months WHERE box_id=? AND ym=?', b.id, ym); if (!bm) bad('A caixa não faz parte deste mês.');
  if (bm.paid) bad('Esta conta já está marcada como paga.');
  const amount = vMoney(body.amount ?? bm.planned, { allowZero: false }); const date = vDate(body.date, todayISO());
  tx(() => {
    const r = run("INSERT INTO transactions(user_id,ym,date,kind,box_id,amount,description,created_at) VALUES(?,?,?,'pagamento',?,?,?,?)", user.id, ym, date, b.id, amount, vStr(body.description, 120) || `Pagamento: ${b.name}`, Date.now());
    run('UPDATE box_months SET paid=1, paid_at=?, paid_tx=? WHERE box_id=? AND ym=?', date, Number(r.lastInsertRowid), b.id, ym);
  });
  return { ok: true };
});
route('POST', '/api/boxes/:id/unpay', ({ user, params, body }) => {
  const b = boxOwned(user.id, params.id); const ym = vYm(body.ym); assertOpen(user.id, ym);
  if (b.card_id) return unpayInvoice(user.id, cardOwned(user.id, b.card_id), ym);
  const bm = get('SELECT * FROM box_months WHERE box_id=? AND ym=?', b.id, ym);
  tx(() => { if (bm && bm.paid_tx) run('DELETE FROM transactions WHERE id=? AND user_id=?', bm.paid_tx, user.id); run('UPDATE box_months SET paid=0, paid_at=NULL, paid_tx=NULL WHERE box_id=? AND ym=?', b.id, ym); });
  return { ok: true };
});

// Movimentações
route('GET', '/api/transactions', ({ user, url }) => {
  const ym = url.searchParams.get('ym');
  const rows = all(`SELECT t.*, b1.name AS box_name, b1.color AS box_color, b1.icon AS box_icon, b2.name AS to_box_name, b2.color AS to_box_color, c.name AS card_name
    FROM transactions t LEFT JOIN boxes b1 ON b1.id=t.box_id LEFT JOIN boxes b2 ON b2.id=t.to_box_id LEFT JOIN cards c ON c.id=t.card_id
    WHERE t.user_id=? ${ym ? 'AND t.ym=?' : ''} ORDER BY t.date DESC, t.id DESC LIMIT 2000`, ...(ym ? [user.id, vYm(ym)] : [user.id]));
  return { transactions: rows };
});
route('POST', '/api/transactions', ({ user, body }) => {
  const ym = vYm(body.ym); assertOpen(user.id, ym); ensureMonth(user.id, ym);
  const kind = body.kind; if (!['gasto', 'transferencia'].includes(kind)) bad('Tipo de movimentação inválido.');
  const amount = vMoney(body.amount, { allowZero: false }); const date = vDate(body.date, todayISO());
  const from = boxOwned(user.id, body.box_id);
  if (!get('SELECT 1 FROM box_months WHERE box_id=? AND ym=?', from.id, ym)) bad('A caixa de origem não faz parte deste mês.');
  let to = null;
  if (kind === 'transferencia') {
    to = boxOwned(user.id, body.to_box_id); if (to.id === from.id) bad('Escolha caixas diferentes para a transferência.');
    const ctx = makeCtx(user.id); const s = ctx.saldo(from.id, ym);
    if (amount > s) bad(`Saldo insuficiente na caixa “${from.name}”. Disponível: R$ ${brMoney(Math.max(s, 0))}.`);
    addBoxToMonth(user.id, to, ym);
  }
  const r = run('INSERT INTO transactions(user_id,ym,date,kind,box_id,to_box_id,amount,description,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    user.id, ym, date, kind, from.id, to ? to.id : null, amount, vStr(body.description, 160), Date.now());
  return { ok: true, id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/transactions/:id', ({ user, params, body }) => {
  const t = get('SELECT * FROM transactions WHERE id=? AND user_id=?', Number(params.id), user.id); if (!t) throw new HttpError(404, 'Movimentação não encontrada.');
  assertOpen(user.id, t.ym);
  if (t.kind === 'reserva') bad('Distribuições são ajustadas pela tela de distribuição.');
  const amount = body.amount != null ? vMoney(body.amount, { allowZero: false }) : t.amount;
  const date = body.date ? vDate(body.date) : t.date; const description = body.description != null ? vStr(body.description, 160) : t.description;
  const box_id = body.box_id && t.kind === 'gasto' ? boxOwned(user.id, body.box_id).id : t.box_id;
  run('UPDATE transactions SET amount=?, date=?, description=?, box_id=? WHERE id=?', amount, date, description, box_id, t.id);
  return { ok: true };
});
route('DELETE', '/api/transactions/:id', ({ user, params }) => {
  const t = get('SELECT * FROM transactions WHERE id=? AND user_id=?', Number(params.id), user.id); if (!t) throw new HttpError(404, 'Movimentação não encontrada.');
  assertOpen(user.id, t.ym);
  tx(() => {
    run('UPDATE box_months SET paid=0, paid_at=NULL, paid_tx=NULL WHERE paid_tx=?', t.id);
    run('UPDATE card_invoices SET paid=0, paid_at=NULL, paid_tx=NULL WHERE paid_tx=?', t.id);
    run('DELETE FROM transactions WHERE id=?', t.id);
  });
  return { ok: true };
});

// Cartões
function cardBody(body, ex = {}) {
  return {
    name: vStr(body.name ?? ex.name, 60, true, 'Nome do cartão'), holder: vStr(body.holder ?? ex.holder ?? '', 60),
    third_party: (body.third_party ?? ex.third_party) ? 1 : 0,
    closing_day: vInt(body.closing_day ?? ex.closing_day, 1, 31, 'Dia de fechamento') ?? bad('Informe o dia de fechamento.'),
    due_day: vInt(body.due_day ?? ex.due_day, 1, 31, 'Dia de vencimento') ?? bad('Informe o dia de vencimento.'),
    limit_amount: vMoney(body.limit_amount ?? ex.limit_amount ?? 0), color: vColor(body.color ?? ex.color), archived: (body.archived ?? ex.archived) ? 1 : 0,
  };
}
route('POST', '/api/cards', ({ user, body }) => {
  const c = cardBody(body); const pos = get('SELECT COALESCE(MAX(position),-1)+1 p FROM cards WHERE user_id=?', user.id).p;
  const r = run('INSERT INTO cards(user_id,name,holder,third_party,closing_day,due_day,limit_amount,color,position) VALUES(?,?,?,?,?,?,?,?,?)',
    user.id, c.name, c.holder, c.third_party, c.closing_day, c.due_day, c.limit_amount, c.color, pos);
  const cardId = Number(r.lastInsertRowid);
  if (body.create_box && body.ym && YM_RE.test(body.ym)) {
    const ym = body.ym; ensureMonth(user.id, ym);
    const bpos = get('SELECT COALESCE(MAX(position),-1)+1 p FROM boxes WHERE user_id=?', user.id).p;
    const br = run(`INSERT INTO boxes(user_id,name,icon,color,type,due_day,recurring,card_id,position,start_ym) VALUES(?,?,?,?,'pagamento',?,1,?,?,?)`,
      user.id, `Fatura ${c.name}`.slice(0, 60), c.third_party ? 'users' : 'card', c.color, c.due_day, cardId, bpos, ym);
    if (!isClosed(user.id, ym)) addBoxToMonth(user.id, { id: Number(br.lastInsertRowid), default_planned: 0, due_day: c.due_day }, ym);
  }
  return { ok: true, id: cardId };
});
route('PUT', '/api/cards/:id', ({ user, params, body }) => {
  const ex = cardOwned(user.id, params.id); const c = cardBody(body, ex);
  run('UPDATE cards SET name=?,holder=?,third_party=?,closing_day=?,due_day=?,limit_amount=?,color=?,archived=? WHERE id=?', c.name, c.holder, c.third_party, c.closing_day, c.due_day, c.limit_amount, c.color, c.archived, ex.id);
  return { ok: true };
});
route('DELETE', '/api/cards/:id', ({ user, params }) => { const ex = cardOwned(user.id, params.id); run('DELETE FROM cards WHERE id=?', ex.id); return { ok: true }; });
function purchaseBody(user, card, body, ex = {}) {
  const date = vDate(body.date ?? ex.date);
  const installments = vInt(body.installments ?? ex.installments ?? 1, 1, 72, 'Número de parcelas') || 1;
  let first_ym = body.first_ym ?? (body.date && body.date !== ex.date ? null : ex.first_ym);
  first_ym = first_ym ? vYm(first_ym) : firstInvoiceYm(card, date);
  return { description: vStr(body.description ?? ex.description, 120, true, 'Descrição'), date, amount: vMoney(body.amount ?? ex.amount, { allowZero: false }), installments, first_ym, category: vStr(body.category ?? ex.category ?? '', 60), notes: vStr(body.notes ?? ex.notes ?? '', 500) };
}
route('POST', '/api/cards/:id/purchases', ({ user, params, body }) => {
  const card = cardOwned(user.id, params.id); const p = purchaseBody(user, card, body);
  // Compra parcelada já em andamento: "parcela atual" informada pelo usuário
  if (body.current_installment && Number(body.current_installment) > 1 && !body.first_ym) {
    const k = vInt(body.current_installment, 1, p.installments, 'Parcela atual'); p.first_ym = ymAdd(vYm(body.ym || currentYm()), -(k - 1));
  }
  const r = run('INSERT INTO card_purchases(user_id,card_id,description,date,amount,installments,first_ym,category,notes) VALUES(?,?,?,?,?,?,?,?,?)',
    user.id, card.id, p.description, p.date, p.amount, p.installments, p.first_ym, p.category, p.notes);
  return { ok: true, id: Number(r.lastInsertRowid), first_ym: p.first_ym };
});
route('PUT', '/api/purchases/:id', ({ user, params, body }) => {
  const ex = get('SELECT * FROM card_purchases WHERE id=? AND user_id=?', Number(params.id), user.id); if (!ex) throw new HttpError(404, 'Compra não encontrada.');
  const card = cardOwned(user.id, body.card_id || ex.card_id); const p = purchaseBody(user, card, body, ex);
  run('UPDATE card_purchases SET card_id=?,description=?,date=?,amount=?,installments=?,first_ym=?,category=?,notes=? WHERE id=?', card.id, p.description, p.date, p.amount, p.installments, p.first_ym, p.category, p.notes, ex.id);
  return { ok: true };
});
route('DELETE', '/api/purchases/:id', ({ user, params }) => {
  const ex = get('SELECT * FROM card_purchases WHERE id=? AND user_id=?', Number(params.id), user.id); if (!ex) throw new HttpError(404, 'Compra não encontrada.');
  run('DELETE FROM card_purchases WHERE id=?', ex.id); return { ok: true };
});
function payInvoice(uid, card, ym, boxId, date) {
  assertOpen(uid, ym); ensureMonth(uid, ym);
  const inv = cardInvoice(uid, card, ym, purchasesMap(uid)); if (inv.paid) bad('Esta fatura já está paga.');
  if (inv.total <= 0) bad('A fatura deste mês não possui valor.');
  const box = boxOwned(uid, boxId); const d = vDate(date, todayISO());
  if (!get('SELECT 1 FROM box_months WHERE box_id=? AND ym=?', box.id, ym)) addBoxToMonth(uid, box, ym);
  tx(() => {
    const r = run("INSERT INTO transactions(user_id,ym,date,kind,box_id,card_id,amount,description,created_at) VALUES(?,?,?,'pagamento',?,?,?,?,?)", uid, ym, d, box.id, card.id, inv.total, `Fatura ${card.name}`, Date.now());
    run('INSERT INTO card_invoices(user_id,card_id,ym,paid,paid_at,paid_tx) VALUES(?,?,?,1,?,?) ON CONFLICT(card_id,ym) DO UPDATE SET paid=1, paid_at=excluded.paid_at, paid_tx=excluded.paid_tx', uid, card.id, ym, d, Number(r.lastInsertRowid));
  });
  return { ok: true };
}
function unpayInvoice(uid, card, ym) {
  assertOpen(uid, ym);
  const inv = get('SELECT * FROM card_invoices WHERE card_id=? AND ym=?', card.id, ym);
  tx(() => { if (inv && inv.paid_tx) run('DELETE FROM transactions WHERE id=? AND user_id=?', inv.paid_tx, uid); run('UPDATE card_invoices SET paid=0, paid_at=NULL, paid_tx=NULL WHERE card_id=? AND ym=?', card.id, ym); });
  return { ok: true };
}
route('POST', '/api/cards/:id/invoices/:ym/pay', ({ user, params, body }) => {
  const card = cardOwned(user.id, params.id); const ym = vYm(params.ym);
  let boxId = body.box_id; if (!boxId) { const lb = get('SELECT id FROM boxes WHERE card_id=? AND user_id=? AND archived=0', card.id, user.id); if (!lb) bad('Escolha a caixa de onde sairá o pagamento.'); boxId = lb.id; }
  return payInvoice(user.id, card, ym, boxId, body.date);
});
route('POST', '/api/cards/:id/invoices/:ym/unpay', ({ user, params }) => unpayInvoice(user.id, cardOwned(user.id, params.id), vYm(params.ym)));
route('PUT', '/api/cards/:id/invoices/:ym', ({ user, params, body }) => {
  const card = cardOwned(user.id, params.id); const ym = vYm(params.ym); assertOpen(user.id, ym);
  const adj = vMoney(body.adjustment ?? 0, { allowNeg: true });
  run('INSERT INTO card_invoices(user_id,card_id,ym,adjustment) VALUES(?,?,?,?) ON CONFLICT(card_id,ym) DO UPDATE SET adjustment=excluded.adjustment', user.id, card.id, ym, adj);
  return { ok: true };
});

route('GET', '/api/projection', ({ user, url }) => ({ months: projection(user.id, vYm(url.searchParams.get('ym')), Number(url.searchParams.get('n')) || 6) }));
route('GET', '/api/reports', ({ user, url }) => reports(user.id, vYm(url.searchParams.get('ym'))));
route('GET', '/api/calendar', ({ user, url }) => calendar(user.id, vYm(url.searchParams.get('ym'))));
route('GET', '/api/export/:kind', ({ user, params, url, res }) => {
  const ymp = url.searchParams.get('ym'); const ym = ymp ? vYm(ymp) : null;
  const body = exportCsv(user.id, params.kind, ym);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="caixas-${params.kind}${ym ? '-' + ym : ''}.csv"`, 'Cache-Control': 'no-store' });
  res.end(body); return undefined;
});

// ───────────────────────────── Servidor ─────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname); if (p === '/' || !path.extname(p)) p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Requisição muito grande.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido.')); } });
    req.on('error', reject);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (!url.pathname.startsWith('/api/')) { if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); } return serveStatic(req, res, url.pathname); }
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Rota não encontrada.');
    // Proteção CSRF: toda mutação precisa do cabeçalho customizado (exige preflight em origens externas).
    if (req.method !== 'GET' && req.headers['x-caixas'] !== '1') throw new HttpError(403, 'Requisição não autorizada.');
    const user = sessionUser(req);
    if (!r.public && !user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    const body = req.method === 'GET' ? {} : await readBody(req);
    const params = url.pathname.match(r.re).groups || {};
    const out = await r.handler({ req, res, url, body, params, user });
    if (out !== undefined && !res.headersSent) send(200, out);
  } catch (e) {
    if (e instanceof HttpError) send(e.status, { error: e.message });
    else { console.error(e); send(500, { error: 'Erro interno. Tente novamente.' }); }
  }
});
setInterval(() => run('DELETE FROM sessions WHERE expires<?', Date.now()), 3600e3).unref();
server.listen(PORT, () => console.log(`Caixas rodando em http://localhost:${PORT}`));
