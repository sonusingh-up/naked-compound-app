CREATE TABLE products (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  score REAL,
  grade TEXT,
  summary TEXT,
  form TEXT,
  price_inr INTEGER,
  quantity TEXT,
  price_checked_at TEXT,
  categories TEXT NOT NULL,
  review_url TEXT,
  has_review INTEGER NOT NULL DEFAULT 0,
  personally_tested INTEGER NOT NULL DEFAULT 0,
  image_key TEXT,
  flags TEXT,
  cost_per_dose_inr REAL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE products_fts USING fts5(brand, name, form, summary, content='products', content_rowid='rowid');
CREATE TRIGGER products_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, brand, name, form, summary) VALUES (new.rowid, new.brand, new.name, new.form, new.summary);
END;
CREATE TRIGGER products_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, brand, name, form, summary) VALUES ('delete', old.rowid, old.brand, old.name, old.form, old.summary);
END;
CREATE TRIGGER products_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, brand, name, form, summary) VALUES ('delete', old.rowid, old.brand, old.name, old.form, old.summary);
  INSERT INTO products_fts(rowid, brand, name, form, summary) VALUES (new.rowid, new.brand, new.name, new.form, new.summary);
END;

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  retailer TEXT NOT NULL,
  external_id TEXT,
  gtin TEXT,
  affiliate_url TEXT,
  UNIQUE(retailer, external_id)
);
CREATE INDEX listings_gtin ON listings(gtin);
CREATE TABLE review_requests (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
  user_id TEXT, source TEXT NOT NULL,
  retailer TEXT, external_id TEXT, gtin TEXT, title_guess TEXT,
  votes INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE users (id TEXT PRIMARY KEY, email_opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE saved_products (user_id TEXT NOT NULL, product_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, product_id));
CREATE TABLE score_changes (id INTEGER PRIMARY KEY, product_id TEXT NOT NULL, old_score REAL, new_score REAL, changed_at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ai_cache (key TEXT PRIMARY KEY, answer TEXT NOT NULL, product_ids TEXT NOT NULL, created_at TEXT NOT NULL);
