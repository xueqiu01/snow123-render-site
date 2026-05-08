const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { openDb, loadCatalogFromDb, listItems, loadNavMeta, listGroups, listCategories, listQuotes } = require('./db');

const PORT = Number(process.env.PORT || 8787);
const HOST = String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '*').trim() || '*';
const STATIC_ROOT = path.resolve(__dirname, '..', 'frontend');
const db = openDb();
const sessions = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function buildCorsHeaders(req) {
  const origin = String(req.headers.origin || '').trim();
  const allowedOrigins = CORS_ORIGIN.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  let allowOrigin = '*';
  if (CORS_ORIGIN !== '*') {
    allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || '*';
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...buildCorsHeaders(res.req)
  });
  res.end(JSON.stringify(payload));
}

function getTokenFromReq(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function getAdminPassword() {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'admin_password'`).get();
  return String((row && row.value) || process.env.SNOW123_ADMIN_PASSWORD || 'snow123admin');
}

function setAdminPassword(nextPassword) {
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES ('admin_password', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(nextPassword);
}

const insertAuditLog = db.prepare(`
  INSERT INTO audit_logs (action, target_type, target_id, detail)
  VALUES (?, ?, ?, ?)
`);

function addAuditLog(action, targetType, targetId, detail) {
  insertAuditLog.run(
    String(action || ''),
    String(targetType || ''),
    String(targetId || ''),
    typeof detail === 'string' ? detail : JSON.stringify(detail || {})
  );
}

const listAuditLogsStmt = db.prepare(`
  SELECT id, action, target_type, target_id, detail, created_at
  FROM audit_logs
  ORDER BY id DESC
  LIMIT ?
`);

function requireAdmin(req, res) {
  const token = getTokenFromReq(req);
  if (!token || !sessions.has(token)) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendText(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    'Content-Type': contentType
  });
  res.end(body);
}

function resolveStaticFile(urlPath) {
  let pathname = decodeURIComponent(String(urlPath || '/').split('?')[0] || '/');
  if (pathname === '/') pathname = '/index.html';

  const requested = path.normalize(path.join(STATIC_ROOT, pathname));
  if (!requested.startsWith(STATIC_ROOT)) return '';

  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return requested;
  }

  if (!path.extname(requested)) {
    const htmlPath = requested + '.html';
    if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
      return htmlPath;
    }
  }

  return '';
}

function serveStatic(req, res) {
  const filePath = resolveStaticFile(req.url);
  if (!filePath) {
    sendText(res, 404, 'text/plain; charset=utf-8', 'Not found');
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const buffer = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(buffer);
  } catch (error) {
    sendText(res, 500, 'text/plain; charset=utf-8', 'Server error');
  }
  return true;
}

function normalizeItemInput(body) {
  return {
    category_id: String(body.category_id || '').trim(),
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    category: String(body.category || '').trim(),
    name: String(body.name || '').trim(),
    url: String(body.url || '').trim(),
    sample_url: String(body.sample_url || '').trim(),
    form: String(body.form || '').trim(),
    platform: String(body.platform || '').trim(),
    time: String(body.time || '').trim(),
    traffic: String(body.traffic || '').trim(),
    price: String(body.price || '').trim(),
    desc: String(body.desc || '').trim(),
    currency: String(body.currency || 'CNY').trim() || 'CNY',
  };
}

function normalizeQuoteInput(body) {
  return {
    customer_company: String(body.customer_company || '').trim(),
    customer_name: String(body.customer_name || '').trim(),
    salesperson: String(body.salesperson || '').trim(),
    quote_date: String(body.quote_date || '').trim(),
    valid_until: String(body.valid_until || '').trim(),
    valid_days: Number.isFinite(Number(body.valid_days)) ? Number(body.valid_days) : 7,
    total_amount: Number.isFinite(Number(body.total_amount)) ? Number(body.total_amount) : 0,
    currency: String(body.currency || 'CNY').trim() || 'CNY',
    notes: String(body.notes || '').trim(),
    items: Array.isArray(body.items) ? body.items : []
  };
}

function validateItemInput(item) {
  if (!item.category_id) return 'category_id is required';
  if (!item.name) return 'name is required';
  return '';
}

function getIdFromPath(url, prefix) {
  if (!url.startsWith(prefix)) return 0;
  const raw = url.slice(prefix.length).split('?')[0];
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

const insertItem = db.prepare(`
  INSERT INTO items (
    category_id, sort_order, item_category, name, url, sample_url, form, platform, time, traffic, price, "desc", currency
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateItem = db.prepare(`
  UPDATE items
  SET
    category_id = ?,
    sort_order = ?,
    item_category = ?,
    name = ?,
    url = ?,
    sample_url = ?,
    form = ?,
    platform = ?,
    time = ?,
    traffic = ?,
    price = ?,
    "desc" = ?,
    currency = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND is_active = 1
`);

const softDeleteItem = db.prepare(`
  UPDATE items
  SET is_active = 0, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND is_active = 1
`);
const softDeleteManyItems = db.prepare(`
  UPDATE items
  SET is_active = 0, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND is_active = 1
`);

const getItem = db.prepare(`
  SELECT *
  FROM items
  WHERE id = ? AND is_active = 1
`);
const getItemsByIds = db.prepare(`
  SELECT *
  FROM items
  WHERE id = ? AND is_active = 1
`);
const duplicateItem = db.prepare(`
  INSERT INTO items (
    category_id, sort_order, item_category, name, url, sample_url, form, platform, time, traffic, price, "desc", currency
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateGroup = db.prepare(`
  UPDATE category_groups
  SET title = ?, sort_order = ?
  WHERE id = ?
`);

const updateCategory = db.prepare(`
  UPDATE categories
  SET label = ?, icon = ?, group_id = ?, sort_order = ?, is_visible = ?
  WHERE id = ?
`);

const getGroup = db.prepare(`
  SELECT id, title, sort_order
  FROM category_groups
  WHERE id = ?
`);

const getCategory = db.prepare(`
  SELECT id, label, icon, group_id, sort_order, is_visible
  FROM categories
  WHERE id = ?
`);

const insertQuote = db.prepare(`
  INSERT INTO quotes (
    quote_no, customer_company, customer_name, salesperson, quote_date, valid_until, valid_days, total_amount, currency, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertQuoteItem = db.prepare(`
  INSERT INTO quote_items (
    quote_id, item_id, item_name, item_category, category_id, platform, qty, unit_price, subtotal
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getQuote = db.prepare(`
  SELECT id, quote_no, customer_company, customer_name, salesperson, quote_date, valid_until, valid_days, total_amount, currency, notes, created_at
  FROM quotes
  WHERE id = ?
`);

const getQuoteItems = db.prepare(`
  SELECT id, quote_id, item_id, item_name, item_category, category_id, platform, qty, unit_price, subtotal
  FROM quote_items
  WHERE quote_id = ?
  ORDER BY id ASC
`);
const updateQuoteNotes = db.prepare(`
  UPDATE quotes
  SET notes = ?
  WHERE id = ?
`);
const deleteQuoteItems = db.prepare(`
  DELETE FROM quote_items
  WHERE quote_id = ?
`);
const deleteQuote = db.prepare(`
  DELETE FROM quotes
  WHERE id = ?
`);

const server = http.createServer(async (req, res) => {
  res.req = req;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...buildCorsHeaders(req)
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'snow123-backend', db: 'sqlite' });
    }

    if (req.method === 'GET' && req.url === '/api/catalog') {
      return sendJson(res, 200, {
        ok: true,
        updatedAt: new Date().toISOString(),
        categories: loadCatalogFromDb(db)
      });
    }

    if (req.method === 'GET' && req.url === '/api/nav-meta') {
      return sendJson(res, 200, {
        ok: true,
        ...loadNavMeta(db)
      });
    }

    if (req.method === 'POST' && req.url === '/api/quotes') {
      const body = await parseBody(req);
      const quote = normalizeQuoteInput(body);
      if (!quote.quote_date) return sendJson(res, 400, { ok: false, error: 'quote_date is required' });
      if (!quote.valid_until) return sendJson(res, 400, { ok: false, error: 'valid_until is required' });
      if (!quote.items.length) return sendJson(res, 400, { ok: false, error: 'items are required' });

      const quoteNo = 'Q' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const result = insertQuote.run(
        quoteNo,
        quote.customer_company,
        quote.customer_name,
        quote.salesperson,
        quote.quote_date,
        quote.valid_until,
        quote.valid_days,
        quote.total_amount,
        quote.currency,
        quote.notes
      );
      const quoteId = Number(result.lastInsertRowid);
      quote.items.forEach((item) => {
        insertQuoteItem.run(
          quoteId,
          item.item_id || null,
          String(item.item_name || '').trim(),
          String(item.item_category || '').trim(),
          String(item.category_id || '').trim(),
          String(item.platform || '').trim(),
          Number(item.qty || 1),
          Number(item.unit_price || 0),
          Number(item.subtotal || 0)
        );
      });
      return sendJson(res, 201, { ok: true, id: quoteId, quote_no: quoteNo });
    }

    if (req.method === 'POST' && req.url === '/api/admin/login') {
      const body = await parseBody(req);
      const password = String(body.password || '');
      if (password !== getAdminPassword()) {
        return sendJson(res, 401, { ok: false, error: 'Invalid password' });
      }
      const token = createSession();
      return sendJson(res, 200, { ok: true, token });
    }

    if (req.method === 'POST' && req.url === '/api/admin/logout') {
      const token = getTokenFromReq(req);
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/api/admin/session') {
      const token = getTokenFromReq(req);
      return sendJson(res, 200, { ok: true, authenticated: !!(token && sessions.has(token)) });
    }

    if (req.method === 'POST' && req.url === '/api/admin/change-password') {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const currentPassword = String(body.current_password || '');
      const newPassword = String(body.new_password || '').trim();
      if (currentPassword !== getAdminPassword()) {
        return sendJson(res, 400, { ok: false, error: 'Current password is incorrect' });
      }
      if (newPassword.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'New password must be at least 6 characters' });
      }
      setAdminPassword(newPassword);
      addAuditLog('change_password', 'system', 'admin_password', { ok: true });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/admin/audit-logs')) {
      if (!requireAdmin(req, res)) return;
      const rawLimit = Number(new URL(req.url, 'http://127.0.0.1').searchParams.get('limit') || 20);
      const limit = Math.max(1, Math.min(100, rawLimit));
      return sendJson(res, 200, { ok: true, logs: listAuditLogsStmt.all(limit) });
    }

    if (req.method === 'GET' && req.url === '/api/admin/items') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { ok: true, items: listItems(db) });
    }

    if (req.method === 'GET' && req.url === '/api/admin/nav') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, {
        ok: true,
        groups: listGroups(db),
        categories: listCategories(db)
      });
    }

    if (req.method === 'GET' && req.url === '/api/admin/quotes') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { ok: true, quotes: listQuotes(db) });
    }

    if (req.method === 'POST' && req.url === '/api/admin/items') {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const item = normalizeItemInput(body);
      const error = validateItemInput(item);
      if (error) return sendJson(res, 400, { ok: false, error });

      const result = insertItem.run(
        item.category_id,
        item.sort_order,
        item.category,
        item.name,
        item.url,
        item.sample_url,
        item.form,
        item.platform,
        item.time,
        item.traffic,
        item.price,
        item.desc,
        item.currency
      );
      return sendJson(res, 201, { ok: true, id: Number(result.lastInsertRowid) });
    }

    if (req.method === 'PATCH' && req.url.startsWith('/api/admin/items/')) {
      if (!requireAdmin(req, res)) return;
      const id = getIdFromPath(req.url, '/api/admin/items/');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid item id' });

      const existing = getItem.get(id);
      if (!existing) return sendJson(res, 404, { ok: false, error: 'Item not found' });

      const body = await parseBody(req);
      const merged = normalizeItemInput({
        category_id: body.category_id ?? existing.category_id,
        sort_order: body.sort_order ?? existing.sort_order,
        category: body.category ?? existing.item_category,
        name: body.name ?? existing.name,
        url: body.url ?? existing.url,
        sample_url: body.sample_url ?? existing.sample_url,
        form: body.form ?? existing.form,
        platform: body.platform ?? existing.platform,
        time: body.time ?? existing.time,
        traffic: body.traffic ?? existing.traffic,
        price: body.price ?? existing.price,
        desc: body.desc ?? existing.desc,
        currency: body.currency ?? existing.currency,
      });
      const error = validateItemInput(merged);
      if (error) return sendJson(res, 400, { ok: false, error });

      updateItem.run(
        merged.category_id,
        merged.sort_order,
        merged.category,
        merged.name,
        merged.url,
        merged.sample_url,
        merged.form,
        merged.platform,
        merged.time,
        merged.traffic,
        merged.price,
        merged.desc,
        merged.currency,
        id
      );
      addAuditLog('update_item', 'item', id, { name: merged.name, category_id: merged.category_id });
      return sendJson(res, 200, { ok: true, id });
    }

    if (req.method === 'DELETE' && req.url.startsWith('/api/admin/items/')) {
      if (!requireAdmin(req, res)) return;
      const id = getIdFromPath(req.url, '/api/admin/items/');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid item id' });
      softDeleteItem.run(id);
      addAuditLog('delete_item', 'item', id, { id });
      return sendJson(res, 200, { ok: true, id });
    }

    if (req.method === 'POST' && req.url === '/api/admin/items/bulk-delete') {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
      if (!ids.length) return sendJson(res, 400, { ok: false, error: 'ids are required' });
      const tx = db.transaction((list) => {
        list.forEach((id) => softDeleteManyItems.run(id));
      });
      tx(ids);
      addAuditLog('bulk_delete_items', 'item', ids.join(','), { count: ids.length });
      return sendJson(res, 200, { ok: true, count: ids.length, ids });
    }

    if (req.method === 'POST' && req.url === '/api/admin/items/bulk-update') {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
      if (!ids.length) return sendJson(res, 400, { ok: false, error: 'ids are required' });

      const nextFields = {
        category_id: body.category_id,
        sort_order: body.sort_order,
        category: body.category,
        name: body.name,
        url: body.url,
        sample_url: body.sample_url,
        form: body.form,
        platform: body.platform,
        time: body.time,
        traffic: body.traffic,
        price: body.price,
        desc: body.desc,
        currency: body.currency
      };

      const hasAnyField = Object.values(nextFields).some((value) => value !== undefined);
      if (!hasAnyField) return sendJson(res, 400, { ok: false, error: 'no fields to update' });

      const tx = db.transaction((list) => {
        let updated = 0;
        list.forEach((id) => {
          const existing = getItemsByIds.get(id);
          if (!existing) return;
          const merged = normalizeItemInput({
            category_id: nextFields.category_id ?? existing.category_id,
            sort_order: nextFields.sort_order ?? existing.sort_order,
            category: nextFields.category ?? existing.item_category,
            name: nextFields.name ?? existing.name,
            url: nextFields.url ?? existing.url,
            sample_url: nextFields.sample_url ?? existing.sample_url,
            form: nextFields.form ?? existing.form,
            platform: nextFields.platform ?? existing.platform,
            time: nextFields.time ?? existing.time,
            traffic: nextFields.traffic ?? existing.traffic,
            price: nextFields.price ?? existing.price,
            desc: nextFields.desc ?? existing.desc,
            currency: nextFields.currency ?? existing.currency,
          });
          const error = validateItemInput(merged);
          if (error) throw new Error(error);
          updateItem.run(
            merged.category_id,
            merged.sort_order,
            merged.category,
            merged.name,
            merged.url,
            merged.sample_url,
            merged.form,
            merged.platform,
            merged.time,
            merged.traffic,
            merged.price,
            merged.desc,
            merged.currency,
            id
          );
          updated += 1;
        });
        return updated;
      });

      const updated = tx(ids);
      addAuditLog('bulk_update_items', 'item', ids.join(','), { count: updated });
      return sendJson(res, 200, { ok: true, count: updated, ids });
    }

    if (req.method === 'POST' && req.url === '/api/admin/items/bulk-duplicate') {
      if (!requireAdmin(req, res)) return;
      const body = await parseBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
      if (!ids.length) return sendJson(res, 400, { ok: false, error: 'ids are required' });

      const tx = db.transaction((list) => {
        const newIds = [];
        list.forEach((id) => {
          const existing = getItemsByIds.get(id);
          if (!existing) return;
          const result = duplicateItem.run(
            existing.category_id,
            existing.sort_order,
            existing.item_category,
            String(existing.name || '') + '（复制）',
            existing.url,
            existing.sample_url,
            existing.form,
            existing.platform,
            existing.time,
            existing.traffic,
            existing.price,
            existing.desc,
            existing.currency
          );
          newIds.push(Number(result.lastInsertRowid));
        });
        return newIds;
      });

      const newIds = tx(ids);
      addAuditLog('bulk_duplicate_items', 'item', newIds.join(','), { source_ids: ids, count: newIds.length });
      return sendJson(res, 201, { ok: true, count: newIds.length, ids: newIds });
    }

    if (req.method === 'PATCH' && req.url.startsWith('/api/admin/groups/')) {
      if (!requireAdmin(req, res)) return;
      const id = req.url.slice('/api/admin/groups/'.length).split('?')[0];
      const existing = getGroup.get(id);
      if (!existing) return sendJson(res, 404, { ok: false, error: 'Group not found' });
      const body = await parseBody(req);
      const title = String(body.title ?? existing.title).trim();
      const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : existing.sort_order;
      if (!title) return sendJson(res, 400, { ok: false, error: 'title is required' });
      updateGroup.run(title, sortOrder, id);
      return sendJson(res, 200, { ok: true, id });
    }

    if (req.method === 'PATCH' && req.url.startsWith('/api/admin/categories/')) {
      if (!requireAdmin(req, res)) return;
      const id = req.url.slice('/api/admin/categories/'.length).split('?')[0];
      const existing = getCategory.get(id);
      if (!existing) return sendJson(res, 404, { ok: false, error: 'Category not found' });
      const body = await parseBody(req);
      const label = String(body.label ?? existing.label).trim();
      const icon = String(body.icon ?? existing.icon).trim();
      const groupId = String(body.group_id ?? existing.group_id).trim();
      const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : existing.sort_order;
      const isVisible = body.is_visible === undefined ? existing.is_visible : (body.is_visible ? 1 : 0);
      if (!label) return sendJson(res, 400, { ok: false, error: 'label is required' });
      if (!groupId) return sendJson(res, 400, { ok: false, error: 'group_id is required' });
      updateCategory.run(label, icon, groupId, sortOrder, isVisible, id);
      return sendJson(res, 200, { ok: true, id });
    }

    if (req.method === 'GET' && req.url.startsWith('/api/admin/quotes/')) {
      if (!requireAdmin(req, res)) return;
      const id = getIdFromPath(req.url, '/api/admin/quotes/');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid quote id' });
      const quote = getQuote.get(id);
      if (!quote) return sendJson(res, 404, { ok: false, error: 'Quote not found' });
      return sendJson(res, 200, { ok: true, quote, items: getQuoteItems.all(id) });
    }

    if (req.method === 'PATCH' && req.url.startsWith('/api/admin/quotes/')) {
      if (!requireAdmin(req, res)) return;
      const id = getIdFromPath(req.url, '/api/admin/quotes/');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid quote id' });
      const quote = getQuote.get(id);
      if (!quote) return sendJson(res, 404, { ok: false, error: 'Quote not found' });
      const body = await parseBody(req);
      const notes = String(body.notes ?? quote.notes ?? '').trim();
      updateQuoteNotes.run(notes, id);
      addAuditLog('update_quote_notes', 'quote', id, { quote_no: quote.quote_no });
      return sendJson(res, 200, { ok: true, id });
    }

    if (req.method === 'DELETE' && req.url.startsWith('/api/admin/quotes/')) {
      if (!requireAdmin(req, res)) return;
      const id = getIdFromPath(req.url, '/api/admin/quotes/');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid quote id' });
      const quote = getQuote.get(id);
      if (!quote) return sendJson(res, 404, { ok: false, error: 'Quote not found' });
      const tx = db.transaction((quoteId) => {
        deleteQuoteItems.run(quoteId);
        deleteQuote.run(quoteId);
      });
      tx(id);
      addAuditLog('delete_quote', 'quote', id, { quote_no: quote.quote_no });
      return sendJson(res, 200, { ok: true, id });
    }

    if (!req.url.startsWith('/api/')) {
      return serveStatic(req, res);
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: 'Server error', detail: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`snow123 backend listening on http://${HOST}:${PORT}`);
});
