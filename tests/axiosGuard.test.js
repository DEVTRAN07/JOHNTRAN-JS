"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("Axios privacy guard normalizes relative URLs against baseURL", () => {
  global.config = { privacy: { allow_all_hosts: true, allowed_hosts: [] }, services: {} };

  const { pooledAxios } = require("../core/http/pooledAxios");
  const { installAxiosGuard } = require("../core/http/axios");
  installAxiosGuard();

  const handler = pooledAxios.interceptors.request.handlers.find(item => item && item.fulfilled)?.fulfilled;
  assert.equal(typeof handler, "function");

  const config = handler({
    url: "/api/media?x=1",
    baseURL: "https://api.example.test"
  });

  assert.equal(config.url, "https://api.example.test/api/media?x=1");
});
