"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function collectJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
}

test("command and event sendMessage calls use the wrapped API", () => {
  const pluginDirectories = [
    path.join(ROOT, "plugins", "commands"),
    path.join(ROOT, "plugins", "events")
  ];
  const directSend = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\?\.)?\.sendMessage\s*\(/g;
  const bypasses = [];

  for (const directory of pluginDirectories) {
    for (const file of collectJavaScriptFiles(directory)) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        directSend.lastIndex = 0;
        let match;
        while ((match = directSend.exec(line))) {
          const receiver = match[1];
          // Plugin entry points receive api through wrapApi(). A different
          // receiver may be a raw-SDK bypass and must use sendStyledRawMessage().
          if (receiver !== "api") {
            bypasses.push(`${path.relative(ROOT, file)}:${index + 1} uses ${receiver}.sendMessage()`);
          }
        }
      }
    }
  }

  assert.deepEqual(
    bypasses,
    [],
    "all plugin text sends must use the shared wrapper; raw sends must use sendStyledRawMessage()"
  );
});

test("command and event dispatch keep the shared message wrapper at their boundaries", () => {
  const commandSource = fs.readFileSync(
    path.join(ROOT, "core", "handle", "handleCommand.js"), "utf8"
  );
  const eventSource = fs.readFileSync(
    path.join(ROOT, "core", "handle", "handleEvent.js"), "utf8"
  );
  const eventContextSource = fs.readFileSync(
    path.join(ROOT, "core", "runtime", "eventContext.js"), "utf8"
  );

  assert.match(commandSource, /wrapForThread\(api,\s*threadId,\s*type/);
  assert.match(commandSource, /api:\s*wrappedApi/);
  assert.match(eventSource, /createEventContext/);
  assert.match(eventContextSource, /wrapForEvent\(api,\s*eventData/);
  assert.match(eventContextSource, /api:\s*wrapped/);
});
