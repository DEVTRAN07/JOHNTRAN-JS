"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const workerRender = require("../core/canvas/workerRender");

const originalRenderCanvas = workerRender.renderCanvas;
const renderedCards = [];
workerRender.renderCanvas = async (type, data) => {
  renderedCards.push({ type, data });
  return "/tmp/jt-anti-feature-test.png";
};

const commandNames = [
  "anticard", "antidoodle", "antifile", "antigif", "antiinvite", "antijoin",
  "antilink", "antilocation", "antiother", "antiphoto", "antiqr", "antireaction",
  "antisex", "antispam", "antistk", "antistklag", "antitaghide", "antivideo",
  "antivoice", "antiword", "antirecall", "antinude"
];

const expectedKeys = {
  anticard: "anti_card",
  antidoodle: "anti_doodle",
  antifile: "anti_file",
  antigif: "anti_gif",
  antiinvite: "anti_danger_link",
  antijoin: "anti_join",
  antilink: "anti_link",
  antilocation: "anti_location",
  antiother: "anti_other",
  antiphoto: "anti_photo",
  antiqr: "anti_qr",
  antireaction: "anti_reaction",
  antisex: "anti_nude",
  antispam: "anti_spam",
  antistk: "anti_sticker",
  antistklag: "anti_sticker_spam",
  antitaghide: "anti_taghide",
  antivideo: "anti_video",
  antivoice: "anti_voice",
  antiword: "anti_word",
  antirecall: "anti_undo",
  antinude: "anti_nude"
};

const commands = Object.fromEntries(commandNames.map(name => [
  name,
  require("../plugins/commands/" + name)
]));

function makeContext(commandName, mode, options = {}) {
  const threadId = "anti-toggle-" + commandName;
  const userId = options.userId || "owner";
  const data = { ...(options.initial || {}) };
  const messages = [];
  const groupInfo = options.groupInfo === undefined
    ? { creatorId: "owner", adminIds: ["moderator"] }
    : options.groupInfo;

  const api = {
    async getGroupInfo() {
      return { gridInfoMap: { [threadId]: groupInfo } };
    },
    async sendMessage(payload) {
      messages.push(payload);
      return true;
    }
  };

  const Threads = {
    async getData() { return { data: { ...data } }; },
    async setDataAndWait(_id, next) {
      Object.assign(data, next);
    }
  };

  return {
    context: {
      api,
      event: { threadId, type: 1, data: { uidFrom: userId } },
      args: mode ? [mode] : [],
      Threads
    },
    data,
    messages
  };
}

test("every Anti command from the requested list is registered with its own name", () => {
  for (const name of commandNames) {
    assert.equal(commands[name].config.name, name, name + " must be registered");
    assert.equal(commands[name].config.category, "Anti", name + " must be in Anti category");
    assert.equal(typeof commands[name].run, "function", name + " must expose run()");
  }
});

test("all Anti commands enable/disable their own group setting and send Canvas notices", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  try {
    for (const [name, key] of Object.entries(expectedKeys)) {
      const fixture = makeContext(name, "on");
      const renderedBefore = renderedCards.length;
      await commands[name].run(fixture.context);

      assert.equal(fixture.data[key], true, name + " should enable " + key);
      assert.equal(fixture.messages.length, 1, name + " should send one confirmation");
      assert.match(fixture.messages[0].msg, /THÔNG BÁO HỆ THỐNG/i);
      assert.deepEqual(fixture.messages[0].attachments, ["/tmp/jt-anti-feature-test.png"]);
      assert.equal(fixture.messages[0].ttlKind, "card");
      assert.equal(renderedCards.length, renderedBefore + 1);
      assert.equal(renderedCards.at(-1).type, "card");
      assert.match(renderedCards.at(-1).data.title, /THÔNG BÁO HỆ THỐNG/i);
      assert.match(renderedCards.at(-1).data.subtitle, /Đã bật thành công/i);

      fixture.context.args = ["off"];
      await commands[name].run(fixture.context);
      assert.equal(fixture.data[key], false, name + " should disable " + key);
      assert.match(renderedCards.at(-1).data.subtitle, /Đã tắt thành công/i);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("Anti-Link and Anti-Invite are separate controls", async () => {
  const invite = makeContext("antiinvite", "on");
  await commands.antiinvite.run(invite.context);
  assert.equal(invite.data.anti_danger_link, true);
  assert.equal(invite.data.anti_link, undefined);

  const link = makeContext("antilink", "on");
  await commands.antilink.run(link.context);
  assert.equal(link.data.anti_link, true);
  assert.equal(link.data.anti_danger_link, undefined);
});

test("Anti-Spam text and Anti-Sticker-Lag are separate controls", async () => {
  const textSpam = makeContext("antispam", "on");
  await commands.antispam.run(textSpam.context);
  assert.equal(textSpam.data.anti_spam, true);
  assert.equal(textSpam.data.anti_sticker_spam, undefined);

  const stickerSpam = makeContext("antistklag", "on");
  await commands.antistklag.run(stickerSpam.context);
  assert.equal(stickerSpam.data.anti_sticker_spam, true);
  assert.equal(stickerSpam.data.anti_spam, undefined);
});

test("all Anti commands reject members who are not confirmed group QTVs", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  try {
    for (const name of commandNames) {
      const fixture = makeContext(name, "on", { userId: "ordinary-member" });
      await commands[name].run(fixture.context);
      assert.deepEqual(fixture.data, {}, name + " must not change settings for a non-QTV");
      assert.match(fixture.messages[0].msg, /QTV BOX/i);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("missing group-admin metadata does not grant QTV access", async () => {
  const fixture = makeContext("antilink", "on", { groupInfo: null });
  await commands.antilink.run(fixture.context);
  assert.deepEqual(fixture.data, {});
  assert.match(fixture.messages[0].msg, /QTV BOX/i);
});

test("Anti-Sex and legacy Anti-Nude require an OpenAI API key", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousAlias = process.env.JT_ANTINUDE_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JT_ANTINUDE_OPENAI_API_KEY;

  try {
    for (const name of ["antisex", "antinude"]) {
      const fixture = makeContext(name, "on");
      await commands[name].run(fixture.context);
      assert.deepEqual(fixture.data, {}, name + " must not enable without an AI API key");
      assert.match(fixture.messages[0].msg, /OPENAI_API_KEY/i);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousAlias === undefined) delete process.env.JT_ANTINUDE_OPENAI_API_KEY;
    else process.env.JT_ANTINUDE_OPENAI_API_KEY = previousAlias;
  }
});

test.after(() => {
  workerRender.renderCanvas = originalRenderCanvas;
});
