"use strict";

// Zalo can deliver message content as a structured object (for example,
// attachment metadata) rather than plain text. Never coerce arbitrary objects
// with String(): SDK payload objects may have a null prototype and throw
// "Cannot convert object to primitive value".
const TEXT_FIELDS = ["title", "text", "content", "caption"];

function safePrimitiveString(value) {
  switch (typeof value) {
    case "string":
      return value.trim();
    case "number":
      return Number.isFinite(value) ? String(value) : "";
    case "bigint":
    case "boolean":
      return String(value);
    default:
      // SDK model objects (including null-prototype objects) are not IDs.
      // Never invoke arbitrary toString/valueOf/Symbol.toPrimitive hooks.
      return "";
  }
}

function extractPlainText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (!value || typeof value !== "object") return "";

  for (const field of TEXT_FIELDS) {
    let candidate;
    try {
      candidate = value[field];
    } catch {
      continue;
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

module.exports = { extractPlainText, safePrimitiveString };
