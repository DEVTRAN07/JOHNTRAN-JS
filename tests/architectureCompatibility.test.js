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

test("legacy game engine paths point to the v5 pure domain engines",()=>{
 assert.equal(require("../core/games/caroEngine"),require("../src/domain/games/engines/caroEngine"));
 assert.equal(require("../core/games/noituEngine"),require("../src/domain/games/engines/noituEngine"));
 assert.equal(require("../core/games/samEngine"),require("../src/domain/games/engines/samEngine"));
 assert.equal(require("../core/games/tlmnEngine"),require("../src/domain/games/engines/tlmnEngine"));
});

test("legacy game service paths point to the v5 application services",()=>{
 assert.equal(require("../core/runtime/services/games/caroService"),require("../src/application/games/services/caroService"));
 assert.equal(require("../core/runtime/services/games/ghepchuService"),require("../src/application/games/services/ghepchuService"));
 assert.equal(require("../core/runtime/services/games/noituQuickService"),require("../src/application/games/services/noituQuickService"));
 assert.equal(require("../core/runtime/services/games/noituRoomService"),require("../src/application/games/services/noituRoomService"));
 assert.equal(require("../core/runtime/services/games/noituService"),require("../src/application/games/services/noituService"));
 assert.equal(require("../core/runtime/services/games/samService"),require("../src/application/games/services/samService"));
 assert.equal(require("../core/runtime/services/games/tlmnService"),require("../src/application/games/services/tlmnService"));
});

test("legacy music paths point to the v5 application music service", () => {
  assert.equal(require("../core/music/command"), require("../src/application/media/music/command"));
  assert.equal(require("../core/music/extra"), require("../src/application/media/music/extra"));
  assert.equal(require("../core/music/ffmpegPath"), require("../src/application/media/music/ffmpegPath"));
  assert.equal(require("../core/music"), require("../src/application/media/music"));
  assert.equal(require("../core/music/models"), require("../src/application/media/music/models"));
  assert.equal(require("../core/music/soundcloud"), require("../src/application/media/music/soundcloud"));
  assert.equal(require("../core/music/ui"), require("../src/application/media/music/ui"));
});

test("legacy Anti toggle path points to the v5 application moderation service", () => {
  assert.equal(require("../core/runtime/antiToggle"), require("../src/application/moderation/antiToggle"));
});

test("legacy requester greeting path points to the v5 user domain policy", () => {
  assert.equal(require("../core/runtime/requesterGreeting"), require("../src/domain/users/requesterGreeting"));
});
