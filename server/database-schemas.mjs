// Exact runtime baseline DDL. Changes require an explicit next migration version.
// Empty core migrations intentionally raise the minimum writer without rewriting user rows.
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
  { version: 2, sql: "" },
  { version: 3, sql: "" },
  { version: 4, sql: "" },
];
export const TENANT_ATTACHMENTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS sync_blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,body BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_attachments(packet_id TEXT NOT NULL REFERENCES sync_records(id),id TEXT NOT NULL,hash TEXT NOT NULL REFERENCES sync_blobs(hash),name TEXT NOT NULL,type TEXT NOT NULL,PRIMARY KEY(packet_id,id));
    CREATE INDEX IF NOT EXISTS sync_attachments_hash ON sync_attachments(hash);`,
  },
  { version: 2, sql: "" },
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
  { version: 2, sql: "" },
  { version: 3, sql: "" },
  { version: 4, sql: "" },
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
  { version: 2, sql: "" },
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
  { version: 2, sql: "" },
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
  { version: 3, sql: "" },
  { version: 4, sql: "" },
  { version: 5, sql: "" },
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
  { version: 2, sql: "" },
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
  { version: 2, sql: "" },
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
  { version: 2, sql: "" },
];

export const LEGACY_JOBS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS sync_jobs(
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES sync_devices(id), record_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL, output TEXT, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`,
  },
  { version: 2, sql: "" },
];

export const LEGACY_JOB_ARCHIVE_SCHEMA = [{version:1,sql:`
CREATE TABLE legacy_job_archive(id TEXT PRIMARY KEY,packet TEXT NOT NULL,source_state TEXT NOT NULL,target_state TEXT NOT NULL,request_hash TEXT NOT NULL,output_hash TEXT,source_hash TEXT NOT NULL,target_hash TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE legacy_job_disposals(id TEXT PRIMARY KEY REFERENCES legacy_job_archive(id),target_hash TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE legacy_source_cleanup(packet TEXT PRIMARY KEY,before_hash TEXT NOT NULL,after_hash TEXT NOT NULL,version INTEGER NOT NULL);
CREATE TRIGGER legacy_job_archive_no_update BEFORE UPDATE ON legacy_job_archive BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER legacy_job_archive_no_delete BEFORE DELETE ON legacy_job_archive BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER legacy_job_disposals_no_update BEFORE UPDATE ON legacy_job_disposals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER legacy_job_disposals_no_delete BEFORE DELETE ON legacy_job_disposals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER legacy_source_cleanup_no_update BEFORE UPDATE ON legacy_source_cleanup BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER legacy_source_cleanup_no_delete BEFORE DELETE ON legacy_source_cleanup BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
`}];

export const READING_TASKS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_tasks(id TEXT PRIMARY KEY,packet TEXT NOT NULL,device TEXT NOT NULL,
      input_revision TEXT NOT NULL,base_version INTEGER NOT NULL,generation INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',coverage TEXT NOT NULL DEFAULT '[]',calls INTEGER NOT NULL DEFAULT 0,active_ms INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_blocks(task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,
        result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_block_ranges(task TEXT NOT NULL,fingerprint TEXT NOT NULL,ranges TEXT NOT NULL,PRIMARY KEY(task,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_checkpoints(task TEXT NOT NULL,calls INTEGER NOT NULL,completed INTEGER NOT NULL,spent INTEGER NOT NULL,PRIMARY KEY(task,calls));
      CREATE TABLE IF NOT EXISTS reading_publications(task TEXT PRIMARY KEY,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_actions(operation TEXT PRIMARY KEY,task TEXT NOT NULL,action TEXT NOT NULL,generation INTEGER NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_action_audits(operation TEXT PRIMARY KEY,maintenance_operation TEXT);`,
  },
  {
    version: 2,
    sql: "CREATE INDEX IF NOT EXISTS reading_tasks_packet ON reading_tasks(packet);",
  },
  { version: 3, sql: "" },
];

export const READING_ROOTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_roots(id TEXT PRIMARY KEY,packet TEXT NOT NULL UNIQUE,reason TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS reading_root_progress(root TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(root,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_root_checkpoints(root TEXT NOT NULL,calls INTEGER NOT NULL,completed INTEGER NOT NULL,spent INTEGER NOT NULL,unknown_risk INTEGER NOT NULL,active_ms INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(root,calls));
`,
  },
];

export const LEDGER_ROOT_SAFETY_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_safe_roots(
      account TEXT NOT NULL,packet TEXT NOT NULL,root TEXT NOT NULL,PRIMARY KEY(account,packet));
      CREATE TABLE IF NOT EXISTS reading_safe_links(
      account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,root TEXT NOT NULL,PRIMARY KEY(account,task));
      CREATE TABLE IF NOT EXISTS reading_safe_events(
      seq INTEGER PRIMARY KEY,account TEXT NOT NULL,root TEXT NOT NULL,calls INTEGER NOT NULL,
      active_ms INTEGER NOT NULL,completed INTEGER NOT NULL,checkpoint_calls INTEGER NOT NULL,
      reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_safe_steps(
      id TEXT PRIMARY KEY,account TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL,generation INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_safe_drains(step TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_safe_limit_audits(
      account TEXT NOT NULL,operation TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL,actor TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,watermark INTEGER NOT NULL,generation INTEGER NOT NULL,
      previous_limit INTEGER NOT NULL,new_limit INTEGER NOT NULL CHECK(new_limit>previous_limit),
      active_ms INTEGER NOT NULL,calls INTEGER NOT NULL,request_hash TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,operation));
      CREATE INDEX IF NOT EXISTS reading_safe_root_limits ON reading_safe_limit_audits(account,root,new_limit DESC);
      CREATE INDEX IF NOT EXISTS reading_safe_pending ON reading_safe_steps(account,root,id);
      CREATE INDEX IF NOT EXISTS reading_safe_latest ON reading_safe_events(account,root,seq DESC);
CREATE TRIGGER IF NOT EXISTS reading_safe_roots_update BEFORE UPDATE ON reading_safe_roots BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_roots_delete BEFORE DELETE ON reading_safe_roots BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_links_update BEFORE UPDATE ON reading_safe_links BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_links_delete BEFORE DELETE ON reading_safe_links BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_events_update BEFORE UPDATE ON reading_safe_events BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_events_delete BEFORE DELETE ON reading_safe_events BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_steps_update BEFORE UPDATE ON reading_safe_steps BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_steps_delete BEFORE DELETE ON reading_safe_steps BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_drains_update BEFORE UPDATE ON reading_safe_drains BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_drains_delete BEFORE DELETE ON reading_safe_drains BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_limit_audits_update BEFORE UPDATE ON reading_safe_limit_audits BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS reading_safe_limit_audits_delete BEFORE DELETE ON reading_safe_limit_audits BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;`,
  },
];

export const LEDGER_PAID_PROOFS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_paid_proofs(account TEXT NOT NULL,task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,reuse_key TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account,task,fingerprint));
      CREATE TRIGGER IF NOT EXISTS reading_paid_proofs_no_update BEFORE UPDATE ON reading_paid_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAID_PROOF'); END;
      CREATE TRIGGER IF NOT EXISTS reading_paid_proofs_no_delete BEFORE DELETE ON reading_paid_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAID_PROOF'); END;`,
  },
];

export const READING_REUSE_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_reuse_keys(
      task TEXT NOT NULL,fingerprint TEXT NOT NULL,reuse_key TEXT NOT NULL,result_hash TEXT NOT NULL,
      PRIMARY KEY(task,fingerprint));
      CREATE INDEX IF NOT EXISTS reading_reuse_key ON reading_reuse_keys(reuse_key);
      CREATE TABLE IF NOT EXISTS reading_reused_blocks(
      task TEXT NOT NULL,fingerprint TEXT NOT NULL,source_task TEXT NOT NULL,source_fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,
      PRIMARY KEY(task,fingerprint));`,
  },
];

export const READING_WINDOWS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_windows(task TEXT NOT NULL,attachment TEXT NOT NULL,
      content_hash TEXT NOT NULL,next_page INTEGER NOT NULL,next_offset INTEGER NOT NULL,coverage TEXT NOT NULL,
      PRIMARY KEY(task,attachment));`,
  },
];

export const READING_CHAT_REQUESTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_chat_requests(task TEXT PRIMARY KEY,request_hash TEXT NOT NULL,body TEXT);`,
  },
];

export const LEDGER_CHAT_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_chat_intents(
      account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,request_hash TEXT NOT NULL,context_hash TEXT NOT NULL,day TEXT NOT NULL,
      PRIMARY KEY(account,task));
      CREATE TABLE IF NOT EXISTS reading_chat_proofs(call_id TEXT PRIMARY KEY,account TEXT NOT NULL,task TEXT NOT NULL,
      fingerprint TEXT NOT NULL,request_hash TEXT NOT NULL,result_hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reading_chat_proofs_task ON reading_chat_proofs(account,task,fingerprint);
      CREATE TRIGGER IF NOT EXISTS reading_chat_intents_no_update BEFORE UPDATE ON reading_chat_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_chat_intents_no_delete BEFORE DELETE ON reading_chat_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_chat_proofs_no_update BEFORE UPDATE ON reading_chat_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_PROOF'); END;
      CREATE TRIGGER IF NOT EXISTS reading_chat_proofs_no_delete BEFORE DELETE ON reading_chat_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_PROOF'); END;`,
  },
];

export const READING_VISUAL_RESULTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_visual_results(task TEXT NOT NULL,fingerprint TEXT NOT NULL,
      upstream TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));`,
  },
];

export const LEDGER_VISUAL_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_visual_inputs(account TEXT NOT NULL,task TEXT NOT NULL,
      upstream TEXT NOT NULL,packet TEXT NOT NULL,ranges_hash TEXT NOT NULL,images_hash TEXT NOT NULL,PRIMARY KEY(account,task,upstream));
      CREATE TABLE IF NOT EXISTS reading_visual_intents(account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,
      upstream TEXT NOT NULL,dependency_hash TEXT NOT NULL,claims_hash TEXT NOT NULL,chunks TEXT NOT NULL,
      PRIMARY KEY(account,task,upstream));
      CREATE TABLE IF NOT EXISTS reading_visual_proofs(account TEXT NOT NULL,task TEXT NOT NULL,fingerprint TEXT NOT NULL,
      upstream TEXT NOT NULL,call_id TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account,task,fingerprint));
CREATE TRIGGER IF NOT EXISTS reading_visual_inputs_update BEFORE UPDATE ON reading_visual_inputs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;
CREATE TRIGGER IF NOT EXISTS reading_visual_inputs_delete BEFORE DELETE ON reading_visual_inputs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;
CREATE TRIGGER IF NOT EXISTS reading_visual_intents_update BEFORE UPDATE ON reading_visual_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;
CREATE TRIGGER IF NOT EXISTS reading_visual_intents_delete BEFORE DELETE ON reading_visual_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;
CREATE TRIGGER IF NOT EXISTS reading_visual_proofs_update BEFORE UPDATE ON reading_visual_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;
CREATE TRIGGER IF NOT EXISTS reading_visual_proofs_delete BEFORE DELETE ON reading_visual_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;`,
  },
];

export const READING_MERGE_RESULTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_merge_results(task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));`,
  },
];

export const READING_ASSOCIATION_RESULTS_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_association_results(task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));`,
  },
];

export const LEDGER_MERGE_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_merge_intents(account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,dependency_hash TEXT NOT NULL,PRIMARY KEY(account,task));
      CREATE TABLE IF NOT EXISTS reading_merge_proofs(account TEXT NOT NULL,task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account,task,fingerprint));
      CREATE TRIGGER IF NOT EXISTS reading_merge_intents_no_update BEFORE UPDATE ON reading_merge_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_merge_intents_no_delete BEFORE DELETE ON reading_merge_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_merge_proofs_no_update BEFORE UPDATE ON reading_merge_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_PROOF'); END;
      CREATE TRIGGER IF NOT EXISTS reading_merge_proofs_no_delete BEFORE DELETE ON reading_merge_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_PROOF'); END;`,
  },
];

export const READING_REMAINDERS_SCHEMA = [{ version: 1, sql: `
CREATE TABLE reading_remainders(task TEXT PRIMARY KEY,parent TEXT UNIQUE NOT NULL,context TEXT NOT NULL);
` }];
export const LEDGER_REMAINDERS_SCHEMA = [{ version: 1, sql: `
CREATE TABLE reading_remaining_intents(account TEXT NOT NULL,task TEXT NOT NULL,parent TEXT NOT NULL,context_hash TEXT NOT NULL,PRIMARY KEY(account,task),UNIQUE(account,parent));
CREATE TRIGGER reading_remaining_intents_no_update BEFORE UPDATE ON reading_remaining_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REMAINDER');END;
CREATE TRIGGER reading_remaining_intents_no_delete BEFORE DELETE ON reading_remaining_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REMAINDER');END;
` }];

export const READING_REGISTRY_SCHEMA = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS reading_schema_versions(component TEXT NOT NULL,version INTEGER NOT NULL,checksum TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(component,version));
CREATE TRIGGER IF NOT EXISTS reading_schema_versions_update BEFORE UPDATE ON reading_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;
CREATE TRIGGER IF NOT EXISTS reading_schema_versions_delete BEFORE DELETE ON reading_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;`,
  },
];

export const LEGACY_LEDGER_SCHEMA = [{version:1,sql:`
CREATE TABLE reading_legacy_accounts(account TEXT PRIMARY KEY REFERENCES reading_wallets(account),source_hash TEXT NOT NULL,usage_hash TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE reading_legacy_usage(account TEXT NOT NULL REFERENCES reading_legacy_accounts(account),job TEXT NOT NULL,fingerprint TEXT NOT NULL,legacy_day TEXT NOT NULL,reserved INTEGER NOT NULL CHECK(reserved>=0),legacy_state TEXT NOT NULL,PRIMARY KEY(account,job));
CREATE TABLE reading_legacy_intakes(operation TEXT PRIMARY KEY,source_hash TEXT NOT NULL,request_hash TEXT NOT NULL,actor TEXT NOT NULL,accounts INTEGER NOT NULL,usages INTEGER NOT NULL,at INTEGER NOT NULL);
CREATE TABLE reading_legacy_work(account TEXT NOT NULL REFERENCES reading_legacy_accounts(account),task TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=1),operation TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,task,generation));
CREATE TABLE reading_legacy_settlements(account TEXT PRIMARY KEY REFERENCES reading_legacy_accounts(account),source_hash TEXT NOT NULL,evidence_hash TEXT NOT NULL,proof_id_hash TEXT UNIQUE NOT NULL,spent INTEGER NOT NULL CHECK(spent>=0),days TEXT NOT NULL,actor TEXT NOT NULL,operation TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,proof_hash TEXT NOT NULL,at INTEGER NOT NULL);
`+['reading_legacy_accounts','reading_legacy_usage','reading_legacy_intakes','reading_legacy_settlements','reading_legacy_work'].flatMap(table=>['UPDATE','DELETE'].map(action=>`CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEGACY_LEDGER');END;`)).join('')}];
