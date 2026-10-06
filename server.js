// =====================================================
// MDrag Orders API
// A small Express server backed by a SQLite database
// (via better-sqlite3), so orders confirmed on the
// website are saved server-side and can be viewed from
// an admin page, from any device — not just the browser
// that placed the order.
// =====================================================

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 4000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-this-to-a-long-random-secret';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());

if (ADMIN_KEY === 'change-this-to-a-long-random-secret') {
  console.warn(
    '\n⚠️  WARNING: ADMIN_KEY is still the default value.\n' +
    '   Set a real secret in your .env file before going live —\n' +
    '   anyone who knows the default key could read your orders.\n'
  );
}

// ---------------------------------------------------------
// Database setup
// ---------------------------------------------------------
// DB_PATH lets you point the database at a persistent disk's
// mount path when deployed (e.g. "/var/data/orders.db" on
// Render). Without it, the database lives next to this file,
// which is fine locally but is wiped on redeploy on most free
// hosting tiers.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'orders.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'new',
    full_name     TEXT NOT NULL,
    phone         TEXT NOT NULL,
    email         TEXT NOT NULL,
    address       TEXT NOT NULL,
    city          TEXT NOT NULL,
    postal_code   TEXT,
    notes         TEXT,
    items_json    TEXT NOT NULL,
    total         REAL NOT NULL
  )
`);

const insertOrder = db.prepare(`
  INSERT INTO orders
    (id, created_at, status, full_name, phone, email, address, city, postal_code, notes, items_json, total)
  VALUES
    (@id, @created_at, 'new', @full_name, @phone, @email, @address, @city, @postal_code, @notes, @items_json, @total)
`);

const listOrders = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`);
const getOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`);
const updateStatus = db.prepare(`UPDATE orders SET status = ? WHERE id = ?`);

db.exec(`
  CREATE TABLE IF NOT EXISTS consultations (
    id            TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'new',
    full_name     TEXT NOT NULL,
    phone         TEXT NOT NULL,
    email         TEXT NOT NULL,
    message       TEXT
  )
`);

const insertConsult = db.prepare(`
  INSERT INTO consultations
    (id, created_at, status, full_name, phone, email, message)
  VALUES
    (@id, @created_at, 'new', @full_name, @phone, @email, @message)
`);

const listConsults = db.prepare(`SELECT * FROM consultations ORDER BY created_at DESC`);
const getConsult = db.prepare(`SELECT * FROM consultations WHERE id = ?`);
const updateConsultStatus = db.prepare(`UPDATE consultations SET status = ? WHERE id = ?`);

// ---------------------------------------------------------
// App setup
// ---------------------------------------------------------
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS
  })
);

function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key');
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function rowToOrder(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    total: row.total,
    items: JSON.parse(row.items_json),
    customer: {
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      city: row.city,
      postalCode: row.postal_code,
      notes: row.notes
    }
  };
}

function rowToConsult(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    customer: {
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      message: row.message
    }
  };
}

// Health check — useful once deployed, to confirm the server is up.
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'mdrag-orders-api' });
});

// Create a new order. Called by checkout.html when the customer
// confirms their order. No auth required — this is the public
// "place order" endpoint.
app.post('/api/orders', (req, res) => {
  const { fullName, phone, email, address, city, postalCode, notes, items, total } = req.body || {};

  if (!fullName || !phone || !email || !address || !city || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Missing required order fields.' });
  }

  const id = 'MD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const createdAt = new Date().toISOString();

  insertOrder.run({
    id,
    created_at: createdAt,
    full_name: String(fullName).slice(0, 200),
    phone: String(phone).slice(0, 60),
    email: String(email).slice(0, 200),
    address: String(address).slice(0, 300),
    city: String(city).slice(0, 120),
    postal_code: postalCode ? String(postalCode).slice(0, 40) : null,
    notes: notes ? String(notes).slice(0, 1000) : null,
    items_json: JSON.stringify(items),
    total: Number(total) || 0
  });

  res.status(201).json({ id, createdAt });
});

// List all orders. Protected — only callable with the admin key,
// so this is what your admin page (orders.html) uses to display
// orders to you, and only you.
app.get('/api/orders', requireAdmin, (req, res) => {
  const rows = listOrders.all();
  res.json(rows.map(rowToOrder));
});

// Fetch a single order by id. Also admin-protected.
app.get('/api/orders/:id', requireAdmin, (req, res) => {
  const row = getOrder.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  res.json(rowToOrder(row));
});

// Update an order's status (e.g. "new" -> "shipped" -> "delivered").
// Admin-protected.
app.patch('/api/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use one of: ' + allowed.join(', ') });
  }
  const row = getOrder.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  updateStatus.run(status, req.params.id);
  res.json({ ok: true });
});

// Create a new consultation request. Called by consult.html when
// a visitor submits the "Book a Consult" form. No auth required.
app.post('/api/consults', (req, res) => {
  const { fullName, phone, email, message } = req.body || {};

  if (!fullName || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const id = 'MC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const createdAt = new Date().toISOString();

  insertConsult.run({
    id,
    created_at: createdAt,
    full_name: String(fullName).slice(0, 200),
    phone: String(phone).slice(0, 60),
    email: String(email).slice(0, 200),
    message: message ? String(message).slice(0, 1000) : null
  });

  res.status(201).json({ id, createdAt });
});

// List all consultation requests. Admin-protected, same as orders.
app.get('/api/consults', requireAdmin, (req, res) => {
  const rows = listConsults.all();
  res.json(rows.map(rowToConsult));
});

// Fetch a single consultation request by id. Admin-protected.
app.get('/api/consults/:id', requireAdmin, (req, res) => {
  const row = getConsult.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Consultation not found.' });
  res.json(rowToConsult(row));
});

// Update a consultation request's status (e.g. "new" -> "contacted" -> "closed").
app.patch('/api/consults/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['new', 'contacted', 'scheduled', 'closed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use one of: ' + allowed.join(', ') });
  }
  const row = getConsult.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Consultation not found.' });
  updateConsultStatus.run(status, req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`MDrag Orders API listening on port ${PORT}`);
  console.log(`Database file: ${dbPath}`);
});
