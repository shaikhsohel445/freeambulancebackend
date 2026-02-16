-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  address TEXT NOT NULL,
  amount INTEGER NOT NULL,
  razorpay_order_id TEXT NOT NULL,
  razorpay_payment_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Atomic counter table
CREATE TABLE IF NOT EXISTS counter (
  id INTEGER PRIMARY KEY,
  total_orders INTEGER NOT NULL DEFAULT 0
);

-- Initialize counter
INSERT OR IGNORE INTO counter (id, total_orders) VALUES (1, 0);
