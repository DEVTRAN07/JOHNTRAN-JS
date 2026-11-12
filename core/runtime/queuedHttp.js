"use strict";

const { enqueue } = require("../jobQueue");
const http = require("../http");

function labelFor(rawUrl, action) {
  try {
    return `${action} ${new URL(rawUrl).hostname}`.slice(0, 64);
  } catch {
    return action;
  }
}

function getBuffer(url, options = {}) {
  return enqueue("download", () => http.getBuffer(url, options), {
    key: options.queueKey || undefined,
    label: labelFor(url, "Tải media")
  });
}

function getJson(url, options = {}) {
  return enqueue("download", () => http.getJson(url, options), {
    key: options.queueKey || undefined,
    label: labelFor(url, "Lấy dữ liệu")
  });
}

function request(url, options = {}) {
  return enqueue("download", () => http.request(url, options), {
    key: options.queueKey || undefined,
    label: labelFor(url, "Request")
  });
}

module.exports = { getBuffer, getJson, request };
