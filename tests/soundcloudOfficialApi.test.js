"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const soundcloud = require("../core/music/soundcloud");
const { pooledAxios } = require("../core/http/pooledAxios");
const db = require("../utils/db");

test("SoundCloud official OAuth search and AAC HLS stream resolution use URNs and token auth", async () => {
  const originalConfig = global.config;
  const originalGet = pooledAxios.get;
  const originalPost = pooledAxios.post;
  const requests = [];
  let tokenRequests = 0;

  global.config = {
    ...(originalConfig || {}),
    music: {
      ...(originalConfig?.music || {}),
      soundcloud_client_id: "soundcloud-client-id",
      soundcloud_client_secret: "soundcloud-client-secret"
    }
  };
  soundcloud._test.resetAuthCache();
  db.delData("BotStats", "name", "soundcloud_oauth_token");

  pooledAxios.post = async (url, body, options) => {
    tokenRequests++;
    assert.equal(url, "https://secure.soundcloud.com/oauth/token");
    assert.match(options.headers.Authorization, /^Basic /);
    assert.match(body, /grant_type=client_credentials/);
    return {
      status: 200,
      data: {
        access_token: "test-access-token-123456",
        refresh_token: "test-refresh-token",
        expires_in: 3600
      }
    };
  };

  pooledAxios.get = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    requests.push({ url, options });

    assert.equal(options.headers.Authorization, "OAuth test-access-token-123456");

    if (url.pathname === "/tracks") {
      assert.equal(url.searchParams.get("q"), "test track");
      assert.equal(url.searchParams.get("access"), "playable");
      assert.equal(url.searchParams.get("linked_partitioning"), "true");
      return {
        status: 200,
        data: {
          collection: [{
            id: 123,
            urn: "soundcloud:tracks:123",
            title: "Test Track",
            duration: 180000,
            user: { username: "Test Artist" },
            permalink_url: "https://soundcloud.com/test-artist/test-track",
            playback_count: 1000,
            likes_count: 20,
            access: "playable"
          }]
        }
      };
    }

    if (decodeURIComponent(url.pathname).endsWith("/streams")) {
      return {
        status: 200,
        data: {
          hls_aac_160_url: "https://api.soundcloud.com/tracks/soundcloud:tracks:123/streams/aac160",
          hls_aac_96_url: "https://api.soundcloud.com/tracks/soundcloud:tracks:123/streams/aac96"
        }
      };
    }

    if (url.pathname.endsWith("/streams/aac160")) {
      return {
        status: 302,
        headers: {
          location: "https://playback.media-streaming.soundcloud.cloud/track/aac_160k/playlist.m3u8"
        },
        data: ""
      };
    }

    if (url.pathname.endsWith("/streams/aac96")) {
      return {
        status: 302,
        headers: {
          location: "https://playback.media-streaming.soundcloud.cloud/track/aac_96k/playlist.m3u8"
        },
        data: ""
      };
    }

    throw new Error("Unexpected SoundCloud request: " + url.toString());
  };

  try {
    const tracks = await soundcloud.search("test track", 5);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].urn, "soundcloud:tracks:123");
    assert.equal(tracks[0].title, "Test Track");

    const stream = await soundcloud.resolve(tracks[0]);
    assert.equal(stream.protocol, "hls");
    assert.equal(
      stream.url,
      "https://playback.media-streaming.soundcloud.cloud/track/aac_160k/playlist.m3u8"
    );
    assert.deepEqual(stream.fallbackUrls, [
      "https://playback.media-streaming.soundcloud.cloud/track/aac_96k/playlist.m3u8"
    ]);

    assert.equal(tokenRequests, 1, "the client-credentials token is cached across search and stream lookup");
    assert.equal(requests.length, 4);
    assert.ok(requests.every(item => item.url.hostname === "api.soundcloud.com"));
  } finally {
    pooledAxios.get = originalGet;
    pooledAxios.post = originalPost;
    db.delData("BotStats", "name", "soundcloud_oauth_token");
    soundcloud._test.resetAuthCache();
    global.config = originalConfig;
  }
});

test("SoundCloud official stream candidate selection prefers AAC and keeps legacy HLS fallback", () => {
  const candidates = soundcloud._test.getOfficialTranscodingCandidates({
    hls_mp3_128_url: "https://api.soundcloud.com/old-mp3-hls",
    hls_aac_96_url: "https://api.soundcloud.com/aac-96",
    hls_aac_160_url: "https://api.soundcloud.com/aac-160",
    preview_mp3_128_url: "https://api.soundcloud.com/preview"
  });

  assert.deepEqual(candidates.map(item => item.quality), ["aac_160", "aac_96", "mp3_128"]);
  assert.equal(candidates.some(item => item.item.url.includes("preview")), false);
});
