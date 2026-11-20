"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const media = require("../utils/media");
const music = require("../core/music");

test("SoundCloud HLS defaults to AAC stream copy (no MP3 intermediate)", {
  skip: typeof music._test?.buildHlsAudioCodecArgs !== "function"
}, () => {
  assert.deepEqual(music._test.buildHlsAudioCodecArgs(null), ["-c:a", "copy"]);
  assert.deepEqual(music._test.buildHlsAudioCodecArgs(undefined), ["-c:a", "copy"]);
});

test("SoundCloud HLS explicit bitrate encodes AAC once at the requested rate", {
  skip: typeof music._test?.buildHlsAudioCodecArgs !== "function"
}, () => {
  assert.deepEqual(music._test.buildHlsAudioCodecArgs(128), ["-c:a", "aac", "-b:a", "128k"]);
  assert.deepEqual(music._test.buildHlsAudioCodecArgs(320), ["-c:a", "aac", "-b:a", "320k"]);
});

test("processAudio uploads ready AAC without invoking FFmpeg", {
  skip: media._test?.supportsDirectAac !== true
}, async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jt-aac-ready-"));
  const inputPath = path.join(directory, "soundcloud.aac");
  await fs.promises.writeFile(inputPath, Buffer.from("AAC-ADTS-test"));

  let convertCalls = 0;
  let uploadPath = null;
  try {
    const url = await media.processAudio(inputPath, "thread-1", 1, null, {
      convertMp3ToAac: async () => { convertCalls += 1; },
      uploadFile: async (file) => {
        uploadPath = file;
        assert.equal(file, inputPath);
        return [{ fileUrl: "https://cdn.example.test/audio-file" }];
      }
    });

    assert.equal(url, "https://cdn.example.test/audio-file.aac");
    assert.equal(convertCalls, 0);
    assert.equal(uploadPath, inputPath);
    await assert.rejects(fs.promises.stat(inputPath), { code: "ENOENT" });
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("processAudio converts MP3 to AAC once before upload", {
  skip: media._test?.supportsDirectAac !== true
}, async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jt-aac-convert-"));
  const inputPath = path.join(directory, "soundcloud.mp3");
  const outputPath = path.join(directory, "soundcloud.aac");
  await fs.promises.writeFile(inputPath, Buffer.from("MP3-test"));

  let convertCalls = 0;
  try {
    const url = await media.processAudio(inputPath, "thread-2", 1, null, {
      convertMp3ToAac: async (input, output) => {
        convertCalls += 1;
        assert.equal(input, inputPath);
        assert.equal(output, outputPath);
        await fs.promises.writeFile(output, Buffer.from("AAC-test"));
      },
      uploadFile: async (file) => {
        assert.equal(file, outputPath);
        return [{ fileUrl: "https://cdn.example.test/converted" }];
      }
    });

    assert.equal(url, "https://cdn.example.test/converted.aac");
    assert.equal(convertCalls, 1);
    await assert.rejects(fs.promises.stat(inputPath), { code: "ENOENT" });
    await assert.rejects(fs.promises.stat(outputPath), { code: "ENOENT" });
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
