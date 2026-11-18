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

const commands = {
  antinude: require("../plugins/commands/antinude"),
  antirecall: require("../plugins/commands/antirecall"),
  antilink: require("../plugins/commands/antilink"),
  antispam: require("../plugins/commands/antispam")
};

function makeContext(command, mode, options = {}) {
  const threadId = "anti-toggle-" + command;
  const userId = options.userId || "owner";
  const data = {};
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
    async setDataAndWait(id, next) {
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

test("all four moderation commands are restricted to confirmed group QTVs", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  try {
    for (const command of Object.keys(commands)) {
      const fixture = makeContext(command, "on", { userId: "ordinary-member" });
      await commands[command].run(fixture.context);
      assert.equal(Object.keys(fixture.data).length, 0);
      assert.match(fixture.messages[0].msg, /QTV BOX/i);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("all four commands persist their independent on/off settings", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  try {
    const expectedKeys = {
      antinude: "anti_nude",
      antirecall: "anti_undo",
      antilink: "anti_danger_link",
      antispam: "anti_sticker_spam"
    };

    for (const [command, key] of Object.entries(expectedKeys)) {
      const fixture = makeContext(command, "on");
      await commands[command].run(fixture.context);
      assert.equal(fixture.data[key], true, command + " should be enabled");
      assert.match(fixture.messages[0].msg, /THÔNG BÁO HỆ THỐNG/i);
      assert.deepEqual(fixture.messages[0].attachments, ["/tmp/jt-anti-feature-test.png"]);
      assert.equal(renderedCards.at(-1).type, "card");
      assert.match(renderedCards.at(-1).data.subtitle, /Đã bật thành công/);

      fixture.context.args = ["off"];
      await commands[command].run(fixture.context);
      assert.equal(fixture.data[key], false, command + " should be disabled");
      assert.match(renderedCards.at(-1).data.subtitle, /Đã tắt thành công/);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("missing group-admin metadata does not grant QTV access", async () => {
  const fixture = makeContext("antilink", "on", { groupInfo: null });
  await commands.antilink.run(fixture.context);
  assert.equal(fixture.data.anti_danger_link, undefined);
  assert.match(fixture.messages[0].msg, /QTV BOX/i);
});

test("antinude cannot be enabled without an AI API key", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousAlias = process.env.JT_ANTINUDE_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JT_ANTINUDE_OPENAI_API_KEY;

  try {
    const fixture = makeContext("antinude", "on");
    await commands.antinude.run(fixture.context);
    assert.equal(fixture.data.anti_nude, undefined);
    assert.match(fixture.messages[0].msg, /OPENAI_API_KEY/);
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
