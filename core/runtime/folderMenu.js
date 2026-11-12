"use strict";

const FOLDER_ALIASES = Object.freeze({
  tienich: ["tools", "public", "info"],
  hethong: ["admin", "mybot", "hidden"],
  nhom: ["manager", "anti"],
  nhac: ["music"],
  giaitri: ["fun", "entertainment"],
  hanhdong: ["action"],
  game: ["games"],
  ai: ["assistant"]
});

const FOLDER_META = Object.freeze({
  "Tiện ích": { icon: "🧰", slug: "tienich", hint: "Công cụ hỗ trợ" },
  "Hệ thống": { icon: "⚙️", slug: "hethong", hint: "Quản trị hệ thống" },
  "Nhóm": { icon: "🛡️", slug: "nhom", hint: "Quản lý nhóm" },
  "Nhạc": { icon: "🎵", slug: "nhac", hint: "Âm nhạc trực tuyến" },
  "Giải trí": { icon: "🎮", slug: "giaitri", hint: "Giải trí và thư giãn" },
  "Hành động": { icon: "✨", slug: "hanhdong", hint: "Tương tác thành viên" },
  "Game": { icon: "🎮", slug: "game", hint: "Trò chơi và tu tiên" },
  "AI": { icon: "🤖", slug: "ai", hint: "Trí tuệ nhân tạo" },
  "Khác": { icon: "📦", slug: "khac", hint: "Các tiện ích khác" }
});

const ALL_FOLDER_KEYS = new Set(["tong", "all", "total", "tatca", "allcommands"]);

function normalizeFolder(value) {
  return String(value || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
}

function canSee(command, userId) {
  const role = Number(command?.config?.role || 0);
  if (role === 0) return true;
  if (role === 1) return Boolean(global.users?.admin?.includes(userId) || global.users?.support?.includes(userId));
  if (role === 2) return Boolean(global.users?.admin?.includes(userId));
  return false;
}

function canonicalCategory(value) {
  const key = normalizeFolder(value);
  if (key === "hethong") return "Hệ thống";
  if (key === "tienich") return "Tiện ích";
  return String(value || "Khác").trim() || "Khác";
}

function folderMeta(category) {
  const meta = FOLDER_META[category];
  if (meta) return meta;
  const slug = normalizeFolder(category) || "khac";
  return { icon: "📁", slug, hint: `Các lệnh thuộc nhóm ${category}` };
}

function collectFolders(commands, userId) {
  const groups = new Map();
  for (const command of commands.values()) {
    if (!canSee(command, userId)) continue;
    const category = canonicalCategory(command?.config?.category);
    groups.set(category, (groups.get(category) || 0) + 1);
  }

  return [...groups.entries()].map(([category, count]) => {
    const meta = folderMeta(category);
    return {
      category, name: category, slug: meta.slug,
      aliases: FOLDER_ALIASES[meta.slug] || [],
      icon: meta.icon, description: meta.hint, count
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function resolveFolder(commands, userId, value) {
  const key = normalizeFolder(value);
  if (!key || ALL_FOLDER_KEYS.has(key)) return null;
  return collectFolders(commands, userId).find(folder =>
    normalizeFolder(folder.name) === key || folder.slug === key || folder.aliases.includes(key)
  ) || null;
}

function collectFolderCommands(commands, userId, folder) {
  const result = [];
  for (const command of commands.values()) {
    if (!canSee(command, userId)) continue;
    if (canonicalCategory(command?.config?.category) !== folder.category) continue;
    const name = String(command?.config?.name || "").toLowerCase();
    result.push({
      name,
      usage: command?.config?.usage || name,
      description: command?.config?.description || "Chưa có mô tả"
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function collectAllCommands(commands, userId) {
  const folders = collectFolders(commands, userId);
  return folders.map(folder => ({
    ...folder,
    commands: collectFolderCommands(commands, userId, folder)
  }));
}

function renderFolders(folders, prefix, botName, version) {
  const total = folders.reduce((n, folder) => n + folder.count, 0);
  const lines = folders.map((folder, index) =>
    `${String(index + 1).padStart(2, "0")} ${folder.icon} ${folder.name} · ${folder.count} lệnh · ${prefix}${folder.slug}`
  );
  return [
    `╭━━━〔 ${botName} · DANH MỤC 〕━━━╮`,
    `│ 📂 ${folders.length} thư mục · ${total} lệnh`,
    "├────────────────────────",
    ...lines.map(line => `│ ${line}`),
    "├────────────────────────",
    `│ 💡 Gõ ${prefix}<tên thư mục> để xem lệnh`,
    `│ 📚 Gõ ${prefix}folder tổng để xem toàn bộ lệnh`,
    "╰────────────────────────",
    `JOHNTRAN · v${version}`
  ].join("\n");
}

function renderFolder(folder, commands, prefix, botName, version) {
  const lines = commands.map(command =>
    `➜ ${prefix}${command.usage} — ${command.description}`
  );
  return [
    `╭━━━〔 ${folder.icon} ${folder.name.toUpperCase()} 〕━━━╮`,
    `│ ${folder.description}`,
    `│ 📋 ${commands.length} lệnh`,
    "├────────────────────────",
    ...lines.map(line => `│ ${line}`),
    "├────────────────────────",
    `│ Gõ ${prefix}menu để quay lại danh mục`,
    `╰────────────────────────`,
    `${botName} · v${version}`
  ].join("\n");
}

function renderAllCommands(groups, prefix, botName, version) {
  const total = groups.reduce((sum, group) => sum + group.commands.length, 0);
  const lines = [];
  for (const group of groups) {
    lines.push(`〔${group.icon} ${group.name} · ${group.commands.length}〕`);
    for (const command of group.commands) {
      lines.push(`  • ${prefix}${command.usage} — ${command.description}`);
    }
  }
  return [
    `╭━━━〔 ${botName} · TOÀN BỘ LỆNH 〕━━━╮`,
    `│ ${groups.length} thư mục · ${total} lệnh`,
    "├────────────────────────",
    ...lines.map(line => `│ ${line}`),
    "├────────────────────────",
    `│ Gõ ${prefix}menu để xem thư mục`,
    "╰────────────────────────",
    `JOHNTRAN · v${version}`
  ].join("\n");
}

module.exports = {
  collectFolders, resolveFolder, collectFolderCommands, collectAllCommands,
  canonicalCategory, renderFolders, renderFolder, renderAllCommands,
  normalizeFolder, ALL_FOLDER_KEYS
};
