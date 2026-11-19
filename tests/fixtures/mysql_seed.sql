-- Fixture for the env-gated live MySQL tests in src/db/mysql.rs (mod live).
--
--   mysql -h 127.0.0.1 -u root < tests/fixtures/mysql_seed.sql
--   DBV_TEST_MYSQL_URI=mysql://dbvro:ropass@127.0.0.1:3306/dbvtest \
--     cargo test --all-features mysql::live -- --ignored

DROP DATABASE IF EXISTS dbvtest;
CREATE DATABASE dbvtest;
USE dbvtest;

CREATE TABLE widgets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  price      DECIMAL(10, 2) DEFAULT 0.00,
  qty        BIGINT,
  active     BOOLEAN DEFAULT TRUE,
  payload    JSON NULL,
  blob_col   BLOB NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_name (name),
  KEY idx_qty (qty)
);

INSERT INTO widgets (name, price, qty, active, payload, blob_col) VALUES
  ('alpha', 1.50, 10, 1, '{"a":1}', UNHEX('00FF10')),
  ('beta', 2.25, NULL, 0, NULL, NULL),
  ('gamma', 99.99, 7, 1, '[1,2,3]', NULL);

-- dbv only ever reads, so a SELECT-only user is the recommended setup.
CREATE USER IF NOT EXISTS 'dbvro'@'%' IDENTIFIED BY 'ropass';
CREATE USER IF NOT EXISTS 'dbvro'@'localhost' IDENTIFIED BY 'ropass';
GRANT SELECT, SHOW VIEW ON *.* TO 'dbvro'@'%';
GRANT SELECT, SHOW VIEW ON *.* TO 'dbvro'@'localhost';
FLUSH PRIVILEGES;
