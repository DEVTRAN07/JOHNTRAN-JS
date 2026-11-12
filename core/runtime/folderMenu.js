"use strict";

const FOLDER_ALIASES = Object.freeze({
  "tienich": ["tools", "public", "info"],
  "hethong": ["admin", "mybot", "hidden"],
  "nhom": ["manager", "anti"],
  "nhac": ["music"],
  "giaitri": ["fun", "entertainment"],
  "hanhdong": ["action"],
  "game": ["games"],
  "ai": ["assistant"]
});

const FOLDER_META = Object.freeze({
  "Tiện ích": { icon: "🧰", slug: "tienich", hint: "Công cụ hỗ trợ" },
  "Hệ thống": { icon: "⚙️", slug: "hethong", hint: "Quản trị hệ thống" },
  "Hệ Thống": { icon: "⚙️", slug: "hethong", hint: "Quản trị hệ thống" },
  "Nhóm": { icon: "🛡️", slug: "nhom", hint: "Quản lý nhóm" },
  "Nhạc": { icon: "🎵", slug: "nhac", hint: "Âm nhạc trực tuyến" },
  "Giải trí": { icon: "🎮", slug: "giaitri", hint: "Giải trí và thư giãn" },
  "Hành động": { icon: "✨", slug: "hanhdong", hint: "Tương tác thành viên" },
  "Game": { icon: "🎮", slug: "game", hint: "Trò chơi và tu tiên" },
  "AI": { icon: "🤖", slug: "ai", hint: "Trí tuệ nhân tạo" },
  "Khác": { icon: "📦", slug: "khac", hint: "Các tiện ích khác" }
});

function canSee(command, userId) {
  const role = command?.config?.role || 0;
  return role === 0 ||
    (role === 1 && (global.users?.admin?.includes(userId) || global.users?.support?.includes(userId))) ||
    (role === 2 && global.users?.admin?.includes(userId));
}

function canonicalCategory(value) {
  const key = normalizeFolder(value);
  if (key === "hethong") return "Hệ thống";
  if (key === "tienich") return "Tiện ích";
  return String(value || "Khác");
}

function collectFolders(commands, userId) {
  const groups = new Map();
  for (const command of commands.values()) {
    if (!canSee(command, userId)) continue;
    const category = canonicalCategory(command?.config?.category || "Khác");
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(command);
  }

  return [...groups.entries()].map(([category, items]) => {
    const meta = FOLDER_META[category] || FOLDER_META["Khác"];
    return {
      category,
      name: category,
      slug: meta.slug,
      aliases: FOLDER_ALIASES[meta.slug] || [],
      icon: meta.icon,
      description: meta.hint,
      count: items.length
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function normalizeFolder(value) {
  return String(value || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
}

function resolveFolder(commands, userId, value) {
  const key = normalizeFolder(value);
  if (!key) return null;
  return collectFolders(commands, userId).find((folder) =>
    normalizeFolder(folder.name) === key ||
    folder.slug === key ||
    folder.aliases.includes(key)
  ) || null;
}

function collectFolderCommands(commands, userId, folder) {
  return [...commands.values()]
    .filter((command) => canSee(command, userId))
    .filter((command) => canonicalCategory(command?.config?.category || "Khác") === folder.category)
    .map((command) => ({
      name: String(command.config.name || "").toLowerCase(),
      usage: command.config.usage || command.config.name,
      description: command.config.description || "Chưa có mô tả"
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderFolders(folders, prefix, botName, version) {
  const lines = folders.map((folder, index) =>
    `${String(index + 1).padStart(2, "0")} ${folder.icon} ${folder.name}  ·  ${folder.count} lệnh  ·  ${prefix}${folder.slug}`
  );
  return [
    `╭━━━〔 ${botName} · DANH MỤC 〕━━━╮`,
    `│ 📂 ${folders.length} thư mục · ${folders.reduce((n, f) => n + f.count, 0)} lệnh`,
    `├────────────────────`,
    ...lines.map((line) => `│ ${line}`),
    `├────────────────────`,
    `│ 💡 Gõ ${prefix}<tên thư mục> để xem lệnh`,
    `╰━━━━━━━━━━━━━━━━━━━━╯`,
    `JOHNTRAN v${version}`
  ].join("\n");
}

function renderFolder(folder, commands, prefix, botName, version) {
  const lines = commands.map((command) =>
    `➜ ${prefix}${command.usage} — ${command.description}`
  );
  return [
    `╭━━━〔 ${folder.icon} ${folder.name.toUpperCase()} 〕━━━╮`,
    `│ ${folder.description}`,
    `│ 📋 Danh sách lệnh ${folder.name}`,
    `├────────────────────`,
    ...lines.map((line) => `│ ${line}`),
    `├────────────────────`,
    `│ Gõ /menu để quay lại danh mục`,
    `╰━━━━━━━━━━━━━━━━━━━━╯`,
    `${botName} · v${version}`
  ].join("\n");
}

module.exports = {
  collectFolders, resolveFolder, collectFolderCommands, canonicalCategory,
  renderFolders, renderFolder, normalizeFolder
};
