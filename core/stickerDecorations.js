"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCE = Object.freeze({
  repositoryUrl: "https://github.com/uhidontkno/DiscordAvatarDecorations",
  manifestFile: path.join(__dirname, "data", "discordDecorations.manifest.json")
});
const MAX_LIMIT = 100;

function readManifest(file = SOURCE.manifestFile) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error("Không đọc được catalog Discord đã đóng gói: " + error.message);
  }
  if (data?.version !== 2 || !Array.isArray(data.items) || !data.items.length) {
    throw new Error("Catalog Discord không hợp lệ hoặc đang rỗng.");
  }
  return data;
}

function createDecorationCatalog({ manifestFile = SOURCE.manifestFile } = {}) {
  let manifest = null;

  function snapshot() {
    if (!manifest) manifest = readManifest(manifestFile);
    return manifest;
  }

  async function getDecorations(options = {}) {
    const data = snapshot();
    const query = String(options.query || "").trim().toLowerCase();
    const category = String(options.category || "").trim().toLowerCase();
    const animated = options.animated === true || options.animated === "true"
      ? true
      : options.animated === false || options.animated === "false" ? false : null;
    const filtered = data.items.filter(item => {
      if (category && item.category !== category && String(item.collection).toLowerCase() !== category) return false;
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
      source: data.source || SOURCE.repositoryUrl,
      sourceSha: data.sourceCommit || null,
      cachedAt: data.generatedAt || null,
      stale: false
    };
  }

  async function getDecoration(id) {
    const data = snapshot();
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

  async function getRandomDecoration() {
    const data = snapshot();
    if (!data.items.length) return null;
    return data.items[Math.floor(Math.random() * data.items.length)] || null;
  }

  async function refresh() {
    // The catalog is bundled with the application, so refresh never calls a
    // remote API and cannot fail because of GitHub rate limits. Re-read it
    // from disk in case an operator updated the manifest on the persistent disk.
    manifest = readManifest(manifestFile);
    return manifest;
  }

  return { getDecorations, getDecoration, getRandomDecoration, refresh, snapshot };
}

const catalog = createDecorationCatalog();

module.exports = {
  SOURCE,
  MAX_LIMIT,
  readManifest,
  createDecorationCatalog,
  getDecorations: catalog.getDecorations,
  getDecoration: catalog.getDecoration,
  getRandomDecoration: catalog.getRandomDecoration,
  refresh: catalog.refresh
};
