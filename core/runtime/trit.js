"use strict";

// A logical trit has exactly three states:
// -1 = unknown, 0 = false/no, 1 = true/yes.
// This is a semantic encoding; JavaScript still stores values in normal
// V8/CPU representations and does not become a physical ternary machine.
const TRIT = Object.freeze({
  UNKNOWN: -1,
  FALSE: 0,
  TRUE: 1
});

function isTrit(value) {
  return value === TRIT.UNKNOWN || value === TRIT.FALSE || value === TRIT.TRUE;
}

function fromBoolean(value) {
  return value ? TRIT.TRUE : TRIT.FALSE;
}

function isTrue(value) {
  return value === TRIT.TRUE;
}

module.exports = { TRIT, isTrit, fromBoolean, isTrue };
