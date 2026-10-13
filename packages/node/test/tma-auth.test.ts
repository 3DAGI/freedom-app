/**
 * Tests der initData-Verifikation (tma-auth.ts).
 *
 * Sicherheitskritisch: Wer hier blind vertraut, gibt die Nutzer-Identität
 * aus der Hand. Der Testvektor stammt aus der Telegram-Doku — ein initData,
 * dessen Signatur mit einem bekannten Bot-Token gültig ist, plus
 * Negativfälle (falscher Token, manipulierte User-ID, alter auth_date).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { pruefeInitData, initDataAusHeader } from "../src/tma-auth.js";

// Telegram-Doku-Beispiel (verifizierter Vektor, Bot-Token fiktiv).
const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

function baueInitData(felder: Record<string, string>, token = BOT_TOKEN): string {
  const params = new URLSearchParams(felder);
  const paare: string[] = [];
  for (const [k, v] of params.entries()) if (k !== "hash") paare.push(`${k}=${v}`);
  paare.sort();
  const checkString = paare.join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const AUTH_DATE = 1_700_000_000;

test("gültige Signatur wird akzeptiert", () => {
  const raw = baueInitData({
    user: JSON.stringify({ id: 12345, first_name: "Max", username: "maxm" }),
    auth_date: String(AUTH_DATE),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
  });
  const r = pruefeInitData(raw, BOT_TOKEN, AUTH_DATE + 60);
  assert.equal(r.ok, true);
  assert.equal(r.data?.userId, 12345);
  assert.equal(r.data?.username, "maxm");
});

test("falscher Bot-Token → signatur-Fehler", () => {
  const raw = baueInitData({ user: JSON.stringify({ id: 1 }), auth_date: String(AUTH_DATE) });
  const r = pruefeInitData(raw, "999999:FALSCH", AUTH_DATE);
  assert.equal(r.ok, false);
  assert.equal(r.grund, "signatur");
});

test("manipulierte User-ID → signatur-Fehler (kein Blind-Vertrauen)", () => {
  const raw = baueInitData({ user: JSON.stringify({ id: 111 }), auth_date: String(AUTH_DATE) });
  // Angreifer dreht die ID auf 999 — der Hash passt dann nicht mehr.
  const raw2 = raw.replace("id%22%3A111", "id%22%3A999").replace("id\":111", "id\":999");
  const r = pruefeInitData(raw2, BOT_TOKEN, AUTH_DATE);
  assert.equal(r.ok, false);
  assert.equal(r.grund, "signatur");
});

test("fehlender hash", () => {
  const r = pruefeInitData("user=%7B%22id%22%3A1%7D&auth_date=1", BOT_TOKEN, 1);
  assert.equal(r.ok, false);
  assert.equal(r.grund, "kein hash");
});

test("leerer String", () => {
  const r = pruefeInitData("", BOT_TOKEN);
  assert.equal(r.ok, false);
  assert.equal(r.grund, "leer");
});

test("veralteter auth_date (> 24 h) wird abgelehnt", () => {
  const raw = baueInitData({ user: JSON.stringify({ id: 7 }), auth_date: String(AUTH_DATE) });
  const r = pruefeInitData(raw, BOT_TOKEN, AUTH_DATE + 25 * 3600);
  assert.equal(r.ok, false);
  assert.equal(r.grund, "auth_date");
});

test("auth_date in der Zukunft (> 24 h) wird abgelehnt", () => {
  const raw = baueInitData({ user: JSON.stringify({ id: 7 }), auth_date: String(AUTH_DATE) });
  const r = pruefeInitData(raw, BOT_TOKEN, AUTH_DATE - 25 * 3600);
  assert.equal(r.ok, false);
  assert.equal(r.grund, "auth_date");
});

test("start_param wird durchgereicht", () => {
  const raw = baueInitData({
    user: JSON.stringify({ id: 3 }), auth_date: String(AUTH_DATE), start_param: "ki-basis",
  });
  const r = pruefeInitData(raw, BOT_TOKEN, AUTH_DATE);
  assert.equal(r.ok, true);
  assert.equal(r.data?.startParam, "ki-basis");
});

test("Header parsen", () => {
  assert.equal(initDataAusHeader("tma user=1&hash=abc"), "user=1&hash=abc");
  assert.equal(initDataAusHeader("TMA x=1"), "x=1");
  assert.equal(initDataAusHeader(undefined), undefined);
  assert.equal(initDataAusHeader("Bearer xxx"), undefined);
});
