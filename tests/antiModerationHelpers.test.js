"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const anti = require("../plugins/commands/anti");

test("antilink recognizes Zalo group invitation URLs", () => {
  assert.equal(anti._test.isGroupInviteUrl("https://zalo.me/g/AbCd_123"), true);
  assert.equal(anti._test.isGroupInviteUrl("https://facebook.com/groups/example"), false);
  assert.equal(anti._test.isGroupInviteUrl("not-a-url"), false);
});

test("antilink delegates unsafe URL decisions to Zalo scanURL", async () => {
  assert.equal(await anti._test.isUnsafeLink("https://zalo.me/g/test", {}), true);
  assert.equal(await anti._test.isUnsafeLink("https://example.com", {
    async scanURL() { return { isSafe: false }; }
  }), true);
  assert.equal(await anti._test.isUnsafeLink("https://example.com", {
    async scanURL() { return { isSafe: true }; }
  }), false);
});

test("antinude requires a high sexual image score to trigger enforcement", () => {
  assert.equal(anti._test.isExplicitAdultImage({ category_scores: { sexual: 0.9 } }, 0.9), true);
  assert.equal(anti._test.isExplicitAdultImage({ category_scores: { sexual: 0.89 } }, 0.9), false);
  assert.equal(anti._test.isExplicitAdultImage({ category_scores: { violence: 0.99 } }, 0.9), false);
  assert.equal(anti._test.isExplicitAdultImage({
    category_scores: { sexual: 0.99 },
    category_applied_input_types: { sexual: ["text"] }
  }, 0.9), false);
});
