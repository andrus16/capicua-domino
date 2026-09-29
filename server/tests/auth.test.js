import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, comparePassword } from "../src/auth/password.js";
import { signToken, verifyToken } from "../src/auth/jwt.js";
import { validateUsername, validateEmail, validatePassword } from "../src/auth/validators.js";
import { guestUsername } from "../src/db/users.js";

describe("validators", () => {
  it("username: 3-32, alfanumérico + _-", () => {
    assert.equal(validateUsername("al"), "El usuario debe tener 3-32 caracteres");
    assert.equal(validateUsername("a".repeat(33)), "El usuario debe tener 3-32 caracteres");
    assert.equal(validateUsername("con espacios"), "Solo letras, números, _ y -");
    assert.equal(validateUsername("alba_99"), null);
  });

  it("email y password", () => {
    assert.equal(validateEmail("no-es-email"), "Email inválido");
    assert.equal(validateEmail("a@b.co"), null);
    assert.equal(validatePassword("12345"), "La contraseña debe tener 6+ caracteres");
    assert.equal(validatePassword("secreta1"), null);
  });
});

describe("password (bcryptjs)", () => {
  it("hash verifica y rechaza otra clave", async () => {
    const h = await hashPassword("demo1234");
    assert.equal(await comparePassword("demo1234", h), true);
    assert.equal(await comparePassword("otra", h), false);
  });
});

describe("jwt", () => {
  it("firma y verifica sub/username/guest", () => {
    const t = signToken({ id: 7, username: "alba", is_guest: false });
    const p = verifyToken(t);
    assert.equal(p.sub, 7);
    assert.equal(p.username, "alba");
    assert.equal(p.guest, false);
  });

  it("rechaza token manipulado", () => {
    const t = signToken({ id: 1, username: "x", is_guest: false });
    assert.throws(() => verifyToken(t + "tampered"));
  });
});

describe("guestUsername", () => {
  it("genera prefijo invitado_ único", () => {
    const a = guestUsername(), b = guestUsername();
    assert.ok(a.startsWith("invitado_"));
    assert.ok(b.startsWith("invitado_"));
  });
});
