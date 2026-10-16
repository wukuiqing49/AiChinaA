ALTER TABLE sync_runs ADD COLUMN next_statement_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN lease_owner TEXT;
ALTER TABLE sync_runs ADD COLUMN lease_updated_at TEXT;
ALTER TABLE sync_runs ADD COLUMN payload_hash TEXT;
