"use strict";
const CURRENCIES = new Set(["spiritStones", "sectStones"]);
function transfer(playerInput, currency, amount, direction = "debit") {
  if (!CURRENCIES.has(currency)) return { ok: false, code: "INVALID_CURRENCY" };
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false, code: "INVALID_AMOUNT" };
  const player = { ...(playerInput || {}) };
  const balance = Math.max(0, Number(player[currency]) || 0);
  if (direction === "debit") {
    if (balance < value) return { ok: false, code: "INSUFFICIENT_FUNDS", balance };
    player[currency] = balance - value;
  } else if (direction === "credit") {
    if (!Number.isSafeInteger(balance + value)) return { ok: false, code: "BALANCE_LIMIT" };
    player[currency] = balance + value;
  } else return { ok: false, code: "INVALID_DIRECTION" };
  return { ok: true, player, balance: player[currency], amount: value, currency };
}
function debit(player, currency, amount) { return transfer(player, currency, amount, "debit"); }
function credit(player, currency, amount) { return transfer(player, currency, amount, "credit"); }
module.exports = { transfer, debit, credit, CURRENCIES };
