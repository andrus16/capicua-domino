import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb, DataType } from "pg-mem";
import { newResetToken, hashResetToken } from "../src/db/passwordResets.js";

describe("reset tokens (puros)", () => {
  it("token aleatorio 64 hex y hash sha256 estable", () => {
    const a = newResetToken(), b = newResetToken();
    assert.equal(a.length, 64);
    assert.notEqual(a, b);
    assert.equal(hashResetToken(a), hashResetToken(a));
    assert.equal(hashResetToken(a).length, 64);
    assert.notEqual(hashResetToken(a), hashResetToken(b));
  });
});

describe("password_resets (pg-mem)", () => {
  let db, query, createResetToken, findValidReset, consumeResetToken;
  let userId;

  before(async () => {
    db = newDb();
    db.public.registerFunction({
      name: "char_length", args: [DataType.text], returns: DataType.integer,
      implementation: (x) => (x == null ? null : String(x).length),
    });
    // Esquema mínimo necesario (users + password_resets), compatible pg-mem.
    db.public.none(`CREATE TABLE users (
      id SERIAL PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE,
      email VARCHAR(255) UNIQUE, password_hash TEXT,
      is_guest BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    db.public.none(`CREATE TABLE password_resets (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    db.public.none(`INSERT INTO users (username, email, password_hash, is_guest)
      VALUES ('alba', 'alba@x.co', 'viejohash', FALSE) RETURNING id`);
    userId = db.public.one("SELECT id FROM users WHERE username='alba'").id;
    // Adapta el módulo a pg-mem inyectando query (vía adaptador Pool, compatible).
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    query = (text, params = []) => pool.query(text, params);
    const modPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "db", "passwordResets.js");
    let src = readFileSync(modPath, "utf8");
    src = src.replace(`import { query } from "./pool.js";`, `const query = globalThis.__testQuery;`);
    src = src.replace(`from "node:crypto"`, `from "node:crypto"`);
    const dataUrl = `data:text/javascript,${encodeURIComponent(src)}`;
    globalThis.__testQuery = query;
    const mod = await import(dataUrl);
    ({ createResetToken, findValidReset, consumeResetToken } = mod);
    delete globalThis.__testQuery;
  });

  it("crea, valida, consume una sola vez y rechaza reutilizado", async () => {
    const token = await createResetToken(userId, 60_000);
    const found = await findValidReset(token);
    assert.ok(found && found.username === "alba");
    const uid = await consumeResetToken(token, "nuevohash");
    assert.equal(uid, userId);
    assert.equal(await findValidReset(token), null); // usado: ya no vale
    await assert.rejects(consumeResetToken(token, "x"), /inválido o vencido/);
  });

  it("token inventado o corto no vale", async () => {
    assert.equal(await findValidReset("0".repeat(64)), null);
    assert.equal(await findValidReset("corto"), null);
  });

  it("expirado no vale", async () => {
    const token = await createResetToken(userId, 1); // 1 ms
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(await findValidReset(token), null);
  });

  it("nuevo token invalida el anterior", async () => {
    const t1 = await createResetToken(userId, 60_000);
    await createResetToken(userId, 60_000);
    assert.equal(await findValidReset(t1), null);
  });
});
