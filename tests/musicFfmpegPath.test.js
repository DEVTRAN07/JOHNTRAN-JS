const assert = require("assert");
const { resolveFfmpegPath } = require("../core/music/ffmpegPath");

function main() {
  const available = new Set(["/usr/bin/ffmpeg", "/opt/custom/ffmpeg", "/app/node_modules/ffmpeg-static/ffmpeg"]);
  const isExecutableFile = (candidate) => available.has(candidate);

  assert.strictEqual(
    resolveFfmpegPath({
      envPath: "/opt/custom/ffmpeg",
      systemPaths: ["/usr/bin/ffmpeg"],
      staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
      isExecutableFile
    }),
    "/opt/custom/ffmpeg",
    "explicit FFMPEG_PATH should have highest priority"
  );

  assert.strictEqual(
    resolveFfmpegPath({
      envPath: null,
      systemPaths: ["/usr/bin/ffmpeg"],
      staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
      isExecutableFile
    }),
    "/usr/bin/ffmpeg",
    "system FFmpeg should be preferred over the bundled static binary"
  );

  assert.strictEqual(
    resolveFfmpegPath({
      envPath: null,
      systemPaths: ["/missing/ffmpeg"],
      staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
      isExecutableFile
    }),
    "/app/node_modules/ffmpeg-static/ffmpeg",
    "bundled FFmpeg should remain as a fallback"
  );

  assert.strictEqual(
    resolveFfmpegPath({
      envPath: null,
      systemPaths: ["/missing/ffmpeg"],
      staticPath: null,
      isExecutableFile
    }),
    null,
    "return null when no executable is available"
  );

  console.log("✓ FFmpeg binary resolution tests passed");
}

main();
