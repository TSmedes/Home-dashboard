import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CacheStore, StoredEntry } from "../cache/PollingCache.js";

/**
 * Node's built-in SQLite. Chosen over better-sqlite3 specifically because it
 * needs no native compilation, which is what makes the arm64 container image
 * build without a toolchain.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key        TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      provider   TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

/** Survives restarts, so the dashboard boots showing data rather than spinners. */
export class SqliteCacheStore implements CacheStore {
  readonly #read;
  readonly #write;

  constructor(db: DatabaseSync) {
    this.#read = db.prepare("SELECT data, fetched_at FROM cache WHERE key = ?");
    this.#write = db.prepare(
      `INSERT INTO cache (key, data, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
    );
  }

  read(key: string): StoredEntry | undefined {
    const row = this.#read.get(key) as { data: string; fetched_at: string } | undefined;
    if (!row) return undefined;
    try {
      return { data: JSON.parse(row.data), fetchedAt: row.fetched_at };
    } catch {
      return undefined; // A corrupt row should refetch, not crash the boot.
    }
  }

  write(key: string, entry: StoredEntry): void {
    this.#write.run(key, JSON.stringify(entry.data), entry.fetchedAt);
  }
}

/**
 * Small pieces of runtime state that must survive a restart but are not
 * settings - such as a manual night-mode override. Kept out of config.yaml so
 * a temporary switch never gets tangled up with the owner's edits.
 */
export class StateStore {
  readonly #read;
  readonly #write;
  readonly #delete;

  constructor(db: DatabaseSync) {
    this.#read = db.prepare("SELECT value FROM state WHERE key = ?");
    this.#write = db.prepare(
      "INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.#delete = db.prepare("DELETE FROM state WHERE key = ?");
  }

  get<T>(key: string): T | undefined {
    const row = this.#read.get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this.#write.run(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.#delete.run(key);
  }
}

/** OAuth refresh tokens and provider credentials. */
export class TokenStore {
  readonly #read;
  readonly #write;
  readonly #delete;

  constructor(db: DatabaseSync) {
    this.#read = db.prepare("SELECT payload FROM tokens WHERE provider = ?");
    this.#write = db.prepare(
      `INSERT INTO tokens (provider, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    );
    this.#delete = db.prepare("DELETE FROM tokens WHERE provider = ?");
  }

  get<T>(provider: string): T | undefined {
    const row = this.#read.get(provider) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as T) : undefined;
  }

  set(provider: string, payload: unknown): void {
    this.#write.run(provider, JSON.stringify(payload), new Date().toISOString());
  }

  clear(provider: string): void {
    this.#delete.run(provider);
  }

  has(provider: string): boolean {
    return this.get(provider) !== undefined;
  }
}
