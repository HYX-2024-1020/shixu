import { sha256 } from "./material.mjs";
// Versioned component migrations run only on the independently owned ledger.
// An unknown future version or changed historical SQL never silently downgrades.
export function applyReadingMigrations(ledger, component, migrations) {
  if (
    !/^[a-z][a-z-]{1,60}$/.test(component) ||
    !Array.isArray(migrations) ||
    !migrations.length ||
    migrations.some((m, i) => m.version !== i + 1 || typeof m.sql !== "string")
  )
    throw Error("INVALID_READING_MIGRATION");
  return ledger.transaction(() => {
    const normalize = (sql) =>
      sql.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
    const definitions = [
      [
        "reading_schema_versions",
        "CREATE TABLE reading_schema_versions(component TEXT NOT NULL,version INTEGER NOT NULL,checksum TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(component,version))",
      ],
      ...["UPDATE", "DELETE"].map((action) => [
        `reading_schema_versions_${action.toLowerCase()}`,
        `CREATE TRIGGER reading_schema_versions_${action.toLowerCase()} BEFORE ${action} ON reading_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;`,
      ]),
    ];
    if (
      ledger.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='reading_schema_versions'",
        )
        .get()
    ) {
      for (const [name, sql] of definitions) {
        const stored = ledger.db
          .prepare("SELECT sql FROM sqlite_master WHERE name=?")
          .get(name);
        if (!stored || normalize(stored.sql) !== normalize(sql))
          throw Error("READING_SCHEMA_MISMATCH");
      }
    }
    ledger.db
      .exec(`CREATE TABLE IF NOT EXISTS reading_schema_versions(component TEXT NOT NULL,version INTEGER NOT NULL,checksum TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(component,version));
   CREATE TRIGGER IF NOT EXISTS reading_schema_versions_update BEFORE UPDATE ON reading_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;
   CREATE TRIGGER IF NOT EXISTS reading_schema_versions_delete BEFORE DELETE ON reading_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;`);
    const previous = ledger.db
      .prepare(
        "SELECT * FROM reading_schema_versions WHERE component=? ORDER BY version",
      )
      .all(component);
    if (
      previous.some(
        (p, i) =>
          p.version !== i + 1 ||
          !migrations[i] ||
          p.checksum !== sha256(migrations[i].sql),
      )
    )
      throw Error("READING_SCHEMA_MISMATCH");
    for (const m of migrations.slice(previous.length)) {
      ledger.db.exec(m.sql);
      ledger.db
        .prepare("INSERT INTO reading_schema_versions VALUES(?,?,?,?)")
        .run(component, m.version, sha256(m.sql), ledger.now());
    }
    return migrations.length;
  });
}
