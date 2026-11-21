"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const updateReport = require("../core/runtime/updateReport");

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-update-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("update result is persisted and delivered only to the requesting bot", t => {
  const root = makeTempRoot(t);
  const request = updateReport.writeUpdateRequest(root, {
    botName: "worker-a",
    threadId: "group-123",
    threadType: 1
  });

  assert.equal(updateReport.readUpdateRequest(root).id, request.id);
  const report = updateReport.completeUpdate(root, {
    status: "success",
    updated: true,
    oldSha: "1234567890abcdef",
    newSha: "abcdef1234567890",
    changedFiles: 7
  });

  assert.equal(updateReport.readUpdateRequest(root), null);
  assert.equal(updateReport.readPendingResult(root, "worker-b"), null);
  assert.equal(updateReport.readPendingResult(root, "worker-a").id, request.id);
  const message = updateReport.formatUpdateReport(report);
  assert.match(message, /Phiên bản cũ: 1234567/);
  assert.match(message, /Phiên bản mới: abcdef1/);
  assert.doesNotMatch(message, /4\.0\.0|4\.0\.1/);
  assert.equal(updateReport.clearPendingResult(root, "wrong-id"), false);
  assert.equal(updateReport.clearPendingResult(root, request.id), true);
  assert.equal(updateReport.readPendingResult(root, "worker-a"), null);
});

test("Git commit short hash is used as the version when package version is unchanged", () => {
  const message = updateReport.formatUpdateReport({
    status: "success",
    updated: true,
    oldSha: "1111111111111111111111111111111111111111",
    newSha: "2e90ba616b2878ad5345de58a25d706074099832",
    changedFiles: 3
  });

  assert.match(message, /Phiên bản cũ: 1111111/);
  assert.match(message, /Phiên bản mới: 2e90ba6/);
  assert.doesNotMatch(message, /4\.0\.0/);
});
test("latest and failed updates produce distinct user messages", () => {
  const latest = updateReport.formatUpdateReport({
    status: "success", updated: false, newSha: "1234567890abcdef"
  });
  const failed = updateReport.formatUpdateReport({
    status: "failed", newSha: "1234567890abcdef", error: "git fetch failed"
  });

  assert.match(latest, /ĐÃ Ở BẢN MỚI NHẤT/);
  assert.match(latest, /Phiên bản hiện tại: 1234567/);
  assert.doesNotMatch(latest, /4\.0\.0/);
  assert.match(failed, /CẬP NHẬT JOHNTRAN-JS THẤT BẠI/);
  assert.match(failed, /git fetch failed/);
  assert.match(failed, /Phiên bản đang chạy: 1234567/);
  assert.doesNotMatch(failed, /4\.0\.0/);
});

test("only the matching command can clear a pending update request", t => {
  const root = makeTempRoot(t);
  const request = updateReport.writeUpdateRequest(root, {
    botName: "main",
    threadId: "private-456",
    threadType: 0
  });

  assert.equal(updateReport.clearUpdateRequest(root, "another-request"), false);
  assert.equal(updateReport.readUpdateRequest(root).id, request.id);
  assert.equal(updateReport.clearUpdateRequest(root, request.id), true);
  assert.equal(updateReport.readUpdateRequest(root), null);
});
