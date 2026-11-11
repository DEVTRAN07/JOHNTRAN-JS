const fs = require("fs");
const { execSync } = require("child_process");

const SUSPICIOUS_DEP = /(require\s*\(|process\b|global\b|Function\s*\(|eval\s*\(|setTimeout\s*\(|setInterval\s*\(|\.\s*call\s*\(|\.\s*apply\s*\(|->|=>)/i;
const DEP_PAIR = /(?:'([^']+)'|"([^"]+)"|([a-zA-Z_$][a-zA-Z0-9_$]*))\s*:\s*(?:'([^']*)'|"([^"]*)")/g;

function extractDependencies(filePath, logger) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/dependencies\s*:\s*\{/);
    if (!match) return {};
    let start = match.index + match[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = start; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return {};
    const block = content.slice(start + 1, end);
    if (SUSPICIOUS_DEP.test(block)) { logger.log(`Phát hiện nội dung đáng ngờ trong dependencies của ${filePath}, bỏ qua block`, "warn"); return {}; }
    const deps = {};
    let m;
    while ((m = DEP_PAIR.exec(block)) !== null) {
      const key = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
      const val = m[4] !== undefined ? m[4] : m[5];
      if (key) deps[key] = val;
    }
    return deps;
  } catch (err) {
    logger.log(`Lỗi khi đọc dependencies từ ${filePath}: ${err.message}`, "error");
    return {};
  }
}

function installMissingDeps(deps, cwd, logger) {
  let shouldRestart = false;
  const errors = [];
  for (const [pkgName, version] of Object.entries(deps)) {
    try { require.resolve(pkgName); } catch {
      logger.log(`Đang cài package: ${pkgName}@${version || "latest"}`, "info");
      try {
        execSync(`npm install ${pkgName}@${version || "latest"}`, { stdio: "inherit", cwd });
        logger.log(`Đã cài xong ${pkgName}`, "info");
        shouldRestart = true;
      } catch (err) {
        logger.log(`Lỗi khi cài ${pkgName}: ${err.message}`, "error");
        errors.push(`Lỗi khi cài ${pkgName}: ${err.message}`);
      }
    }
  }
  return { shouldRestart, errors };
}

module.exports = { SUSPICIOUS_DEP, DEP_PAIR, extractDependencies, installMissingDeps };
