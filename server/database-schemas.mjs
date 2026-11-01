// Exact runtime baseline DDL. Changes require an explicit next migration version.
export const TENANT_SYNC_SCHEMA = [
  {
    version: 1,
    sql: `      CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_records(
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT,
        deleted_at TEXT, purged INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS sync_records_version ON sync_records(version);
      CREATE TABLE IF NOT EXISTS sync_devices(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
        expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_operations(
        device_id TEXT NOT NULL REFERENCES sync_devices(id), op_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL,
        PRIMARY KEY(device_id, op_id)
      );
`,
  },
];
export const TENANT_ATTACHMENTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS sync_blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,body BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_attachments(packet_id TEXT NOT NULL REFERENCES sync_records(id),id TEXT NOT NULL,hash TEXT NOT NULL REFERENCES sync_blobs(hash),name TEXT NOT NULL,type TEXT NOT NULL,PRIMARY KEY(packet_id,id));
    CREATE INDEX IF NOT EXISTS sync_attachments_hash ON sync_attachments(hash);`,
  },
];
export const ACCOUNTS_CORE_SCHEMA = [
  {
    version: 1,
    sql: `      CREATE TABLE IF NOT EXISTS account_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,
        invite_hash TEXT UNIQUE NOT NULL,limits TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL CHECK(kind IN ('windows','wechat')),identity TEXT NOT NULL,public_key TEXT,
        revoked INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_identity ON bindings(kind,identity) WHERE revoked=0;
      CREATE TABLE IF NOT EXISTS nonces(binding_id TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,
        PRIMARY KEY(binding_id,nonce));
      CREATE TABLE IF NOT EXISTS request_rates(key TEXT PRIMARY KEY,window INTEGER NOT NULL,n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT NOT NULL,job_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
        day TEXT NOT NULL,reserved_micros INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(user_id,job_id));`,
  },
];
export const ACCOUNTS_AUTH_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS account_credentials(user_id TEXT PRIMARY KEY REFERENCES accounts(id),username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,scheme TEXT NOT NULL DEFAULT 'scrypt:131072:8:1:64' CHECK(scheme='scrypt:131072:8:1:64'),version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS account_device_slots(binding TEXT PRIMARY KEY REFERENCES bindings(id),user_id TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL,slot INTEGER NOT NULL,name TEXT NOT NULL,last_seen INTEGER NOT NULL,CHECK((kind='windows' AND slot BETWEEN 1 AND 3) OR (kind='wechat' AND slot=1)),UNIQUE(user_id,kind,slot));
        CREATE TABLE IF NOT EXISTS account_v4_operations(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_v4_events(seq INTEGER PRIMARY KEY,operation TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,account TEXT NOT NULL,binding TEXT,at INTEGER NOT NULL);
        CREATE TRIGGER IF NOT EXISTS account_v4_events_no_update BEFORE UPDATE ON account_v4_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        CREATE TRIGGER IF NOT EXISTS account_v4_events_no_delete BEFORE DELETE ON account_v4_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        CREATE TABLE IF NOT EXISTS account_login_attempts(key TEXT NOT NULL,at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS account_login_window ON account_login_attempts(key,at);
        CREATE TABLE IF NOT EXISTS account_login_failures(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,locked_until INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS account_grant_intents(account TEXT PRIMARY KEY REFERENCES accounts(id),operation TEXT UNIQUE NOT NULL);`,
  },
];
export const TENANT_ORIGINALS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS original_submissions(id TEXT PRIMARY KEY,packet TEXT NOT NULL,fingerprint TEXT NOT NULL,manifest TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,until_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS original_files(packet TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER,cleanup INTEGER,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(packet,id));
      CREATE TABLE IF NOT EXISTS original_actions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS original_commits(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS original_file_submissions(packet TEXT NOT NULL,id TEXT NOT NULL,submission TEXT NOT NULL,PRIMARY KEY(packet,id));
      CREATE TABLE IF NOT EXISTS original_trash(packet TEXT PRIMARY KEY,cleanup INTEGER NOT NULL);`,
  },
];
export const LEDGER_CORE_SCHEMA = [
  {
    version: 1,
    sql: `      CREATE TABLE IF NOT EXISTS reading_wallets(account TEXT PRIMARY KEY,granted INTEGER NOT NULL,spent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_prices(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_calls(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES reading_wallets(account),
        task TEXT NOT NULL,block TEXT NOT NULL,generation INTEGER NOT NULL,price TEXT NOT NULL REFERENCES reading_prices(id),
        day TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','sent','settled','unknown','released')),
        reserved INTEGER NOT NULL,actual INTEGER,usage TEXT,fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_events(seq INTEGER PRIMARY KEY,operation TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,
        account TEXT NOT NULL,call TEXT,amount INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_controls(id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_envelopes(call TEXT PRIMARY KEY REFERENCES reading_calls(id),fingerprint TEXT NOT NULL,result TEXT NOT NULL,usage TEXT NOT NULL);
      INSERT OR IGNORE INTO reading_controls(id) VALUES(1);
      CREATE TRIGGER IF NOT EXISTS reading_events_no_update BEFORE UPDATE ON reading_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS reading_events_no_delete BEFORE DELETE ON reading_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS reading_prices_no_update BEFORE UPDATE ON reading_prices BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRICE'); END;
      CREATE TRIGGER IF NOT EXISTS reading_prices_no_delete BEFORE DELETE ON reading_prices BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRICE'); END;
`,
  },
  {
    version: 2,
    sql: "CREATE INDEX IF NOT EXISTS reading_calls_account_task ON reading_calls(account,task);",
  },
];
export const LEDGER_COST_SCHEMA = [
  {
    version: 1,
    sql: `      CREATE TABLE IF NOT EXISTS reading_cost_audits(seq INTEGER PRIMARY KEY,account TEXT NOT NULL,operation TEXT NOT NULL,
        root TEXT NOT NULL,task TEXT NOT NULL,call_id TEXT NOT NULL UNIQUE REFERENCES reading_calls(id),actor TEXT NOT NULL,evidence_hash TEXT NOT NULL,
        reference TEXT NOT NULL,disposition TEXT NOT NULL CHECK(disposition IN ('usage','not-billed')),request_hash TEXT NOT NULL,proof_hash TEXT NOT NULL,
        ledger_sequence INTEGER NOT NULL,watermark INTEGER NOT NULL,generation INTEGER NOT NULL,
        spent_before INTEGER NOT NULL,spent_after INTEGER NOT NULL,actual INTEGER,usage TEXT,at INTEGER NOT NULL,
        UNIQUE(account,operation));
      CREATE INDEX IF NOT EXISTS reading_cost_audits_account ON reading_cost_audits(account,seq DESC);
      CREATE INDEX IF NOT EXISTS reading_cost_audits_root ON reading_cost_audits(account,root,seq DESC);
      CREATE TRIGGER IF NOT EXISTS reading_cost_audits_no_update BEFORE UPDATE ON reading_cost_audits BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS reading_cost_audits_no_delete BEFORE DELETE ON reading_cost_audits BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
`,
  },
];
export const LEDGER_TIME_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_time_audits(
      account TEXT NOT NULL,operation TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL,actor TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,reference TEXT NOT NULL,request_hash TEXT NOT NULL,proof_hash TEXT NOT NULL,
      watermark INTEGER NOT NULL,ledger_sequence INTEGER NOT NULL,generation INTEGER NOT NULL,
      before_snapshot TEXT NOT NULL,target_snapshot TEXT NOT NULL,active_ms INTEGER NOT NULL,
      calls INTEGER NOT NULL,completed INTEGER NOT NULL,checkpoint_calls INTEGER NOT NULL,at INTEGER NOT NULL,
      PRIMARY KEY(account,operation));
      CREATE TABLE IF NOT EXISTS reading_time_finalizations(account TEXT NOT NULL,operation TEXT NOT NULL,at INTEGER NOT NULL,
      PRIMARY KEY(account,operation));
CREATE TRIGGER IF NOT EXISTS reading_time_audits_update BEFORE UPDATE ON reading_time_audits BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_time_audits_delete BEFORE DELETE ON reading_time_audits BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_time_finalizations_update BEFORE UPDATE ON reading_time_finalizations BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_time_finalizations_delete BEFORE DELETE ON reading_time_finalizations BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;`,
  },
];
export const LEDGER_CHECKPOINT_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_checkpoint_audits(
      account TEXT NOT NULL,operation TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL,
      actor TEXT NOT NULL,evidence_hash TEXT NOT NULL,reference TEXT NOT NULL,
      request_hash TEXT NOT NULL,proof_hash TEXT NOT NULL,watermark INTEGER NOT NULL,
      ledger_sequence INTEGER NOT NULL,generation INTEGER NOT NULL,before_snapshot TEXT NOT NULL,
      target_snapshot TEXT NOT NULL,calls INTEGER NOT NULL,active_ms INTEGER NOT NULL,
      completed INTEGER NOT NULL,checkpoint_calls INTEGER NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL,
      PRIMARY KEY(account,operation),UNIQUE(account,reference));
      CREATE TABLE IF NOT EXISTS reading_checkpoint_finalizations(
      account TEXT NOT NULL,operation TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,operation));
CREATE TRIGGER IF NOT EXISTS reading_checkpoint_audits_update BEFORE UPDATE ON reading_checkpoint_audits BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_checkpoint_audits_delete BEFORE DELETE ON reading_checkpoint_audits BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_checkpoint_finalizations_update BEFORE UPDATE ON reading_checkpoint_finalizations BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_checkpoint_finalizations_delete BEFORE DELETE ON reading_checkpoint_finalizations BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;`,
  },
];
