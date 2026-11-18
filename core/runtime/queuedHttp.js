"use strict";

const { enqueue } = require("../jobQueue");
const http = require("../http");

const HTTP_LANE = "http";
const ASSET_LANE = "asset";
const DOWNLOAD_LANE = "download";

function labelFor(rawUrl, action) {
  try {
    return `${action} ${new URL(rawUrl).hostname}`.slice(0, 64);
  } catch {
    return action;
  }
}

function splitQueueOptions(options = {}) {
  const {
    queueKey,
    queueLane,
    queuePriority,
    ...requestOptions
  } = options || {};
  return {
    requestOptions,
    key: queueKey == null ? undefined : String(queueKey),
    lane: queueLane === ASSET_LANE ? ASSET_LANE : DOWNLOAD_LANE,
    priority: Number.isFinite(Number(queuePriority)) ? Number(queuePriority) : 0
  };
}

// Binary payloads use a bounded download lane. Small avatar/frame assets can
// opt into their own lane so a long video download cannot block card rendering.
function getBuffer(url, options = {}) {
  const queue = splitQueueOptions(options);
  return enqueue(queue.lane, () => http.getBuffer(url, queue.requestOptions), {
    key: queue.key,
    priority: queue.priority,
    label: labelFor(url, "Tải media")
  });
}

// JSON and ordinary HTTP requests are control-plane work. They have a separate
// concurrency budget and priority so metadata lookups are not stuck behind
// long-running media transfers.
function getJson(url, options = {}) {
  const queue = splitQueueOptions(options);
  return enqueue(HTTP_LANE, () => http.getJson(url, queue.requestOptions), {
    key: queue.key,
    priority: queue.priority || 5,
    label: labelFor(url, "Lấy dữ liệu")
  });
}

function request(url, options = {}) {
  const queue = splitQueueOptions(options);
  return enqueue(HTTP_LANE, () => http.request(url, queue.requestOptions), {
    key: queue.key,
    priority: queue.priority || 5,
    label: labelFor(url, "Request")
  });
}

module.exports = { getBuffer, getJson, request, HTTP_LANE, ASSET_LANE, DOWNLOAD_LANE };
