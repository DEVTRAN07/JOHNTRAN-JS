"use strict";
const fs=require("fs"),stats=require("../../core/stats"),{collectDeviceMetrics}=require("../../core/runtime/deviceMetrics");
module.exports.config={name:"status",aliases:["tinhtrang","system"],version:"2.0.0",role:0,author:"JOHNTRAN",description:"Bảng trạng thái bot và thiết bị theo thiết kế chuẩn",category:"MyBot",usage:"status",cooldowns:8,dependencies:{canvas:""}};
async function currentGroup(api,event,Threads){
 const id=String(event?.threadId||"");
 let name=event?.type===1?"Tin nhắn riêng":"Nhóm hiện tại";
 let enabled=false;
 try{const row=await Threads.getData(id);enabled=row?.data?.bot_enabled!==false;}catch{enabled=true;}
 try{const info=await api.getGroupInfo(id);name=info?.gridInfoMap?.[id]?.name||name;}catch{}
 return {name,id,enabled};
}
function formatUptime(seconds){
 let n=Math.max(0,Math.floor(Number(seconds)||0));
 const days=Math.floor(n/86400);n%=86400;const hours=Math.floor(n/3600);
 return (days?days+" ngày ":"")+hours+" giờ";
}
module.exports.run=async function({api,event,Threads,reply}){
 let imagePath;
 try{
  const [profile,device,group]=await Promise.all([
   stats.getProfile(api).catch(()=>null),collectDeviceMetrics(),currentGroup(api,event,Threads)
  ]);
  imagePath=await require("../../core/canvas/status").renderStatus({
   botName:profile?.displayName||global.config?.name_bot||"JOHNTRAN",
   botAvatar:profile?.avatar||"",device,group,
   uptime:formatUptime(process.uptime()),version:require("../../package.json").version
  });
  return await api.sendMessage({msg:"",attachments:[imagePath],ttlKind:"card"},event.threadId,event.type);
 }catch(e){
  console.error("[STATUS]",e?.stack||e);
  const msg="Không thể tạo bảng status: "+(e?.message||"Lỗi");
  return reply?.error?reply.error(msg):api.sendMessage({msg},event.threadId,event.type);
 }finally{
  if(imagePath){const t=setTimeout(()=>{try{fs.rmSync(imagePath,{force:true});}catch{}},60000);t.unref?.();}
 }
};
module.exports._test={currentGroup,formatUptime};
