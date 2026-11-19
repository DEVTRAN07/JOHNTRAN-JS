const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const ffmpeg = require("fluent-ffmpeg");
const { tryUnlink } = require("./file");
const { FFMPEG_THREADS } = require("../core/mediaResourceLimits");

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

async function processAudio(audioPath, threadId, type, api = null, operations = {}) {
    const extension = path.extname(String(audioPath || "")).toLowerCase();
    const alreadyAac = extension === ".aac";
    const parsedPath = path.parse(audioPath);
    const outputPath = alreadyAac
      ? audioPath
      : path.join(parsedPath.dir, parsedPath.name + ".aac");
    const upload = operations.uploadFile || uploadFile;
    const convert = operations.convertMp3ToAac || convertMp3ToAac;

    try {
        // HLS is delivered as AAC/ADTS. Upload it directly and do not ask
        // FFmpeg to read and write the same path (a previous .aac call did
        // exactly that, then attempted to unlink the same file twice).
        if (!alreadyAac) await convert(audioPath, outputPath);
        const uploaded = await upload(outputPath, threadId, type, api);
        const first = Array.isArray(uploaded) ? uploaded[0] : uploaded;
        const fileUrl = String(first?.fileUrl || first?.url || "").trim();
        if (!fileUrl) throw new Error("Zalo không trả URL file âm thanh sau upload.");
        const audioUrl = /\.aac(?:$|[?#])/i.test(fileUrl) ? fileUrl : fileUrl + ".aac";

        await Promise.all([...new Set([audioPath, outputPath])].map(file =>
          fs.promises.rm(file, { force: true }).catch(() => {})
        ));
        return audioUrl;
    } catch (error) {
        await Promise.all([...new Set([audioPath, outputPath])].map(file =>
          fs.promises.rm(file, { force: true }).catch(() => {})
        ));
        throw error;
    }
}

function convertMp3ToAac(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .audioCodec("aac")
      .outputOptions(["-threads " + FFMPEG_THREADS])
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
