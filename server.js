require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ramsfx_jwt_secret_change_in_production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PAYPAL_LINKS = (function () {
  try { return JSON.parse(process.env.PAYPAL_LINKS || '{}'); } catch { return {}; }
})();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new Database(path.join(__dirname, 'ramsfx.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    features TEXT,
    tag TEXT, tag_class TEXT,
    badge TEXT, badge_class TEXT,
    featured INTEGER DEFAULT 0,
    file_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ea_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    stored_name TEXT,
    size INTEGER,
    file_data BLOB,
    product_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    product_id INTEGER,
    account_1 TEXT,
    account_2 TEXT,
    email TEXT,
    max_devices INTEGER DEFAULT 2,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    product_id INTEGER,
    customer_email TEXT,
    account_1 TEXT,
    account_2 TEXT,
    payment_method TEXT,
    amount INTEGER,
    paypal_order_id TEXT,
    status TEXT DEFAULT 'Pending',
    license_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const adminCount = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  if (!adminCount) {
    db.prepare('INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
  } else {
    db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, 'admin');
  }
}

const productCount = db.prepare('SELECT id FROM products LIMIT 1').get();
if (!productCount) {
  const defaultProducts = [
    { name: 'Gold Hunter v3.1', description: 'Advanced XAUUSD scalper with Quantum Trend Engine, smart exit system, and live news avoidance.', price: 79, features: JSON.stringify(['XAUUSD specialist (XAUUSDz)', 'Quantum Trend Engine', 'Auto partial close & trailing stop', 'DXY/VIX economic filter', 'MT5 compatible', 'Locked to 2 accounts max']), tag: 'Best Seller', tag_class: 'badge-gold', badge: 'In Stock', badge_class: 'badge-success', featured: 1 },
    { name: 'Trend Hunter EA', description: 'Momentum-based swing bot optimised for D1 and H4 timeframes with multi-pair support.', price: 49, features: JSON.stringify(['Multi-pair support', 'Built-in news filter', 'D1 & H4 timeframes', 'MT5 compatible', 'Locked to 2 accounts max']), tag: 'Swing Trading', tag_class: 'badge-muted', featured: 0 },
    { name: 'Grid Master EA', description: 'Advanced grid trading system with drawdown protection for ranging market conditions.', price: 69, features: JSON.stringify(['Ranging market optimised', 'Drawdown protection', 'Customisable grid spacing', 'MT5 compatible', 'Locked to 2 accounts max']), tag: 'Grid Strategy', tag_class: 'badge-muted', featured: 0 }
  ];
  const stmt = db.prepare('INSERT INTO products (name, description, price, features, tag, tag_class, badge, badge_class, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  defaultProducts.forEach(p => stmt.run(p.name, p.description, p.price, p.features, p.tag, p.tag_class, p.badge, p.badge_class, p.featured));
}

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => { let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s; };
  return 'RFB-' + seg() + '-' + seg() + '-' + seg();
}

function orderNumber() {
  return '#' + String(Date.now()).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.admin = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// =========== PUBLIC API ===========

app.get('/api/config', (req, res) => {
  const host = req.get('host') || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  res.json({ paypal_links: PAYPAL_LINKS, is_local: isLocal });
});

app.post('/api/init-paypal-order', (req, res) => {
  const { product_id, account_1, account_2, email } = req.body;
  if (!product_id || !account_1 || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const link = PAYPAL_LINKS[String(product_id)];
    if (!link) return res.status(400).json({ error: 'No payment link configured for this product' });
    const token = uuidv4().slice(0, 8);
    const expires = Date.now() + 30 * 60 * 1000;
    db.prepare(`INSERT INTO orders (order_number, product_id, customer_email, account_1, account_2, payment_method, amount, paypal_order_id, status, license_id)
      VALUES (?, ?, ?, ?, ?, 'PayPal Link', ?, ?, 'Pending', NULL)`).run(
      orderNumber(), product_id, email, account_1, account_2 || null, product.price, token);
    res.json({ url: link, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/complete-paypal-order', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  try {
    const order = db.prepare('SELECT * FROM orders WHERE paypal_order_id = ? AND status = ?').get(token, 'Pending');
    if (!order) return res.status(404).json({ error: 'Order not found or already completed' });
    const key = generateLicenseKey();
    const licResult = db.prepare('INSERT INTO licenses (license_key, product_id, account_1, account_2, email) VALUES (?, ?, ?, ?, ?)').run(
      key, order.product_id, order.account_1, order.account_2, order.customer_email);
    db.prepare('UPDATE orders SET status = ?, license_id = ? WHERE id = ?').run('Complete', licResult.lastInsertRowid, order.id);
    const file = db.prepare('SELECT * FROM ea_files WHERE product_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(order.product_id);
    res.json({
      success: true, license_key: key, order_number: order.order_number,
      download_url: file ? '/api/download/' + file.id : null,
      file_name: file ? file.original_name : null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products', (req, res) => {
  try {
    const rows = db.prepare(`SELECT p.*, f.original_name as file_name, f.stored_name, f.id as file_id
      FROM products p LEFT JOIN ea_files f ON p.file_id = f.id
      WHERE p.is_active = 1`).all();
    rows.forEach(r => { try { r.features = JSON.parse(r.features); } catch { r.features = []; } });
    res.json({ products: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/validate', (req, res) => {
  const { license_key, account_id, machine_id } = req.body;
  if (!license_key || !account_id || !machine_id) return res.json({ success: false, message: 'Missing parameters' });
  try {
    const lic = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND is_active = 1').get(license_key);
    if (!lic) return res.json({ success: false, message: 'Invalid license' });
    const allowed = [lic.account_1, lic.account_2].filter(Boolean);
    if (!allowed.includes(account_id)) return res.json({ success: false, message: 'Account not licensed' });
    db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(lic.id);
    res.json({ success: true, message: 'License valid', product_id: lic.product_id });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/activate', (req, res) => {
  const { product_id, account_1, account_2, email } = req.body;
  if (!product_id || !account_1 || !email) return res.json({ success: false, message: 'Missing required fields' });
  try {
    const key = generateLicenseKey();
    const on = orderNumber();
    const licResult = db.prepare('INSERT INTO licenses (license_key, product_id, account_1, account_2, email) VALUES (?, ?, ?, ?, ?)').run(key, product_id, account_1, account_2 || null, email);
    const product = db.prepare('SELECT price FROM products WHERE id = ?').get(product_id);
    db.prepare(`INSERT INTO orders (order_number, product_id, customer_email, account_1, account_2, payment_method, amount, status, license_id)
      VALUES (?, ?, ?, ?, ?, 'PayPal Link', ?, 'Complete', ?)`).run(on, product_id, email, account_1, account_2 || null, product ? product.price : 0, licResult.lastInsertRowid);
    res.json({ success: true, license_key: key, order_number: on });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/test-payment', (req, res) => {
  const { product_id, account_1, account_2, email } = req.body;
  if (!product_id || !account_1 || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    const product = db.prepare('SELECT price FROM products WHERE id = ? AND is_active = 1').get(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const key = generateLicenseKey();
    const on = orderNumber();
    const licResult = db.prepare('INSERT INTO licenses (license_key, product_id, account_1, account_2, email) VALUES (?, ?, ?, ?, ?)').run(key, product_id, account_1, account_2 || null, email);
    db.prepare(`INSERT INTO orders (order_number, product_id, customer_email, account_1, account_2, payment_method, amount, status, license_id)
      VALUES (?, ?, ?, ?, ?, 'Test', ?, 'Complete', ?)`).run(on, product_id, email, account_1, account_2 || null, product.price, licResult.lastInsertRowid);
    const file = db.prepare('SELECT * FROM ea_files WHERE product_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(product_id);
    res.json({
      success: true,
      license_key: key,
      order_number: on,
      download_url: file ? '/api/download/' + file.id : null,
      file_name: file ? file.original_name : null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/check-license', (req, res) => {
  const { key, account } = req.query;
  try {
    const lic = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND is_active = 1').get(key);
    if (!lic) return res.json({ valid: false });
    if (account && ![lic.account_1, lic.account_2].filter(Boolean).includes(account)) return res.json({ valid: false });
    res.json({ valid: true, expires: lic.created_at });
  } catch (e) { res.json({ valid: false }); }
});

// =========== ADMIN API ===========

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
  try {
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: admin.username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', auth, (req, res) => {
  try {
    const orderStats = db.prepare('SELECT status, COUNT(*) as count FROM orders GROUP BY status').all();
    const activeLic = db.prepare('SELECT COUNT(*) as c FROM licenses WHERE is_active = 1').get().c;
    const revokedLic = db.prepare('SELECT COUNT(*) as c FROM licenses WHERE is_active = 0').get().c;
    const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM orders WHERE status = 'Complete'").get().t;
    const pendingOrders = (orderStats.find(o => o.status === 'Pending') || {}).count || 0;
    res.json({ revenue, active_licenses: activeLic, total_orders: totalOrders, revoked: revokedLic, pending_orders: pendingOrders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/products', auth, (req, res) => {
  try {
    const rows = db.prepare('SELECT p.*, f.original_name as file_name FROM products p LEFT JOIN ea_files f ON p.file_id = f.id ORDER BY p.created_at DESC').all();
    rows.forEach(r => { try { r.features = JSON.parse(r.features); } catch { r.features = []; } });
    res.json({ products: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/products', auth, (req, res) => {
  const { name, description, price, features, tag, tag_class, badge, badge_class, featured } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  try {
    const r = db.prepare('INSERT INTO products (name, description, price, features, tag, tag_class, badge, badge_class, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      name, description, price, JSON.stringify(features || []), tag || null, tag_class || null, badge || null, badge_class || null, featured ? 1 : 0);
    res.json({ success: true, id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/products/:id', auth, (req, res) => {
  const { name, description, price, features, tag, tag_class, badge, badge_class, featured } = req.body;
  try {
    db.prepare('UPDATE products SET name=?, description=?, price=?, features=?, tag=?, tag_class=?, badge=?, badge_class=?, featured=? WHERE id=?').run(
      name, description, price, JSON.stringify(features || []), tag, tag_class, badge, badge_class, featured ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/products/:id', auth, (req, res) => {
  try {
    db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/files', auth, (req, res) => {
  try {
    const rows = db.prepare('SELECT f.*, p.name as product_name FROM ea_files f LEFT JOIN products p ON f.product_id = p.id ORDER BY f.created_at DESC').all();
    res.json({ files: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/files/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const productId = req.body.product_id || null;
    const r = db.prepare('INSERT INTO ea_files (original_name, stored_name, size, file_data, product_id) VALUES (?, ?, ?, ?, ?)').run(
      req.file.originalname, req.file.originalname, req.file.size, req.file.buffer, productId);
    if (productId) {
      db.prepare('UPDATE products SET file_id = ? WHERE id = ?').run(Number(r.lastInsertRowid), productId);
    }
    res.json({ success: true, id: Number(r.lastInsertRowid), file: { originalname: req.file.originalname, size: req.file.size } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/files/:id', auth, (req, res) => {
  try {
    db.prepare('UPDATE ea_files SET product_id = ? WHERE id = ?').run(req.body.product_id || null, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/files/:id', auth, (req, res) => {
  try {
    db.prepare('DELETE FROM ea_files WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/download/:id', (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM ea_files WHERE id = ? AND is_active = 1').get(req.params.id);
    if (!file || !file.file_data) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', 'attachment; filename="' + file.original_name + '"');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(file.file_data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/licenses', auth, (req, res) => {
  try {
    const rows = db.prepare('SELECT l.*, p.name as product_name FROM licenses l LEFT JOIN products p ON l.product_id = p.id ORDER BY l.created_at DESC').all();
    res.json({ licenses: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses', auth, (req, res) => {
  const { product_id, account_1, account_2, email } = req.body;
  if (!account_1) return res.status(400).json({ error: 'Account #1 required' });
  try {
    const key = generateLicenseKey();
    const r = db.prepare('INSERT INTO licenses (license_key, product_id, account_1, account_2, email) VALUES (?, ?, ?, ?, ?)').run(key, product_id || null, account_1, account_2 || null, email || null);
    res.json({ success: true, license_key: key, id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses/revoke', auth, (req, res) => {
  try {
    db.prepare('UPDATE licenses SET is_active = 0 WHERE id = ?').run(req.body.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses/restore', auth, (req, res) => {
  try {
    db.prepare('UPDATE licenses SET is_active = 1 WHERE id = ?').run(req.body.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/orders', auth, (req, res) => {
  try {
    const rows = db.prepare('SELECT o.*, p.name as product_name FROM orders o LEFT JOIN products p ON o.product_id = p.id ORDER BY o.created_at DESC').all();
    res.json({ orders: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders/refund', auth, (req, res) => {
  try {
    db.prepare("UPDATE orders SET status = 'Refunded' WHERE id = ?").run(req.body.id);
    db.prepare('UPDATE licenses SET is_active = 0 WHERE id = (SELECT license_id FROM orders WHERE id = ?)').run(req.body.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.use(function (err, req, res, next) {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload error: ' + err.message });
  if (err) return res.status(500).json({ error: err.message || 'Server error' });
  next();
});

app.listen(PORT, () => {
  console.log(`Rams FX server running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
  if (ADMIN_PASSWORD) console.log('Admin: configured');
  else console.log('Admin: NOT configured (set ADMIN_PASSWORD env var)');
  const linkCount = Object.keys(PAYPAL_LINKS).length;
  if (linkCount > 0) console.log('PayPal links: ' + linkCount + ' configured');
  else console.log('PayPal links: none configured (set PAYPAL_LINKS env var)');
});
