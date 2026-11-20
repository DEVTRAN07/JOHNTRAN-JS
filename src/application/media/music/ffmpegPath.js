const fs = require("fs");
const path = require("path");

function isExecutable(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return false;
  const value = candidate.trim();

  // A bare command (for example "ffmpeg") is resolved through PATH by execFile.
  if (!path.isAbsolute(value) && !value.includes(path.sep)) return true;

  try {
    fs.accessSync(value, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFfmpegPath(options = {}) {
  const envPath = options.envPath === undefined ? process.env.FFMPEG_PATH : options.envPath;
  const systemPaths = options.systemPaths || [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/bin/ffmpeg"
  ];
  const staticPath = options.staticPath || null;
  const canExecute = options.isExecutableFile || isExecutable;

  const candidates = [envPath, ...systemPaths, staticPath]
    .filter(Boolean)
    .map((candidate) => String(candidate).trim())
    .filter(Boolean);

  return [...new Set(candidates)].find((candidate) => canExecute(candidate)) || null;
}

module.exports = { resolveFfmpegPath, isExecutable };
