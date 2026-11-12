"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Users = require("../core/runtime/services/userService");
const Threads = require("../core/runtime/services/threadService");

test("user service forwards the legacy controller contract unchanged", async () => {
  const calls = [];
  const expected = { data: { name: "MrQ", ban: false } };
  const controller = {
    getAll: (...args) => { calls.push(["getAll", args]); return [expected]; },
    getData: (...args) => { calls.push(["getData", args]); return Promise.resolve(expected); },
    setData: (...args) => { calls.push(["setData", args]); return "saved"; },
    delData: (...args) => { calls.push(["delData", args]); return true; },
    createData: (...args) => { calls.push(["createData", args]); return "created"; },
    isBanned: (...args) => { calls.push(["isBanned", args]); return false; },
    setBan: (...args) => { calls.push(["setBan", args]); return "ban-updated"; }
  };
  const service = Users.createUserService(controller);
  assert.deepEqual(service.getAll(), [expected]);
  assert.equal(await service.getData("u1"), expected);
  assert.equal(service.setData("u1", expected.data), "saved");
  assert.equal(service.delData("u1"), true);
  assert.equal(service.createData("u2", {}), "created");
  assert.equal(service.isBanned("u1"), false);
  assert.equal(service.setBan("u1", true), "ban-updated");
  assert.deepEqual(calls, [
    ["getAll", []], ["getData", ["u1"]], ["setData", ["u1", expected.data]],
    ["delData", ["u1"]], ["createData", ["u2", {}]], ["isBanned", ["u1"]],
    ["setBan", ["u1", true]]
  ]);
});

test("thread service preserves normalized controller return values and promises", async () => {
  const calls = [];
  const record = { id: "g1", threadId: "g1", data: { prefix: "!" } };
  const controller = {
    getAll: (...args) => { calls.push(["getAll", args]); return [record]; },
    getData: (...args) => { calls.push(["getData", args]); return Promise.resolve(record); },
    setData: (...args) => { calls.push(["setData", args]); return Promise.resolve("saved"); },
    delData: (...args) => { calls.push(["delData", args]); return true; },
    createData: (...args) => { calls.push(["createData", args]); return Promise.resolve(record); }
  };
  const service = Threads.createThreadService(controller);
  assert.deepEqual(service.getAll(), [record]);
  assert.equal(await service.getData("g1"), record);
  assert.equal(await service.setData("g1", record.data), "saved");
  assert.equal(service.delData("g1"), true);
  assert.equal(await service.createData("g1", record.data), record);
  assert.deepEqual(calls, [
    ["getAll", []], ["getData", ["g1"]], ["setData", ["g1", record.data]],
    ["delData", ["g1"]], ["createData", ["g1", record.data]]
  ]);
});

test("service factories reject missing controllers instead of failing later", () => {
  assert.throws(() => Users.createUserService(null), /controller is required/);
  assert.throws(() => Threads.createThreadService(undefined), /controller is required/);
});
