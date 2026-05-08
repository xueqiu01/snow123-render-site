const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'snow123.sqlite');
const bundledDataDir = path.join(__dirname, 'data');
const bundledDbPath = path.join(bundledDataDir, 'snow123.sqlite');

const DEFAULT_GROUPS = [
  { id: 'promotion', title: '站外推广', sort_order: 1 },
  { id: 'video', title: '红人视频', sort_order: 2 },
  { id: 'media', title: 'PR/媒体', sort_order: 3 },
  { id: 'amazon', title: '亚马逊周边', sort_order: 4 },
];

const DEFAULT_CATEGORIES = [
  { id: 'us', label: '美国站站外', icon: '🇺🇸', group_id: 'promotion', sort_order: 1 },
  { id: 'eu', label: '小站点站外', icon: '🌍', group_id: 'promotion', sort_order: 2 },
  { id: 'tkins', label: '博主渠道', icon: '📱', group_id: 'promotion', sort_order: 3 },
  { id: 'tg', label: 'Telegram渠道', icon: '✈️', group_id: 'promotion', sort_order: 4 },
  { id: 'influencerVideo', label: '影响者视频', icon: '🎬', group_id: 'video', sort_order: 1 },
  { id: 'pr', label: 'PR媒体', icon: '📰', group_id: 'media', sort_order: 1 },
  { id: 'service', label: '亚马逊周边服务', icon: '⚙️', group_id: 'amazon', sort_order: 1 },
  { id: 'appeal', label: '申诉', icon: '🛡️', group_id: 'amazon', sort_order: 2 },
  { id: 'vine', label: '定制Vine', icon: '🟢', group_id: 'amazon', sort_order: 3 },
  { id: 'tool', label: '亚马逊工具', icon: '🔧', group_id: 'amazon', sort_order: 4 },
  { id: 'ebook', label: '站外学习', icon: '📘', group_id: 'amazon', sort_order: 5 },
];

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function ensureSeedDb() {
  if (dbPath === bundledDbPath) return;
  if (fs.existsSync(dbPath)) return;
  if (!fs.existsSync(bundledDbPath)) return;

  fs.copyFileSync(bundledDbPath, dbPath);
}

function seedMeta(db) {
  const groupCount = db.prepare('SELECT COUNT(*) AS c FROM category_groups').get().c;
  if (!groupCount) {
    const insertGroup = db.prepare(`
      INSERT INTO category_groups (id, title, sort_order)
      VALUES (?, ?, ?)
    `);
    DEFAULT_GROUPS.forEach((group) => insertGroup.run(group.id, group.title, group.sort_order));
  }

  const categoryCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (!categoryCount) {
    const insertCategory = db.prepare(`
      INSERT INTO categories (id, label, icon, group_id, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    DEFAULT_CATEGORIES.forEach((category) => {
      insertCategory.run(category.id, category.label, category.icon, category.group_id, category.sort_order);
    });
  }
}

function openDb() {
  ensureDir();
  ensureSeedDb();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS category_groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      group_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES category_groups(id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      item_category TEXT DEFAULT '',
      name TEXT NOT NULL,
      url TEXT DEFAULT '',
      sample_url TEXT DEFAULT '',
      form TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      time TEXT DEFAULT '',
      traffic TEXT DEFAULT '',
      price TEXT DEFAULT '',
      "desc" TEXT DEFAULT '',
      currency TEXT DEFAULT 'CNY',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_no TEXT NOT NULL UNIQUE,
      customer_company TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      salesperson TEXT DEFAULT '',
      quote_date TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      valid_days INTEGER NOT NULL DEFAULT 7,
      total_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      item_category TEXT DEFAULT '',
      category_id TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (quote_id) REFERENCES quotes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_category_sort
      ON items (category_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id
      ON quote_items (quote_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
      ON audit_logs (id DESC);
  `);
  seedMeta(db);
  return db;
}

function mapRow(row) {
  return {
    id: row.id,
    category_id: row.category_id,
    category: row.item_category || '',
    name: row.name || '',
    url: row.url || '',
    sample_url: row.sample_url || '',
    form: row.form || '',
    platform: row.platform || '',
    time: row.time || '',
    traffic: row.traffic || '',
    price: row.price || '',
    desc: row.desc || '',
    currency: row.currency || 'CNY',
  };
}

function loadCatalogFromDb(db) {
  const rows = db.prepare(`
    SELECT i.*
    FROM items i
    JOIN categories c ON c.id = i.category_id
    WHERE i.is_active = 1 AND c.is_visible = 1
    ORDER BY c.sort_order ASC, i.sort_order ASC, i.id ASC
  `).all();

  const out = {};
  for (const row of rows) {
    if (!out[row.category_id]) out[row.category_id] = [];
    out[row.category_id].push(mapRow(row));
  }
  return out;
}

function listItems(db) {
  return db.prepare(`
    SELECT *
    FROM items
    WHERE is_active = 1
    ORDER BY category_id ASC, sort_order ASC, id ASC
  `).all().map((row) => ({
    id: row.id,
    category_id: row.category_id,
    sort_order: row.sort_order,
    category: row.item_category || '',
    name: row.name || '',
    url: row.url || '',
    sample_url: row.sample_url || '',
    form: row.form || '',
    platform: row.platform || '',
    time: row.time || '',
    traffic: row.traffic || '',
    price: row.price || '',
    desc: row.desc || '',
    currency: row.currency || 'CNY',
  }));
}

function listGroups(db) {
  return db.prepare(`
    SELECT id, title, sort_order
    FROM category_groups
    ORDER BY sort_order ASC, id ASC
  `).all();
}

function listCategories(db) {
  return db.prepare(`
    SELECT id, label, icon, group_id, sort_order, is_visible
    FROM categories
    ORDER BY group_id ASC, sort_order ASC, id ASC
  `).all().map((row) => ({
    id: row.id,
    label: row.label,
    icon: row.icon,
    group_id: row.group_id,
    sort_order: row.sort_order,
    is_visible: !!row.is_visible,
  }));
}

function loadNavMeta(db) {
  return {
    groups: listGroups(db),
    categories: listCategories(db),
  };
}

function listQuotes(db) {
  return db.prepare(`
    SELECT id, quote_no, customer_company, customer_name, salesperson, quote_date, valid_until, valid_days, total_amount, currency, created_at
    FROM quotes
    ORDER BY id DESC
  `).all();
}

module.exports = {
  dbPath,
  openDb,
  loadCatalogFromDb,
  listItems,
  listGroups,
  listCategories,
  loadNavMeta,
  listQuotes,
};
