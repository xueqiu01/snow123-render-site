const fs = require('fs');
const path = require('path');
const { openDb, dbPath } = require('../db');

const catalogPath = path.join(__dirname, '..', '..', 'shared-data', 'catalog.json');

function main() {
  const raw = fs.readFileSync(catalogPath, 'utf8');
  const catalog = JSON.parse(raw);
  const db = openDb();

  db.exec('DELETE FROM items;');

  const insert = db.prepare(`
    INSERT INTO items (
      category_id, sort_order, item_category, name, url, sample_url, form, platform, time, traffic, price, "desc", currency
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  let count = 0;
  for (const [categoryId, items] of Object.entries(catalog)) {
    items.forEach((item, index) => {
      insert.run(
        categoryId,
        index,
        item.category || '',
        item.name || '',
        item.url || '',
        item.sample_url || '',
        item.form || '',
        item.platform || '',
        item.time || '',
        item.traffic || '',
        item.price || '',
        item.desc || '',
        item.currency || 'CNY'
      );
      count += 1;
    });
  }

  console.log(`Imported ${count} items into ${dbPath}`);
}

main();
