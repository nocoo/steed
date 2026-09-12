import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/worker/migrations");
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(directory, name), "utf8"));
  }
  const executors = new WeakMap<object, () => D1Result<Record<string, unknown>>>();
  const db = {
    prepare(sql: string) {
      let params: SQLInputValue[] = [];
      const execute = (): D1Result<Record<string, unknown>> => {
        const before = Number(sqlite.prepare("SELECT total_changes() AS count").get()?.count);
        const results = sqlite.prepare(sql).all(...params);
        const changes = Number(sqlite.prepare("SELECT total_changes() AS count").get()?.count) - before;
        return { success: true, results, meta: { changes, duration: 0, last_row_id: 0, changed_db: changes > 0, size_after: 0, rows_read: results.length, rows_written: changes } };
      };
      const statement = {
        bind(...values: SQLInputValue[]) { params = values; return statement; },
        async first(column?: string) {
          const row = execute().results[0];
          return row ? column ? row[column] : row : null;
        },
        async all() { return execute(); },
        async run() { return execute(); },
        async raw() { return execute().results.map((row) => Object.values(row)); },
      };
      executors.set(statement, execute);
      return statement;
    },
    async batch(statements: object[]) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => {
          const execute = executors.get(statement);
          if (!execute) throw new Error("Unknown statement");
          return execute();
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as D1Database;
  return { db, sqlite, close: () => sqlite.close() };
}
