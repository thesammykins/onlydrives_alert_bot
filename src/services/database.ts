import BetterSqlite3 from 'better-sqlite3';
import type { ProductState, AlertType } from '../types.js';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS product_state (
        product_id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        source TEXT NOT NULL,
        last_price_total REAL NOT NULL,
        last_price_per_tb REAL NOT NULL,
        last_available INTEGER NOT NULL,
        last_checked_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_state_sku ON product_state(sku);

      CREATE TABLE IF NOT EXISTS alert_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_product_type ON alert_log(product_id, alert_type, sent_at);
    `);
  }

  getProductState(productId: string): ProductState | null {
    const stmt = this.db.prepare(`
      SELECT product_id, sku, source, last_price_total, last_price_per_tb, 
             last_available, last_checked_at, first_seen_at
      FROM product_state WHERE product_id = ?
    `);
    
    const row = stmt.get(productId) as ProductStateRow | undefined;
    if (!row) return null;

    return {
      product_id: row.product_id,
      sku: row.sku,
      source: row.source,
      last_price_total: row.last_price_total,
      last_price_per_tb: row.last_price_per_tb,
      last_available: Boolean(row.last_available),
      last_checked_at: row.last_checked_at,
      first_seen_at: row.first_seen_at,
    };
  }

  getAllProductStates(): ProductState[] {
    const stmt = this.db.prepare(`
      SELECT product_id, sku, source, last_price_total, last_price_per_tb,
             last_available, last_checked_at, first_seen_at
      FROM product_state
    `);

    const rows = stmt.all() as ProductStateRow[];
    return rows.map(row => ({
      product_id: row.product_id,
      sku: row.sku,
      source: row.source,
      last_price_total: row.last_price_total,
      last_price_per_tb: row.last_price_per_tb,
      last_available: Boolean(row.last_available),
      last_checked_at: row.last_checked_at,
      first_seen_at: row.first_seen_at,
    }));
  }

  upsertProductState(state: ProductState): void {
    const stmt = this.db.prepare(`
      INSERT INTO product_state (product_id, sku, source, last_price_total, last_price_per_tb,
                                  last_available, last_checked_at, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        last_price_total = excluded.last_price_total,
        last_price_per_tb = excluded.last_price_per_tb,
        last_available = excluded.last_available,
        last_checked_at = excluded.last_checked_at
    `);

    stmt.run(
      state.product_id,
      state.sku,
      state.source,
      state.last_price_total,
      state.last_price_per_tb,
      state.last_available ? 1 : 0,
      state.last_checked_at,
      state.first_seen_at
    );
  }

  logAlert(productId: string, alertType: AlertType): void {
    const stmt = this.db.prepare(`
      INSERT INTO alert_log (product_id, alert_type, sent_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(productId, alertType, new Date().toISOString());
  }

  canSendAlert(productId: string, alertType: AlertType, cooldownMs: number): boolean {
    const stmt = this.db.prepare(`
      SELECT sent_at FROM alert_log 
      WHERE product_id = ? AND alert_type = ?
      ORDER BY sent_at DESC LIMIT 1
    `);

    const row = stmt.get(productId, alertType) as { sent_at: string } | undefined;
    if (!row) return true;

    const lastSent = new Date(row.sent_at).getTime();
    const now = Date.now();
    return (now - lastSent) >= cooldownMs;
  }

  close(): void {
    this.db.close();
  }
}

interface ProductStateRow {
  product_id: string;
  sku: string;
  source: string;
  last_price_total: number;
  last_price_per_tb: number;
  last_available: number;
  last_checked_at: string;
  first_seen_at: string;
}
