"use strict";
const STORE_SCHEMA_VERSION=1;
const STORE_TABLES=Object.freeze(["Users","Threads","Metrics","BotStats","MediaCache"]);
function isPlainObject(value){
 if(value===null||typeof value!=="object"||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 return proto===Object.prototype||proto===null;
}
function normalizeStoreData(input,tableNames=STORE_TABLES){
 if(!isPlainObject(input))throw new Error("Cấu trúc database JSON không hợp lệ");
 const output={};
 for(const name of tableNames){
  const value=input[name];
  if(value!=null&&!isPlainObject(value))throw new Error("Bảng "+name+" không phải object hợp lệ");
  output[name]=value||{};
 }
 return output;
}
function countStoreRecords(data,tableNames=Object.keys(data||{})){
 let count=0;
 for(const name of tableNames){const table=data?.[name];if(isPlainObject(table))count+=Object.keys(table).length;}
 return count;
}
module.exports={STORE_SCHEMA_VERSION,STORE_TABLES,isPlainObject,normalizeStoreData,countStoreRecords};
