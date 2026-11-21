"use strict";
const path = require("path");
const fs = require("fs");

const NATIVE_DIR = path.resolve(__dirname);

function tryLoad(crateDir, addon) {
  const p = path.join(NATIVE_DIR, crateDir, addon);
  try {
    if (!fs.existsSync(p)) return { ok: false, err: new Error("missing: " + p) };
    const mod = require(p);
    return { ok: true, mod };
  } catch (err) {
    return { ok: false, err };
  }
}

const stickerNative = tryLoad("sticker-rs", "sticker_rs.node");
const canvasNative = tryLoad("canvas-rs", "canvas_rs.node");
const ffmpegNative = tryLoad("ffmpeg-rs", "ffmpeg_rs.node");
const textStyleNative = tryLoad("text-style-rs", "text_style_rs.node");
const commandParserNative = tryLoad("command-core-rs", "command_core_rs.node");
const gameCoreNative = tryLoad("game-core-rs", "game_core_rs.node");
const domainCoreNative = tryLoad("domain-core-rs", "domain_core_rs.node");
let noituEngineLastError = null;
let tlmnEngineLastError = null;

let groupStateLastError = null;

function tryGroupStateOperation(operation, args = []) {
  if (process.env.JT_RUST_GROUP_STATE === "0" || !domainCoreNative.ok) {
    return { used: false, value: null };
  }
  const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fn = domainCoreNative.mod[operation] || domainCoreNative.mod[camelName];
  if (typeof fn !== "function") {
    groupStateLastError = "Rust group-state export is missing: " + operation;
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    groupStateLastError = null;
    return { used: true, value };
  } catch (error) {
    groupStateLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

let requesterGreetingLastError = null;

function tryRequesterOperation(operation, args = []) {
  if (process.env.JT_RUST_REQUESTER_GREETING === "0" || !domainCoreNative.ok) {
    return { used: false, value: null };
  }
  const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fn = domainCoreNative.mod[operation] || domainCoreNative.mod[camelName];
  if (typeof fn !== "function") {
    requesterGreetingLastError = "Rust requester-greeting export is missing: " + operation;
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    requesterGreetingLastError = null;
    return { used: true, value };
  } catch (error) {
    requesterGreetingLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

let antiProtectionLastError = null;

function tryAntiProtectionOperation(operation, args = []) {
  if (process.env.JT_RUST_ANTI_PROTECTION === "0" || !domainCoreNative.ok) {
    return { used: false, value: null };
  }
  const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fn = domainCoreNative.mod[operation] || domainCoreNative.mod[camelName];
  if (typeof fn !== "function") {
    antiProtectionLastError = "Rust Anti-protection export is missing: " + operation;
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    antiProtectionLastError = null;
    return { used: true, value };
  } catch (error) {
    antiProtectionLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

let permissionPolicyLastError = null;

function tryPermissionPolicyOperation(operation, args = []) {
  if (process.env.JT_RUST_PERMISSION_POLICY === "0" || !domainCoreNative.ok) {
    return { used: false, value: null };
  }
  const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fn = domainCoreNative.mod[operation] || domainCoreNative.mod[camelName];
  if (typeof fn !== "function") {
    permissionPolicyLastError = "Rust permission-policy export is missing: " + operation;
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    permissionPolicyLastError = null;
    return { used: true, value };
  } catch (error) {
    permissionPolicyLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

let restartPolicyLastError = null;

function tryRestartPlan(args = []) {
  if (process.env.JT_RUST_RESTART_POLICY === "0" || !domainCoreNative.ok) {
    return { used: false, value: null };
  }
  const planner = domainCoreNative.mod.restart_plan || domainCoreNative.mod.restartPlan;
  if (typeof planner !== "function") {
    restartPolicyLastError = "Rust restart policy export is missing";
    return { used: false, value: null };
  }
  try {
    const value = planner(...args);
    restartPolicyLastError = null;
    return { used: true, value };
  } catch (error) {
    restartPolicyLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

function getRestartPolicyDiagnostics() {
  const planner = domainCoreNative.ok
    ? domainCoreNative.mod.restart_plan || domainCoreNative.mod.restartPlan
    : null;
  const enabled = process.env.JT_RUST_RESTART_POLICY !== "0";
  return {
    loaded: domainCoreNative.ok,
    enabled,
    active: enabled && typeof planner === "function",
    exports: domainCoreNative.ok ? Object.keys(domainCoreNative.mod || {}) : [],
    lastError: restartPolicyLastError,
    loadError: domainCoreNative.ok ? null : String(domainCoreNative.err?.message || domainCoreNative.err)
  };
}

function getPermissionPolicyDiagnostics() {
  const required = [
    "permission_check_command_role",
    "permission_evaluate_group",
    "permission_resolve_group_admin_state"
  ];
  const complete = required.every(operation => {
    const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return typeof domainCoreNative.mod?.[operation] === "function" ||
      typeof domainCoreNative.mod?.[camelName] === "function";
  });
  const enabled = process.env.JT_RUST_PERMISSION_POLICY !== "0";
  return {
    loaded: domainCoreNative.ok,
    enabled,
    active: enabled && domainCoreNative.ok && complete,
    exports: domainCoreNative.ok ? Object.keys(domainCoreNative.mod || {}) : [],
    lastError: permissionPolicyLastError,
    loadError: domainCoreNative.ok ? null : String(domainCoreNative.err?.message || domainCoreNative.err)
  };
}

function getAntiProtectionDiagnostics() {
  const required = [
    "anti_is_supported_feature",
    "anti_protection_keys",
    "anti_protection_state"
  ];
  const complete = required.every(operation => {
    const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return typeof domainCoreNative.mod?.[operation] === "function" ||
      typeof domainCoreNative.mod?.[camelName] === "function";
  });
  const enabled = process.env.JT_RUST_ANTI_PROTECTION !== "0";
  return {
    loaded: domainCoreNative.ok,
    enabled,
    active: enabled && domainCoreNative.ok && complete,
    exports: domainCoreNative.ok ? Object.keys(domainCoreNative.mod || {}) : [],
    lastError: antiProtectionLastError,
    loadError: domainCoreNative.ok ? null : String(domainCoreNative.err?.message || domainCoreNative.err)
  };
}

function getRequesterGreetingDiagnostics() {
  const required = [
    "requester_normalize_uid",
    "requester_includes_uid",
    "requester_get_admin_ids",
    "requester_get_bot_owner_id",
    "requester_is_bot_admin",
    "requester_is_support_user",
    "requester_is_bot_owner",
    "requester_role"
  ];
  const complete = required.every(operation => {
    const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return typeof domainCoreNative.mod?.[operation] === "function" ||
      typeof domainCoreNative.mod?.[camelName] === "function";
  });
  const enabled = process.env.JT_RUST_REQUESTER_GREETING !== "0";
  return {
    loaded: domainCoreNative.ok,
    enabled,
    active: enabled && domainCoreNative.ok && complete,
    exports: domainCoreNative.ok ? Object.keys(domainCoreNative.mod || {}) : [],
    lastError: requesterGreetingLastError,
    loadError: domainCoreNative.ok ? null : String(domainCoreNative.err?.message || domainCoreNative.err)
  };
}

function getGroupStateDiagnostics() {
  const required = [
    "group_is_enabled",
    "group_is_allowed_control",
    "group_is_allowed_control_message",
    "group_can_run_command",
    "group_enabled_flags",
    "group_state_snapshot"
  ];
  const complete = required.every(operation => {
    const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return typeof domainCoreNative.mod?.[operation] === "function" ||
      typeof domainCoreNative.mod?.[camelName] === "function";
  });
  const enabled = process.env.JT_RUST_GROUP_STATE !== "0";
  return {
    loaded: domainCoreNative.ok,
    enabled,
    active: enabled && domainCoreNative.ok && complete,
    exports: domainCoreNative.ok ? Object.keys(domainCoreNative.mod || {}) : [],
    lastError: groupStateLastError,
    loadError: domainCoreNative.ok ? null : String(domainCoreNative.err?.message || domainCoreNative.err)
  };
}

function tryTlmnOperation(operation, args = []) {
  if (process.env.JT_RUST_TLMN_ENGINE === "0" || !gameCoreNative.ok) {
    return { used: false, value: null };
  }
  const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fn = gameCoreNative.mod[operation] || gameCoreNative.mod[camelName];
  if (typeof fn !== "function") {
    tlmnEngineLastError = "Rust Tiến Lên export is missing: " + operation;
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    tlmnEngineLastError = null;
    return { used: true, value };
  } catch (error) {
    tlmnEngineLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

function getTlmnEngineDiagnostics() {
  const required = [
    "tlmn_create_deck", "tlmn_normalize_text", "tlmn_card_code",
    "tlmn_parse_card_code", "tlmn_compare_cards", "tlmn_sort_hand",
    "tlmn_parse_rank", "tlmn_parse_rank_sequence", "tlmn_analyze_combo",
    "tlmn_can_beat", "tlmn_validate_play", "tlmn_remove_cards",
    "tlmn_detect_white_hand", "tlmn_white_hand_high_card",
    "tlmn_white_hand_compare_cards", "tlmn_compare_white_hands",
    "tlmn_rank_label", "tlmn_card_label", "tlmn_format_cards"
  ];
  const complete = required.every(operation => {
    const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return typeof gameCoreNative.mod?.[operation] === "function" ||
      typeof gameCoreNative.mod?.[camelName] === "function";
  });
  const enabled = process.env.JT_RUST_TLMN_ENGINE !== "0";
  return {
    loaded: gameCoreNative.ok,
    enabled,
    active: enabled && gameCoreNative.ok && complete,
    lastError: tlmnEngineLastError,
    loadError: gameCoreNative.ok ? null : String(gameCoreNative.err?.message || gameCoreNative.err)
  };
}

let samEngineLastError = null;

function trySamOperation(operation, args = []) {
  if (process.env.JT_RUST_SAM_ENGINE === "0" || !gameCoreNative.ok) {
    return { used: false, value: null };
  }
  const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fn = gameCoreNative.mod[operation] || gameCoreNative.mod[camelName];
  if (typeof fn !== "function") {
    samEngineLastError = "Rust Sâm export is missing: " + operation;
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    samEngineLastError = null;
    return { used: true, value };
  } catch (error) {
    samEngineLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

function getSamEngineDiagnostics() {
  const required = [
    "sam_create_deck",
    "sam_sort_hand",
    "sam_normalize_text",
    "sam_parse_card_code",
    "sam_analyze_combo",
    "sam_can_beat",
    "sam_validate_play",
    "sam_remove_cards",
    "sam_detect_white_hand",
    "sam_compare_white_hands",
    "sam_card_label",
    "sam_format_cards"
  ];
  const complete = required.every(operation => {
    const camelName = operation.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return typeof gameCoreNative.mod?.[operation] === "function" ||
      typeof gameCoreNative.mod?.[camelName] === "function";
  });
  const enabled = process.env.JT_RUST_SAM_ENGINE !== "0";
  return {
    loaded: gameCoreNative.ok,
    enabled,
    active: enabled && gameCoreNative.ok && complete,
    lastError: samEngineLastError,
    loadError: gameCoreNative.ok ? null : String(gameCoreNative.err?.message || gameCoreNative.err)
  };
}



let textStyleLastError = null;


function parseCommandFallback(messageText, prefix) {
  if (
    typeof messageText !== "string" ||
    typeof prefix !== "string" ||
    prefix.length === 0 ||
    !messageText.startsWith(prefix)
  ) {
    return { matched: false, command: "", args: [] };
  }

  const remainder = messageText.slice(prefix.length).trim();
  if (!remainder) return { matched: true, command: "", args: [] };

  const parts = remainder.split(/\s+/);
  return {
    matched: true,
    command: String(parts.shift() || "").toLowerCase(),
    args: parts
  };
}

let commandParserLastError = null;

function parseCommand(messageText, prefix) {
  const fallback = () => parseCommandFallback(messageText, prefix);
  if (process.env.JT_RUST_COMMAND_PARSER === "0" || !commandParserNative.ok) return fallback();

  const parser = commandParserNative.mod.parse_command || commandParserNative.mod.parseCommand;
  if (typeof parser !== "function") {
    commandParserLastError = "Rust command parser export is missing";
    return fallback();
  }

  try {
    const parsed = parser(messageText, prefix);
    if (!parsed || typeof parsed.matched !== "boolean" ||
        typeof parsed.command !== "string" || !Array.isArray(parsed.args)) {
      throw new Error("Rust command parser returned an invalid result");
    }
    commandParserLastError = null;
    return {
      matched: parsed.matched,
      command: parsed.command,
      args: parsed.args.map(value => String(value))
    };
  } catch (error) {
    commandParserLastError = String(error?.stack || error?.message || error);
    return fallback();
  }
}

function getCommandParserDiagnostics() {
  const parser = commandParserNative.ok
    ? commandParserNative.mod.parse_command || commandParserNative.mod.parseCommand
    : null;
  const enabled = process.env.JT_RUST_COMMAND_PARSER !== "0";
  return {
    loaded: commandParserNative.ok,
    enabled,
    active: enabled && typeof parser === "function",
    exports: commandParserNative.ok ? Object.keys(commandParserNative.mod || {}) : [],
    loadError: commandParserNative.ok ? null : String(commandParserNative.err?.message || commandParserNative.err),
    lastError: commandParserLastError
  };
}


let gameCoreLastError = null;

function runCaroNative(exportNames, args) {
  if (process.env.JT_RUST_CARO_ENGINE === "0" || !gameCoreNative.ok) {
    return { used: false, value: null };
  }
  const names = Array.isArray(exportNames) ? exportNames : [exportNames];
  const fn = names.map(name => gameCoreNative.mod[name]).find(value => typeof value === "function");
  if (typeof fn !== "function") {
    gameCoreLastError = "Rust game core export is missing: " + names.join("/");
    return { used: false, value: null };
  }
  try {
    const value = fn(...args);
    gameCoreLastError = null;
    return { used: true, value };
  } catch (error) {
    gameCoreLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

function tryCaroCheckWinner(board, cellIndex, symbol) {
  return runCaroNative(["caro_check_winner", "caroCheckWinner"], [board, cellIndex, symbol]);
}

function tryCaroEvaluateMove(board, cellIndex, symbol) {
  return runCaroNative(["caro_evaluate_move", "caroEvaluateMove"], [board, cellIndex, symbol]);
}

function tryCaroChooseAiMove(board, aiSymbol) {
  return runCaroNative(["caro_choose_ai_move", "caroChooseAiMove"], [board, aiSymbol]);
}

function getGameCoreDiagnostics() {
  const exports = gameCoreNative.ok ? Object.keys(gameCoreNative.mod || {}) : [];
  const required = [
    ["caro_check_winner", "caroCheckWinner"],
    ["caro_evaluate_move", "caroEvaluateMove"],
    ["caro_choose_ai_move", "caroChooseAiMove"]
  ];
  const complete = required.every(names => names.some(name => typeof gameCoreNative.mod?.[name] === "function"));
  const enabled = process.env.JT_RUST_CARO_ENGINE !== "0";
  return {
    loaded: gameCoreNative.ok,
    enabled,
    active: enabled && gameCoreNative.ok && complete,
    exports,
    loadError: gameCoreNative.ok ? null : String(gameCoreNative.err?.message || gameCoreNative.err),
    lastError: gameCoreLastError
  };
}

function runNoituNative(exportNames, value) {
  if (process.env.JT_RUST_NOITU_ENGINE === "0" || !gameCoreNative.ok) {
    return { used: false, value: null };
  }
  const names = Array.isArray(exportNames) ? exportNames : [exportNames];
  const fn = names.map(name => gameCoreNative.mod[name]).find(item => typeof item === "function");
  if (typeof fn !== "function") {
    noituEngineLastError = "Rust Nối Từ export is missing: " + names.join("/");
    return { used: false, value: null };
  }
  try {
    const result = fn(String(value || ""));
    noituEngineLastError = null;
    return { used: true, value: result };
  } catch (error) {
    noituEngineLastError = String(error?.stack || error?.message || error);
    return { used: false, value: null };
  }
}

function tryNoituNormalizeSyllable(value) {
  return runNoituNative(["noitu_normalize_syllable", "noituNormalizeSyllable"], value);
}

function tryNoituNormalizePhrase(value) {
  return runNoituNative(["noitu_normalize_phrase", "noituNormalizePhrase"], value);
}

function tryNoituParsePhrase(value) {
  return runNoituNative(["noitu_parse_phrase", "noituParsePhrase"], value);
}

function getNoituEngineDiagnostics() {
  const required = [
    ["noitu_normalize_syllable", "noituNormalizeSyllable"],
    ["noitu_normalize_phrase", "noituNormalizePhrase"],
    ["noitu_parse_phrase", "noituParsePhrase"]
  ];
  const complete = required.every(names => names.some(name => typeof gameCoreNative.mod?.[name] === "function"));
  const enabled = process.env.JT_RUST_NOITU_ENGINE !== "0";
  return {
    loaded: gameCoreNative.ok,
    enabled,
    active: enabled && gameCoreNative.ok && complete,
    lastError: noituEngineLastError,
    loadError: gameCoreNative.ok ? null : String(gameCoreNative.err?.message || gameCoreNative.err)
  };
}

function randomColorStyles(text, colors, excludedRanges = []) {
  if (!textStyleNative.ok) return null;
  const colorizer = textStyleNative.mod.random_color_styles ||
    textStyleNative.mod.randomColorStyles;
  if (typeof colorizer !== "function") {
    textStyleLastError = "Rust addon missing random_color_styles export; exports=" +
      Object.keys(textStyleNative.mod || {}).join(",");
    return null;
  }
  try {
    textStyleLastError = null;
    return colorizer(
      String(text ?? ""),
      Array.isArray(colors) ? colors.map(String) : [],
      Array.isArray(excludedRanges) ? excludedRanges : []
    );
  } catch (error) {
    textStyleLastError = String(error?.stack || error?.message || error);
    return null;
  }
}

function getTextStyleDiagnostics() {
  return {
    loaded: textStyleNative.ok,
    exports: textStyleNative.ok ? Object.keys(textStyleNative.mod || {}) : [],
    loadError: textStyleNative.ok ? null : String(textStyleNative.err?.message || textStyleNative.err),
    lastError: textStyleLastError
  };
}


let stickerCompositorLastError = null;

async function composeStaticCircleSticker(options) {
  if (process.env.JT_RUST_STICKER_COMPOSITOR === "0" || !stickerNative.ok) return null;
  const compositor = stickerNative.mod.compose_static_circle_sticker ||
    stickerNative.mod.composeStaticCircleSticker;
  if (typeof compositor !== "function") {
    stickerCompositorLastError = "Rust sticker addon does not export compose_static_circle_sticker";
    return null;
  }
  try {
    const result = await compositor(options);
    if (!result || !result.buffer || result.format !== "webp") {
      throw new Error("Rust circle compositor returned an invalid result");
    }
    stickerCompositorLastError = null;
    return result;
  } catch (error) {
    stickerCompositorLastError = String(error?.stack || error?.message || error);
    return null;
  }
}

function getStickerDiagnostics() {
  const compositor = stickerNative.ok
    ? stickerNative.mod.compose_static_circle_sticker || stickerNative.mod.composeStaticCircleSticker
    : null;
  const enabled = process.env.JT_RUST_STICKER_COMPOSITOR !== "0";
  return {
    loaded: stickerNative.ok,
    enabled,
    active: enabled && typeof compositor === "function",
    exports: stickerNative.ok ? Object.keys(stickerNative.mod || {}) : [],
    loadError: stickerNative.ok ? null : String(stickerNative.err?.message || stickerNative.err),
    lastError: stickerCompositorLastError
  };
}

function wrap(fn) {
  return async function (options) {
    let lastErr;
    if (fn.native && fn.native.mod) {
      try { return fn.native.mod[fn.name](options); } catch (err) { lastErr = err; }
    }
    if (fn.fallback) { return fn.fallback(options); }
    throw lastErr || new Error("native module unavailable and no js fallback");
  };
}

async function jsEncodeWebp(options) {
  const Jimp = require("jimp");
  const image = await Jimp.read(options.buffer);
  const w = options.width || image.getWidth();
  const h = options.height || image.getHeight();
  image.scaleToFit(w, h);
  const buf = await image.getBufferAsync(Jimp.MIME_PNG);
  return { buffer: buf, format: "png", width: image.getWidth(), height: image.getHeight(), size: buf.length };
}

async function jsEncodeGif(options) {
  return jsEncodeWebp(options);
}

async function jsEncodeSticker(options) {
  return jsEncodeWebp(options);
}

async function jsRenderCard(options) {
  const { createCanvas } = require("canvas");
  const width = options.width || 1000;
  const height = options.height || 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = options.theme ? "#0b0e14" : "#0b0e14";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#eef2f8";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText(options.title || "JOHN TRAN", 56, 120);
  if (options.subtitle) {
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#8b98ad";
    ctx.fillText(options.subtitle, 56, 170);
  }
  const buf = canvas.toBuffer("image/png");
  return { buffer: buf, format: "png", width, height, size: buf.length };
}

async function jsProbe(input) {
  const ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, meta) => {
      if (err) return reject(err);
      const v = meta.streams.find((s) => s.codec_type === "video");
      resolve({
        duration: meta.duration || 0,
        width: v ? v.width : null,
        height: v ? v.height : null,
        codec: v ? v.codec_name : null,
        bitrate: meta.format ? meta.format.bit_rate || 0 : 0,
      });
    });
  });
}

async function jsDecodeFrame(input, timeSeconds) {
  const ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
  return new Promise((resolve, reject) => {
    const seek = timeSeconds != null ? timeSeconds : 0;
    ffmpeg(input)
      .seekInput(seek)
      .frames(1)
      .noAudio()
      .outputFormat("image2pipe")
      .output("pipe:1", { vcodec: "png" })
      .on("error", reject)
      .on("end", () => {})
      .on("data", (chunk) => {
        resolve({ buffer: chunk, width: 0, height: 0, format: "png", size: chunk.length });
      })
      .run();
  });
}

async function jsEncode(input, output) {
  const ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
  return new Promise((resolve, reject) => {
    ffmpeg(input).output(output).on("error", reject).on("end", () => resolve({ output, size: 0, duration: 0 })).run();
  });
}

const nativeApi = {
  encodeWebp: wrap({ name: "encode_webp", native: stickerNative, fallback: jsEncodeWebp }),
  encodeGif: wrap({ name: "encode_gif", native: stickerNative, fallback: jsEncodeGif }),
  encodeSticker: wrap({ name: "encode_sticker", native: stickerNative, fallback: jsEncodeSticker }),
  renderCard: wrap({ name: "render_card", native: canvasNative, fallback: jsRenderCard }),
  probe: wrap({ name: "probe", native: ffmpegNative, fallback: (o) => jsProbe(o) }),
  decodeFrame: wrap({ name: "decode_frame", native: ffmpegNative, fallback: (o) => jsDecodeFrame(o.input, o.timeSeconds) }),
  encode: wrap({ name: "encode", native: ffmpegNative, fallback: (o) => jsEncode(o.input, o.output) }),
  randomColorStyles,
  getTextStyleDiagnostics,
  composeStaticCircleSticker,
  getStickerDiagnostics,
  parseCommand,
  getCommandParserDiagnostics,
  tryCaroCheckWinner,
  tryCaroEvaluateMove,
  tryCaroChooseAiMove,
  getGameCoreDiagnostics,
  tryNoituNormalizeSyllable,
  tryNoituNormalizePhrase,
  tryNoituParsePhrase,
  getNoituEngineDiagnostics,
  trySamOperation,
  getSamEngineDiagnostics,
  tryTlmnOperation,
  getTlmnEngineDiagnostics,
  tryGroupStateOperation,
  getGroupStateDiagnostics,
  tryRequesterOperation,
  getRequesterGreetingDiagnostics,
  tryAntiProtectionOperation,
  getAntiProtectionDiagnostics,
  tryPermissionPolicyOperation,
  getPermissionPolicyDiagnostics,
  tryRestartPlan,
  getRestartPolicyDiagnostics,
  __test: { parseCommandFallback },
  nativeAvailable: {
    sticker: stickerNative.ok,
    canvas: canvasNative.ok,
    ffmpeg: ffmpegNative.ok,
    textStyle: textStyleNative.ok,
    commandParser: commandParserNative.ok,
    gameCore: gameCoreNative.ok,
    domainCore: domainCoreNative.ok,
  },
  loadErrors: {
    sticker: stickerNative.ok ? null : String(stickerNative.err && stickerNative.err.message),
    canvas: canvasNative.ok ? null : String(canvasNative.err && canvasNative.err.message),
    ffmpeg: ffmpegNative.ok ? null : String(ffmpegNative.err && ffmpegNative.err.message),
    textStyle: textStyleNative.ok ? null : String(textStyleNative.err && textStyleNative.err.message),
    commandParser: commandParserNative.ok ? null : String(commandParserNative.err && commandParserNative.err.message),
    gameCore: gameCoreNative.ok ? null : String(gameCoreNative.err && gameCoreNative.err.message),
    domainCore: domainCoreNative.ok ? null : String(domainCoreNative.err && domainCoreNative.err.message),
  },
};

module.exports = nativeApi;
