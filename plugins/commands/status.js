"use strict";
const fs=require("fs"),stats=require("../../core/stats"),{collectDeviceMetrics}=require("../../core/runtime/deviceMetrics");
module.exports.config={name:"status",aliases:["tinhtrang","system"],version:"1.0.0",role:0,author:"JOHNTRAN",description:"Thông tin thiết bị thật đang chạy bot và các nhóm đã bật",category:"MyBot",usage:"status",cooldowns:8,dependencies:{canvas:""}};
async function groupNames(api,Threads){const rows=(Threads.getAll()||[]).filter(x=>x?.data?.bot_enabled===true);return Promise.all(rows.slice(0,20).map(async x=>{let name="Nhóm chưa rõ tên";try{const r=await api.getGroupInfo(String(x.threadId));name=r?.gridInfoMap?.[String(x.threadId)]?.name||name;}catch{}return {name,id:String(x.threadId)};}));}
module.exports.run=async function({api,event,Threads,reply}){
 let imagePath;
 try{
  const values=await Promise.all([stats.getProfile(api).catch(()=>null),collectDeviceMetrics(),groupNames(api,Threads)]);
  const profile=values[0],device=values[1],groups=values[2];
  imagePath=await require("../../core/canvas/status").renderStatus({botName:profile?.displayName||global.config?.name_bot||"JOHNTRAN",botAvatar:profile?.avatar||"",device,groups,version:require("../../package.json").version});
  return await api.sendMessage({msg:"",attachments:[imagePath],ttlKind:"card"},event.threadId,event.type);
 }catch(e){console.error("[STATUS]",e?.stack||e);const msg="Không thể tạo bảng status: "+(e?.message||"Lỗi");return reply?.error?reply.error(msg):api.sendMessage({msg},event.threadId,event.type);}
 finally{if(imagePath){const t=setTimeout(()=>{try{fs.rmSync(imagePath,{force:true});}catch{}},60000);t.unref?.();}}
};
module.exports._test={groupNames};
