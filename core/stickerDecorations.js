"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCE = Object.freeze({
  owner: "uhidontkno",
  repository: "DiscordAvatarDecorations",
  branch: "main",
  treeUrl: "https://api.github.com/repos/uhidontkno/DiscordAvatarDecorations/git/trees/main?recursive=1",
  rawBase: "https://raw.githubusercontent.com/uhidontkno/DiscordAvatarDecorations/main/",
  repositoryUrl: "https://github.com/uhidontkno/DiscordAvatarDecorations"
});

const CACHE_FILE = path.join(__dirname, "..", "assets", "cache", "sticker", "discord-decorations.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_LIMIT = 100;
const IMAGE_EXTENSIONS = new Set([".png", ".gif", ".webp", ".apng"]);
const ANIMATED_PRIORITY = [".webp", ".gif", ".apng"];

function titleFromFile(value) {
  return String(value || "")
    .replace(/\.(png|gif|webp|apng)$/i, "")
    .replace(/_static$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function safeRawUrl(assetPath) {
  const normalized = String(assetPath || "").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..")) return null;
  if (!/^(shop|archive|etc)\//.test(normalized)) return null;
  if (!IMAGE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) return null;
  return SOURCE.rawBase + normalized.split("/").map(encodeURIComponent).join("/");
}

function classifyPath(assetPath) {
  const parts = assetPath.split("/");
  const root = parts[0];
  if (!["shop", "archive", "etc"].includes(root)) return null;
  if (root === "etc" && parts[1] === "default_old") return null;

  const collection = parts[1] || "misc";
  let base = path.posix.basename(assetPath, path.posix.extname(assetPath));
  let variant = "static";

  if (root === "archive" && ["gif", "apng"].includes(parts[2])) {
    variant = "animated";
  } else if (root === "etc" && /\.(gif|webp|apng)$/i.test(assetPath)) {
    variant = "animated";
  } else if (/\.(gif|webp|apng)$/i.test(assetPath)) {
    variant = "animated";
  }

  if (root === "etc" && /_static$/i.test(base)) base = base.replace(/_static$/i, "");
  const idParts = [root, collection, base]
    .map(value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);
  return {
    id: idParts.join("-"),
    root,
    collection,
    base,
    variant,
    assetPath
  };
}

function buildCatalog(tree, sourceSha = null, generatedAt = Date.now()) {
  const groups = new Map();
  for (const entry of Array.isArray(tree) ? tree : []) {
    if (entry?.type !== "blob" || typeof entry.path !== "string") continue;
    if (!IMAGE_EXTENSIONS.has(path.posix.extname(entry.path).toLowerCase())) continue;
    const classified = classifyPath(entry.path);
    if (!classified?.id) continue;

    if (!groups.has(classified.id)) {
      groups.set(classified.id, {
        id: classified.id,
        name: titleFromFile(classified.base),
        category: classified.root,
        collection: classified.collection,
        staticPath: null,
        animatedPaths: []
      });
    }
    const group = groups.get(classified.id);
    if (classified.variant === "animated") group.animatedPaths.push(classified.assetPath);
    else if (!group.staticPath) group.staticPath = classified.assetPath;
  }

  const items = [];
  for (const group of groups.values()) {
    group.animatedPaths.sort((a, b) => {
      const extA = path.posix.extname(a).toLowerCase();
      const extB = path.posix.extname(b).toLowerCase();
      const indexA = ANIMATED_PRIORITY.indexOf(extA);
      const indexB = ANIMATED_PRIORITY.indexOf(extB);
      return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB);
    });
    const animatedPath = group.animatedPaths[0] || null;
    const apngFallback = group.animatedPaths.find(item => /\/apng\//i.test(item) && /\.png$/i.test(item));
    const staticPath = group.staticPath || apngFallback || animatedPath;
    const staticUrl = safeRawUrl(staticPath);
    const animatedUrl = safeRawUrl(animatedPath);
    if (!staticUrl && !animatedUrl) continue;

    items.push({
      id: group.id,
      name: group.name,
      category: group.category,
      collection: group.collection,
      animated: Boolean(animatedUrl),
      staticAvailable: Boolean(group.staticPath),
      staticUrl: staticUrl || animatedUrl,
      animatedUrl,
      sourcePath: group.staticPath || apngFallback || animatedPath,
      source: SOURCE.repositoryUrl
    });
  }

  items.sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.collection.localeCompare(b.collection) ||
    a.name.localeCompare(b.name)
  );
  return {
    version: 1,
    sourceSha,
    generatedAt,
    source: SOURCE.repositoryUrl,
    total: items.length,
    items
  };
}

function createDecorationCatalog({
  fetchImpl = globalThis.fetch,
  cacheFile = CACHE_FILE,
  ttlMs = CACHE_TTL_MS,
  now = Date.now
} = {}) {
  let memory = null;
  let refreshPromise = null;

  function readCache() {
    if (memory) return memory;
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (parsed?.version === 1 && Array.isArray(parsed.items)) memory = parsed;
    } catch {}
    return memory;
  }

  function writeCache(snapshot) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const temp = cacheFile + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(snapshot));
      fs.renameSync(temp, cacheFile);
    } catch {}
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    if (typeof fetchImpl !== "function") throw new Error("Môi trường không hỗ trợ fetch để tải catalog Discord.");
    refreshPromise = (async () => {
      const response = await fetchImpl(SOURCE.treeUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "JOHNTRAN-JS-sticker-decoration-catalog"
        },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(12000)
          : undefined
      });
      if (!response?.ok) throw new Error("Không tải được catalog Discord từ GitHub (HTTP " + (response?.status || "?") + ").");
      const payload = await response.json();
      if (!Array.isArray(payload?.tree) || payload.tree.length === 0) {
        throw new Error("Catalog Discord trả về dữ liệu không hợp lệ.");
      }
      const next = buildCatalog(payload.tree, payload.sha || null, now());
      if (!next.items.length) throw new Error("Catalog Discord không có decoration hợp lệ.");
      memory = next;
      writeCache(next);
      return next;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function snapshot({ forceRefresh = false } = {}) {
    const cached = readCache();
    if (forceRefresh) return refresh();
    if (cached && now() - Number(cached.generatedAt || 0) < ttlMs) return cached;
    if (cached) {
      refresh().catch(() => {});
      return cached;
    }
    return refresh();
  }

  async function getDecorations(options = {}) {
    const data = await snapshot(options);
    const query = String(options.query || "").trim().toLowerCase();
    const category = String(options.category || "").trim().toLowerCase();
    const animated = options.animated === true || options.animated === "true"
      ? true
      : options.animated === false || options.animated === "false" ? false : null;
    const filtered = data.items.filter(item => {
      if (category && item.category !== category && item.collection !== category) return false;
      if (animated !== null && item.animated !== animated) return false;
      if (!query) return true;
      return [item.id, item.name, item.category, item.collection].join(" ").toLowerCase().includes(query);
    });
    const limitRaw = Number(options.limit);
    const offsetRaw = Number(options.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : 30;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    return {
      total: filtered.length,
      limit,
      offset,
      items: filtered.slice(offset, offset + limit),
      source: data.source,
      sourceSha: data.sourceSha,
      cachedAt: data.generatedAt,
      stale: now() - Number(data.generatedAt || 0) >= ttlMs
    };
  }

  async function getDecoration(id, options = {}) {
    const data = await snapshot(options);
    const key = String(id || "").trim().toLowerCase();
    if (!key) return null;
    const exact = data.items.find(item => item.id.toLowerCase() === key);
    if (exact) return exact;
    const matches = data.items.filter(item =>
      path.posix.basename(item.sourcePath || "").replace(/\.(png|gif|webp|apng)$/i, "").toLowerCase() === key ||
      item.name.toLowerCase() === key
    );
    return matches.length === 1 ? matches[0] : null;
  }

  return { getDecorations, getDecoration, refresh, snapshot };
}

const catalog = createDecorationCatalog();

module.exports = {
  SOURCE,
  CACHE_FILE,
  CACHE_TTL_MS,
  MAX_LIMIT,
  safeRawUrl,
  buildCatalog,
  createDecorationCatalog,
  getDecorations: catalog.getDecorations,
  getDecoration: catalog.getDecoration,
  refresh: catalog.refresh
};
