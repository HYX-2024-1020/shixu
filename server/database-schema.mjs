import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Normalize layout only. SQL string/identifier literals and comments keep their bytes.
export function normalizeDatabaseSql(sql) {
  let out = "",
    quote = null,
    gap = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) {
        if (quote !== "]" && sql[i + 1] === quote) out += sql[++i];
        else quote = null;
      }
      continue;
    }
    if (/[ \t\r\n\f]/.test(c)) {
      gap = true;
      continue;
    }
    if (gap && out) out += " ";
    gap = false;
    if (
      (c === "-" && sql[i + 1] === "-") ||
      (c === "/" && sql[i + 1] === "*")
    ) {
      const line = c === "-",
        end = sql.indexOf(line ? "\n" : "*/", i + 2),
        stop = end < 0 ? sql.length : end + (line ? 1 : 2);
      out += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    out += c;
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "[") quote = "]";
  }
  return out.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, "").replace(/;$/, "");
}
const normalize = normalizeDatabaseSql;
const writers = new WeakMap();
const REGISTRY_SQL = `CREATE TABLE service_schema_versions(component TEXT NOT NULL,version INTEGER NOT NULL,checksum TEXT NOT NULL,adopted INTEGER NOT NULL CHECK(adopted IN (0,1)),at INTEGER NOT NULL,PRIMARY KEY(component,version));
CREATE TRIGGER service_schema_versions_no_update BEFORE UPDATE ON service_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;
CREATE TRIGGER service_schema_versions_no_delete BEFORE DELETE ON service_schema_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCHEMA_VERSION');END;`;
function objects(db) {
  return db
    .prepare(
      "SELECT name,type,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
    )
    .all();
}
function compile(component, migrations, compatibleObjects) {
  if (
    !/^[a-z][a-z-]{1,60}$/.test(component) ||
    !Array.isArray(migrations) ||
    !migrations.length ||
    migrations.some(
      (m, i) => m.version !== i + 1 || typeof m.sql !== "string",
    ) ||
    !Array.isArray(compatibleObjects)
  )
    throw Error("INVALID_DATABASE_MIGRATION");
  const expected = new DatabaseSync(":memory:"),
    stages = [];
  let previousGuards = [];
  try {
    for (const migration of migrations) {
      for (const name of previousGuards) expected.exec("DROP TRIGGER " + name);
      expected.exec(migration.sql);
      const baseline = objects(expected),
        tables = baseline.filter((o) => o.type === "table").map((o) => o.name);
      if (tables.some((t) => !/^\w+$/.test(t)))
        throw Error("INVALID_DATABASE_MIGRATION");
      const guardSql = tables
        .flatMap((table) =>
          ["INSERT", "UPDATE", "DELETE"].map((action) => {
            const name =
              "service_guard_" +
              component.replaceAll("-", "_") +
              "_" +
              table +
              "_" +
              action.toLowerCase();
            return `CREATE TRIGGER ${name} BEFORE ${action} ON ${table} WHEN service_schema_writer('${component}')<${migration.version} BEGIN SELECT RAISE(ABORT,'INCOMPATIBLE_SCHEMA_WRITER');END;`;
          }),
        )
        .join("\n");
      expected.exec(guardSql);
      previousGuards = objects(expected)
        .filter(
          (o) => o.type === "trigger" && o.name.startsWith("service_guard_"),
        )
        .map((o) => o.name);
      stages.push({
        version: migration.version,
        sql: migration.sql,
        baseline,
        objects: objects(expected),
        tables,
        guardSql,
        guards: [...previousGuards],
        checksum: hash([
          component,
          migration.version,
          migration.sql,
          guardSql,
          compatibleObjects,
        ]),
      });
    }
    const compatible = new DatabaseSync(":memory:");
    try {
      // Optional legacy objects (e.g. the old single-device index) are checked,
      // never recreated after a later component intentionally removed them.
      for (const o of stages[0].baseline.filter((o) => o.type === "table"))
        compatible.exec(o.sql);
      for (const sql of compatibleObjects) compatible.exec(sql);
      const optional = objects(compatible).filter(
        (o) => !stages[0].tables.includes(o.name),
      );
      return { stages, optional };
    } finally {
      compatible.close();
    }
  } finally {
    expected.close();
  }
}
function matches(actual, expected) {
  return (
    actual &&
    actual.type === expected.type &&
    normalize(actual.sql) === normalize(expected.sql)
  );
}
function assertObjects(db, required, { optional = [], tables = [] } = {}) {
  const present = objects(db),
    byName = new Map(present.map((o) => [o.name, o]));
  for (const expected of required)
    if (!matches(byName.get(expected.name), expected))
      throw Object.assign(Error("DATABASE_SCHEMA_MISMATCH"), {
        schemaObject: expected.name,
        issue: "definition",
      });
  const allowed = new Set(required.map((o) => o.name));
  for (const expected of optional) {
    allowed.add(expected.name);
    if (
      byName.has(expected.name) &&
      !matches(byName.get(expected.name), expected)
    )
      throw Error("DATABASE_SCHEMA_MISMATCH");
  }
  for (const row of present)
    if (tables.includes(row.tbl_name) && !allowed.has(row.name))
      throw Object.assign(Error("DATABASE_SCHEMA_MISMATCH"), {
        schemaObject: row.name,
        issue: "unexpected",
      });
}
function registryObjects() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(REGISTRY_SQL);
    return objects(db);
  } finally {
    db.close();
  }
}
function inspect(db, component, compiled) {
  const hasRegistry = !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'")
    .get();
  if (hasRegistry)
    assertObjects(db, registryObjects(), {
      tables: ["service_schema_versions"],
    });
  const history = hasRegistry
    ? db
        .prepare(
          "SELECT version,checksum,adopted FROM service_schema_versions WHERE component=? ORDER BY version",
        )
        .all(component)
    : [];
  if (
    history.some(
      (row, i) =>
        row.version !== i + 1 ||
        !compiled.stages[i] ||
        row.checksum !== compiled.stages[i].checksum,
    )
  )
    throw Error("DATABASE_SCHEMA_MISMATCH");
  let action,
    currentVersion = history.length;
  if (currentVersion) {
    const stage = compiled.stages[currentVersion - 1];
    assertObjects(db, stage.objects, {
      optional: compiled.optional,
      tables: stage.tables,
    });
    action = currentVersion === compiled.stages.length ? "current" : "migrate";
  } else {
    const baseline = compiled.stages[0].baseline,
      present = objects(db),
      names = new Set(baseline.map((o) => o.name)),
      found = present.filter((o) => names.has(o.name));
    if (found.length) {
      assertObjects(db, baseline, {
        optional: compiled.optional,
        tables: compiled.stages[0].tables,
      });
      action = "adopt";
    } else action = "create";
  }
  if (action !== "create")
    for (const table of compiled.stages[Math.max(0, currentVersion - 1)]
      .tables) {
      try {
        if (db.prepare("PRAGMA foreign_key_check(" + table + ")").get())
          throw Error("FOREIGN_KEY_VIOLATION");
      } catch {
        throw Object.assign(Error("DATABASE_STATE_RECONCILIATION"), {
          schemaObject: table,
        });
      }
    }
  const relevant = objects(db).filter(
    (o) =>
      compiled.stages.at(-1).tables.includes(o.tbl_name) ||
      o.name === "service_schema_versions" ||
      o.tbl_name === "service_schema_versions",
  );
  const review = {
    component,
    currentVersion,
    targetVersion: compiled.stages.length,
    action,
    schemaHash: hash(relevant),
    historyHash: hash(history),
    migrationsHash: hash(compiled.stages.map((s) => s.checksum)),
  };
  return { ...review, planHash: hash(review) };
}
export function reviewDatabaseSchema(
  db,
  component,
  migrations,
  { compatibleObjects = [] } = {},
) {
  return inspect(
    db,
    component,
    compile(component, migrations, compatibleObjects),
  );
}
export function ensureDatabaseSchema(
  db,
  component,
  migrations,
  { compatibleObjects = [], expectedPlanHash, now = Date.now, afterStep } = {},
) {
  const compiled = compile(component, migrations, compatibleObjects);
  let supported = writers.get(db);
  if (!supported) {
    supported = new Map();
    db.function("service_schema_writer", (name) => supported.get(name) || 0);
    writers.set(db, supported);
  }
  const previousSupport = supported.get(component);
  const nested = db.isTransaction,
    open = nested ? "SAVEPOINT service_schema_migration" : "BEGIN IMMEDIATE",
    finish = nested ? "RELEASE service_schema_migration" : "COMMIT";
  db.exec(open);
  try {
    const review = inspect(db, component, compiled);
    if (expectedPlanHash !== undefined && expectedPlanHash !== review.planHash)
      throw Error("STALE_SCHEMA_REVIEW");
    supported.set(component, migrations.length);
    if (review.action === "current") {
      db.exec(finish);
      return review;
    }
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
        )
        .get()
    )
      db.exec(REGISTRY_SQL);
    for (const stage of compiled.stages.slice(review.currentVersion)) {
      const adopt = review.action === "adopt" && stage.version === 1;
      if (stage.version > 1)
        for (const name of compiled.stages[stage.version - 2].guards)
          db.exec("DROP TRIGGER " + name);
      if (!adopt) db.exec(stage.sql);
      db.exec(stage.guardSql);
      assertObjects(db, stage.objects, {
        optional: compiled.optional,
        tables: stage.tables,
      });
      db.prepare("INSERT INTO service_schema_versions VALUES(?,?,?,?,?)").run(
        component,
        stage.version,
        stage.checksum,
        adopt ? 1 : 0,
        now(),
      );
      afterStep?.(stage.version);
    }
    const final = inspect(db, component, compiled);
    db.exec(finish);
    return final;
  } catch (error) {
    if (previousSupport === undefined) supported.delete(component);
    else supported.set(component, previousSupport);
    if (nested)
      db.exec(
        "ROLLBACK TO service_schema_migration; RELEASE service_schema_migration",
      );
    else db.exec("ROLLBACK");
    throw error;
  }
}
