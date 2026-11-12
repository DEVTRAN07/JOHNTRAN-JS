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
    `│ 📋 Danh sách lệnh · ${commands.length} lệnh`,
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



/*
 * User-facing /menu sections.
 * These are virtual folders built from the real command metadata, not aliases
 * of broad internal categories. Keeping the classifier here makes /menu and
 * shortcuts such as /game, /tools and /admin show the exact same commands.
 */
const MENU_GROUPS = Object.freeze([
  { name: "Information", slug: "info", icon: "💡", description: "Thông tin tài khoản & hướng dẫn" },
  { name: "Utilities", slug: "public", icon: "🌐", description: "Tiện ích dùng chung cho mọi người" },
  { name: "Music", slug: "music", icon: "🎵", description: "Tìm kiếm và nghe nhạc" },
  { name: "Games", slug: "game", icon: "🎮", description: "Game và hoạt động giải trí" },
  { name: "Tools", slug: "tools", icon: "🧰", description: "Công cụ tự động và xử lý tác vụ" },
  { name: "Anti-Abuse", slug: "anti", icon: "🛡️", description: "Bảo vệ nhóm và chống spam" },
  { name: "Group Management", slug: "manager", icon: "👥", description: "Quản lý thành viên và tin nhắn" },
  { name: "Administration", slug: "admin", icon: "👑", description: "Lệnh dành cho quản trị viên" },
  { name: "Bot Operations", slug: "mybot", icon: "🤖", description: "Theo dõi và điều khiển hoạt động bot" },
  { name: "Special Commands", slug: "hidden", icon: "🔒", description: "Các lệnh đặc biệt, không hiển thị công khai" },
  { name: "Testing", slug: "test", icon: "🧪", description: "Các lệnh đang thử nghiệm" }
]);

const MENU_COMMAND_GROUPS = Object.freeze({
  info: new Set(["id", "infofb"]),
  public: new Set(["card", "getavt", "getlink", "getvd", "getvoice", "tiktok"]),
  music: new Set(["scl", "lyric"]),
  game: new Set(["tutien"]),
  tools: new Set(["autodown", "autosend", "stk"]),
  test: new Set([]),
  anti: new Set(["anti", "autokick"]),
  manager: new Set(["adduser", "delmsg"]),
  admin: new Set(["adc", "admin", "reloadconfig", "restart", "spam", "spamsticker"]),
  mybot: new Set(["cmd", "command", "events", "jobs", "stats", "upt"]),
  hidden: new Set(["girl", "hon", "noi", "vdgirl"])
});

function menuGroupForCommand(command) {
  const config = command?.config || {};
  const name = String(config.name || "").toLowerCase();
  if (!name || name === "menu") return null;

  for (const [slug, names] of Object.entries(MENU_COMMAND_GROUPS)) {
    if (names.has(name)) return slug;
  }

  const category = normalizeFolder(config.category);
  if (category === "game") return "game";
  if (category === "tienich" || category === "tie n ich") {
    const name = String(config.name || "").toLowerCase();
    if (["id", "infofb"].includes(name)) return "info";
    if (["card", "getavt", "getlink", "getvd", "getvoice", "tiktok"].includes(name)) return "public";
    return "tools";
  }
  if (category === "nhac" || category === "music") return "music";
  if (category === "nhom") {
    const name = String(config.name || "").toLowerCase();
    if (["anti", "autokick"].includes(name)) return "anti";
    return "manager";
  }
  if (category === "hethong") {
    const name = String(config.name || "").toLowerCase();
    if (["cmd", "events", "jobs", "stats", "upt"].includes(name)) return "mybot";
    return "admin";
  }
  if (config.test === true || ["test", "thunghiem", "kiemthu", "testing"].includes(category)) return "test";
  if (["giaitri", "hanhdong", "ai", "khac"].includes(category)) return "hidden";
  return "hidden";
}

function collectMenuGroups(commands, userId) {
  const buckets = new Map(MENU_GROUPS.map(group => [group.slug, []]));
  for (const command of commands.values()) {
    if (!canSee(command, userId)) continue;
    const slug = menuGroupForCommand(command);
    if (!slug || !buckets.has(slug)) continue;
    const config = command.config || {};
    const name = String(config.name || "").toLowerCase();
    buckets.get(slug).push({
      name,
      usage: config.usage || name,
      description: config.description || "Chưa có mô tả",
      role: Number(config.role || 0)
    });
  }

  return MENU_GROUPS.map(group => {
    const items = buckets.get(group.slug).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return { ...group, count: items.length, commands: items };
  }).filter(group => group.count > 0);
}

function resolveMenuGroup(commands, userId, value) {
  const key = normalizeFolder(value);
  if (!key || ALL_FOLDER_KEYS.has(key)) return null;
  const legacyNames = {
    info: ["info"], public: ["public"], music: ["music"], game: ["game"],
    tools: ["tools"], anti: ["anti"], manager: ["manager"], admin: ["admin"],
    mybot: ["mybot"], hidden: ["hidden"], test: ["test"]
  };
  const group = MENU_GROUPS.find(item =>
    normalizeFolder(item.name) === key ||
    normalizeFolder(item.slug) === key ||
    (legacyNames[item.slug] || []).includes(key)
  );
  if (!group) return null;
  const collected = collectMenuGroups(commands, userId);
  return collected.find(item => item.slug === group.slug) || null;
}

function collectMenuGroupCommands(commands, userId, group) {
  if (!group) return [];
  const current = resolveMenuGroup(commands, userId, group.slug);
  return current?.commands || [];
}

module.exports = {
  collectFolders, resolveFolder, collectFolderCommands, collectAllCommands,
  canonicalCategory, renderFolders, renderFolder, renderAllCommands,
  normalizeFolder, ALL_FOLDER_KEYS,
  MENU_GROUPS, menuGroupForCommand, collectMenuGroups, resolveMenuGroup, collectMenuGroupCommands
};
