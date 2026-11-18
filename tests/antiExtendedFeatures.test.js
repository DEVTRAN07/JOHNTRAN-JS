"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const anti = require("../plugins/commands/anti");
const { FEATURES } = require("../core/runtime/antiToggle");

test("Zalo message classifiers distinguish the supported media families", () => {
  const kind = anti._test.getMessageKind;
  assert.equal(kind({msgType:"chat.recommended",content:{action:"recommended.user"}}), "card");
  assert.equal(kind({msgType:"chat.doodle"}), "doodle");
  assert.equal(kind({msgType:"share.file"}), "file");
  assert.equal(kind({msgType:"chat.gif"}), "gif");
  assert.equal(kind({msgType:"chat.photo"}), "photo");
  assert.equal(kind({msgType:"chat.video.msg"}), "video");
  assert.equal(kind({msgType:"chat.voice"}), "voice");
  assert.equal(kind({msgType:"chat.sticker"}), "sticker");
  assert.equal(kind({msgType:"chat.location"}), "location");
});

test("QR moderation requires an explicit QR marker and never guesses from a normal image", () => {
  const kind = anti._test.getMessageKind;
  assert.equal(kind({msgType:"chat.photo",content:{href:"https://cdn.example/photo.jpg"}}), "photo");
  assert.equal(kind({msgType:"chat.qr"}), "qr");
  assert.equal(kind({msgType:"chat.photo",content:{qrCode:true,href:"https://cdn.example/qr.png"}}), "qr");
});

test("Anti-Word normalizes Vietnamese and checks the configured word list", () => {
  const find = anti._test.findAntiBadWord;
  assert.ok(find({msgType:"webchat",content:"Địt mẹ"}));
  assert.ok(find({msgType:"webchat",content:"lừa đảo"}));
  assert.equal(find({msgType:"webchat",content:"mình đi học"}), null);
});

test("Anti-Tag-Hide only flags explicit hidden or malformed mentions", () => {
  const hidden = anti._test.hasHiddenMention;
  assert.equal(hidden({content:"xin chào",mentions:[]}), false);
  assert.equal(hidden({content:"xin chào",mentions:[{uid:"u1",hidden:true,pos:0,len:0}]}), true);
  assert.equal(hidden({content:"@An ơi",mentions:[{uid:"u1",pos:0,len:3}]}), false);
});

test("Anti-Other is narrow and does not classify ordinary messages as bugs", () => {
  const malformed = anti._test.isMalformedAntiPayload;
  assert.equal(malformed({msgType:"webchat",content:"hello"}), false);
  assert.equal(malformed({msgType:"unknown.message",content:{}}), true);
  assert.equal(malformed({msgType:"chat.text",content:{error:true}}), true);
});

test("every requested command is registered and shared toggles are explicit", () => {
  const requested = [
    "anticard","antidoodle","antifile","antigif","antiinvite","antijoin","antilink",
    "antilocation","antiother","antiphoto","antiqr","antireaction","antisex","antispam",
    "antistk","antistklag","antitaghide","antivideo","antivoice","antiword","antirecall"
  ];
  for (const name of requested) assert.ok(FEATURES[name], name + " must have a toggle specification");
  assert.deepEqual(FEATURES.antilink.flags, ["anti_danger_link","anti_link"]);
  assert.deepEqual(FEATURES.antispam.flags, ["anti_spam","anti_sticker_spam"]);
  assert.equal(FEATURES.antisex.key, FEATURES.antinude.key);
  assert.equal(FEATURES.antiinvite.key, FEATURES.antilink.key);
});
