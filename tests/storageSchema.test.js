"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {STORE_SCHEMA_VERSION,STORE_TABLES,normalizeStoreData,countStoreRecords}=require("../src/infrastructure/storage/schema");
test("all runtime collections are declared centrally",()=>{
 assert.equal(STORE_SCHEMA_VERSION,1);
 assert.deepEqual(STORE_TABLES,["Users","Threads","Metrics","BotStats","MediaCache"]);
});
test("legacy records are preserved and missing collections are initialized",()=>{
 const users={u1:{userId:"u1",data:{balance:10},legacyField:true}};
 const threads={g1:{threadId:"g1",data:{bot_enabled:true}}};
 const result=normalizeStoreData({Users:users,Threads:threads});
 assert.equal(result.Users,users);
 assert.equal(result.Threads,threads);
 assert.deepEqual(result.Metrics,{});
 assert.deepEqual(result.BotStats,{});
 assert.deepEqual(result.MediaCache,{});
 assert.equal(result.Users.u1.legacyField,true);
 assert.equal(countStoreRecords(result),2);
});
test("invalid roots and collection shapes are rejected",()=>{
 assert.throws(()=>normalizeStoreData([]),/Cấu trúc database JSON không hợp lệ/);
 assert.throws(()=>normalizeStoreData({Threads:[]}),/Bảng Threads không phải object hợp lệ/);
 assert.throws(()=>normalizeStoreData({Users:"invalid"}),/Bảng Users không phải object hợp lệ/);
});
