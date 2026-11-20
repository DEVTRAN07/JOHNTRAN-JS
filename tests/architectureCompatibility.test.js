"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
test("legacy runtime paths point to the new application modules",()=>{
 assert.equal(require("../core/runtime/commandRegistry"),require("../src/application/commands/registry"));
 assert.equal(require("../core/runtime/dispatcher"),require("../src/application/commands/dispatcher"));
 assert.equal(require("../core/runtime/eventRegistry"),require("../src/application/events/registry"));
 assert.equal(require("../core/runtime/threadQueue"),require("../src/application/events/threadQueue"));
});
test("legacy storage paths point to the new infrastructure modules",()=>{
 assert.equal(require("../core/storage"),require("../src/infrastructure/storage"));
 assert.equal(require("../core/storage/diagnostics"),require("../src/infrastructure/storage/diagnostics"));
});
test("legacy domain paths point to the new pure group and moderation modules",()=>{
 assert.equal(require("../core/runtime/groupBotState"),require("../src/domain/groups/botState"));
 assert.equal(require("../core/runtime/antiProtection"),require("../src/domain/moderation/protectionState"));
});
