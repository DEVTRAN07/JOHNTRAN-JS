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
    oldVersion: "4.0.0",
    newVersion: "4.0.1",
    oldSha: "1234567890abcdef",
    newSha: "abcdef1234567890",
    changedFiles: 7
  });

  assert.equal(updateReport.readUpdateRequest(root), null);
  assert.equal(updateReport.readPendingResult(root, "worker-b"), null);
  assert.equal(updateReport.readPendingResult(root, "worker-a").id, request.id);
  assert.match(updateReport.formatUpdateReport(report), /v4\.0\.0 → v4\.0\.1/);
  assert.match(updateReport.formatUpdateReport(report), /1234567 → abcdef1/);
  assert.equal(updateReport.clearPendingResult(root, "wrong-id"), false);
  assert.equal(updateReport.clearPendingResult(root, request.id), true);
  assert.equal(updateReport.readPendingResult(root, "worker-a"), null);
});

test("same package version still reports the updated source commit", t => {
  const message = updateReport.formatUpdateReport({
    status: "success",
    updated: true,
    oldVersion: "4.0.0",
    newVersion: "4.0.0",
    oldSha: "111111111111",
    newSha: "222222222222",
    changedFiles: 3
  });

  assert.match(message, /v4\.0\.0 \(số phiên bản release không đổi\)/);
  assert.match(message, /1111111 → 2222222/);
});

test("latest and failed updates produce distinct user messages", () => {
  const latest = updateReport.formatUpdateReport({
    status: "success", updated: false, newVersion: "4.0.0", newSha: "1234567890"
  });
  const failed = updateReport.formatUpdateReport({
    status: "failed", newVersion: "4.0.0", newSha: "1234567890", error: "git fetch failed"
  });

  assert.match(latest, /ĐÃ Ở BẢN MỚI NHẤT/);
  assert.match(failed, /CẬP NHẬT JOHNTRAN-JS THẤT BẠI/);
  assert.match(failed, /git fetch failed/);
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
