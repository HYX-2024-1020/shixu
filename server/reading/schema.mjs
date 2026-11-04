import {
  normalizeDatabaseSql,
  ensureDatabaseSchema,
  reviewDatabaseSchema,
} from "../database-schema.mjs";
import { READING_REGISTRY_SCHEMA } from "../database-schemas.mjs";
import { sha256 } from "./material.mjs";
import { DatabaseSync } from "node:sqlite";

// Derive the expected SQLite DDL with SQLite itself, rather than silently
// recreating a removed append-only trigger in an already versioned component.
export function assertReadingSchema(ledger, sql) {
  const expected = new DatabaseSync(":memory:");
  try {
    expected.exec(sql);
    const normalize = normalizeDatabaseSql;
    for (const row of expected
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()) {
      const actual = ledger.db
        .prepare("SELECT type,sql FROM sqlite_master WHERE name=?")
        .get(row.name);
      if (
        !actual ||
        actual.type !== row.type ||
        normalize(actual.sql) !== normalize(row.sql)
      )
        throw Error("READING_SCHEMA_MISMATCH");
    }
  } finally {
    expected.close();
  }
}
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
  try {
    ensureDatabaseSchema(
      ledger.db,
      "ledger-reading-registry",
      READING_REGISTRY_SCHEMA,
      { now: ledger.now },
    );
    return ledger.transaction(() => {
      const previous = ledger.db
        .prepare(
          "SELECT * FROM reading_schema_versions WHERE component=? ORDER BY version",
        )
        .all(component);
      if (
        previous.some(
          (row, i) =>
            row.version !== i + 1 ||
            !migrations[i] ||
            row.checksum !== sha256(migrations[i].sql),
        )
      )
        throw Error("READING_SCHEMA_MISMATCH");
      const name = "reading-" + component,
        review = reviewDatabaseSchema(ledger.db, name, migrations);
      if (
        (review.currentVersion > 0 &&
          review.currentVersion !== previous.length) ||
        (!review.currentVersion &&
          previous.length > 0 &&
          (previous.length !== 1 || review.action !== "adopt")) ||
        (!previous.length && review.action !== "create")
      )
        throw Error("READING_SCHEMA_MISMATCH");
      ensureDatabaseSchema(ledger.db, name, migrations, {
        now: ledger.now,
        afterStep: (version) => {
          if (version > previous.length)
            ledger.db
              .prepare("INSERT INTO reading_schema_versions VALUES(?,?,?,?)")
              .run(
                component,
                version,
                sha256(migrations[version - 1].sql),
                ledger.now(),
              );
        },
      });
      const final = ledger.db
        .prepare(
          "SELECT * FROM reading_schema_versions WHERE component=? ORDER BY version",
        )
        .all(component);
      if (
        final.length !== migrations.length ||
        final.some(
          (row, i) =>
            row.version !== i + 1 || row.checksum !== sha256(migrations[i].sql),
        )
      )
        throw Error("READING_SCHEMA_MISMATCH");
      return migrations.length;
    });
  } catch (error) {
    if (
      ["DATABASE_SCHEMA_MISMATCH", "DATABASE_STATE_RECONCILIATION"].includes(
        error.message,
      )
    )
      throw Object.assign(Error("READING_SCHEMA_MISMATCH"), {
        schemaObject: error.schemaObject,
      });
    throw error;
  }
}
