const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const ffmpeg = require("fluent-ffmpeg");
const { tryUnlink } = require("./file");

ffmpeg.setFfmpegPath(require("ffmpeg-static"));

function convertDurationToFiveDigits(durationStr) {
  const duration = parseFloat(durationStr);
  const [sec, millisRaw] = duration.toFixed(3).split(".");
  return `${parseInt(sec)}${millisRaw}`;
}

async function uploadFile(videoPath, ID, Type, api) {
    const target = api || global.api;
    if (!target || typeof target.uploadAttachment !== "function") {
        throw new Error("Chưa sẵn sàng upload file (api chưa đăng nhập hoặc mất kết nối)");
    }
    const result = await target.uploadAttachment(
        videoPath,
        ID,
        Type
    );
    return result;
}

async function extractThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on("end", () => {
        resolve(thumbnailPath);
      })
      .on("error", (err) => {
        console.error("Error generating thumbnail:", err.message);
        reject(err);
      })
      .screenshots({
        count: 1,
        folder: path.dirname(thumbnailPath),
        filename: path.basename(thumbnailPath),
        timemarks: ["0"]
      });
  });
}

async function processVideo(videoPath, threadId, type, api = null) {
  try {
    const { probeVideo } = require("../core/videoMeta");
    const videoInfo = await probeVideo(videoPath);
    const videoStream = { width: videoInfo.width, height: videoInfo.height };

    const metadata = {
      duration: convertDurationToFiveDigits(videoInfo.format.duration),
      width: videoStream.width,
      height: videoStream.height,
    };

    const folderPath = path.dirname(videoPath);
    const thumbnailPath = path.join(folderPath, "thumb.jpg");

    await extractThumbnail(videoPath, thumbnailPath);

    const videoUrl = (await uploadFile(videoPath, threadId, type, api))[0].fileUrl;
    const thumbnailUrl = (await uploadFile(thumbnailPath, threadId, type, api))[0].normalUrl;

    fs.unlinkSync(thumbnailPath);
    fs.unlinkSync(videoPath);

    return {
      videoUrl,
      metadata,
      thumbnailUrl,
    };
  } catch (error) {
    console.error("Error processing video:", error.message);
    tryUnlink(videoPath);
    throw error;
  }
}

async function processAudio(audioPath, threadId, type, api = null) {
    const outputPath = audioPath.replace(/\.mp3$/, ".aac");
    try {
        await convertMp3ToAac(audioPath, outputPath);
        const audioUrl = (await uploadFile(outputPath, threadId, type, api))[0].fileUrl + ".aac";

        fs.unlinkSync(audioPath);
        fs.unlinkSync(outputPath);

        return audioUrl;
    } catch (error) {
        tryUnlink(audioPath);
        tryUnlink(outputPath);
        throw error;
    }
}

function convertMp3ToAac(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .audioCodec("aac")
      .on("end", () => {
        resolve(outputPath);
      })
      .on("error", (err) => {
        reject(err);
      })
      .run();
  });
}

module.exports = {
    convertDurationToFiveDigits,
    uploadFile,
    extractThumbnail,
    processVideo,
    processAudio,
    convertMp3ToAac
};
