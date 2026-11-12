"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { clearRequesterProfileCache, getRequesterProfile } = require("../core/runtime/requesterProfile");

test("requester profile returns event fallback immediately and refreshes the remote profile in background", async () => {
  clearRequesterProfileCache();
  let resolveProfile;
  let calls = 0;
  const api = {
    getUserInfo() {
      calls++;
      return new Promise(resolve => { resolveProfile = resolve; });
    }
  };
  const event = {
    data: { uidFrom: "profile-test-user", dName: "Local Name" }
  };

  const started = Date.now();
  const first = await getRequesterProfile(api, event);
  assert.ok(Date.now() - started < 100, "profile lookup must not wait for the remote API");
  assert.equal(first.requesterName, "Local Name");
  assert.equal(first.requesterAvatarUrl, "");

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveProfile({
    changed_profiles: {
      "profile-test-user": {
        displayName: "Remote Name",
        avatar: "https://example.test/avatar.jpg"
      }
    }
  });
  await new Promise(resolve => setImmediate(resolve));

  const second = await getRequesterProfile(api, event);
  assert.equal(second.requesterName, "Remote Name");
  assert.equal(second.requesterAvatarUrl, "https://example.test/avatar.jpg");
  assert.equal(calls, 1);
  clearRequesterProfileCache();
});
