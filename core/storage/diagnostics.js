"use strict";

const fs = require("fs");
const path = require("path");

const EPHEMERAL_FILESYSTEMS = new Set([
  "overlay", "tmpfs", "ramfs", "proc", "sysfs", "devtmpfs", "squashfs"
]);

function isWithinPath(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function decodeMountField(value) {
  return String(value || "").replace(/\\\\(040|011|012|134)/g, (_match, code) => ({
    "040": " ", "011": "\t", "012": "\n", "134": "\\"
  }[code]));
}

function parseMountInfo(input) {
  return String(input || "").split(/\r?\n/).filter(Boolean).flatMap(line => {
    const halves = line.split(" - ");
    if (halves.length !== 2) return [];
    const left = halves[0].trim().split(/\s+/);
    const right = halves[1].trim().split(/\s+/);
    if (left.length < 5 || right.length < 3) return [];
    return [{
      mountId: left[0],
      device: left[2],
      root: decodeMountField(left[3]),
      mountPoint: path.resolve(decodeMountField(left[4])),
      fsType: right[0],
      source: right[1]
    }];
  });
}

function findMountForPath(target, mounts) {
  const resolved = path.resolve(target);
  return (Array.isArray(mounts) ? mounts : [])
    .filter(mount => isWithinPath(mount.mountPoint, resolved))
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0] || null;
}

function readMountInfo() {
  try {
    return fs.readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return "";
  }
}

function getJsonPersistenceStatus(filePath, env = process.env, mountInfoText = readMountInfo()) {
  const resolvedFile = path.resolve(filePath);
  const isRender = Boolean(env.RENDER || env.RENDER_SERVICE_ID);
  const configuredRoot = String(env.JT_PERSISTENT_DIR || env.JT_DB_PERSISTENT_PATH || "").trim();

  if (!isRender) {
    return {
      status: "host-local",
      confirmed: false,
      configuredRoot: configuredRoot ? path.resolve(configuredRoot) : null,
      mountPoint: null,
      fsType: null,
      message: "Đang dùng JSON trên filesystem của host; độ bền phụ thuộc nhà cung cấp máy chủ."
    };
  }

  const mounts = parseMountInfo(mountInfoText);
  if (!configuredRoot) {
    const currentMount = findMountForPath(resolvedFile, mounts);
    const hasSeparateMount = Boolean(
      currentMount &&
      currentMount.mountPoint !== path.parse(resolvedFile).root &&
      !EPHEMERAL_FILESYSTEMS.has(currentMount.fsType)
    );
    return {
      status: hasSeparateMount ? "mount-detected-unverified" : "unconfigured",
      confirmed: false,
      configuredRoot: null,
      mountPoint: hasSeparateMount ? currentMount.mountPoint : null,
      fsType: hasSeparateMount ? currentMount.fsType : null,
      message: hasSeparateMount
        ? "Có filesystem mount riêng tại vị trí database, nhưng chưa khai báo JT_PERSISTENT_DIR để xác minh đường dẫn."
        : "Chưa khai báo JT_PERSISTENT_DIR. Chưa thể xác nhận JSON database nằm trên Persistent Disk của Render."
    };
  }

  const root = path.resolve(configuredRoot);
  if (!isWithinPath(root, resolvedFile)) {
    return {
      status: "database-outside-disk",
      confirmed: false,
      configuredRoot: root,
      mountPoint: null,
      fsType: null,
      message: "JT_DB_FILE nằm ngoài JT_PERSISTENT_DIR; dữ liệu JSON hiện không được đặt trong vùng lưu trữ đã khai báo."
    };
  }

  const mount = findMountForPath(root, mounts);
  const isDedicatedMount = Boolean(
    mount &&
    mount.mountPoint !== path.parse(root).root &&
    !EPHEMERAL_FILESYSTEMS.has(mount.fsType)
  );

  if (!isDedicatedMount) {
    return {
      status: "mount-not-verified",
      confirmed: false,
      configuredRoot: root,
      mountPoint: mount?.mountPoint || null,
      fsType: mount?.fsType || null,
      message: "Đã khai báo JT_PERSISTENT_DIR nhưng không phát hiện được mount riêng tại đường dẫn đó. Hãy đối chiếu chính xác với Disk Mount Path trên Render."
    };
  }

  return {
    status: "verified-mount",
    confirmed: true,
    configuredRoot: root,
    mountPoint: mount.mountPoint,
    fsType: mount.fsType,
    message: "Database nằm dưới JT_PERSISTENT_DIR và đường dẫn này thuộc một filesystem mount riêng."
  };
}

module.exports = {
  EPHEMERAL_FILESYSTEMS,
  isWithinPath,
  parseMountInfo,
  findMountForPath,
  getJsonPersistenceStatus
};
