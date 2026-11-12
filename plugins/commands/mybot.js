"use strict";
const {ThreadType}=require("zalo-client");
module.exports.config={name:"mybot",aliases:["botme"],version:"1.0.0",role:0,author:"JOHNTRAN",description:"Bật/tắt bot theo nhóm và xem các nhóm đã kích hoạt",category:"MyBot",usage:"mybot <on|off|groups|help>",cooldowns:2};
async function send(api,event,reply,msg){return reply?.info?reply.info(msg):api.sendMessage({msg},event.threadId,event.type);}
async function groupName(api,id){try{const r=await api.getGroupInfo(String(id));return r?.gridInfoMap?.[String(id)]?.name||"Nhóm chưa rõ tên";}catch{return "Nhóm chưa rõ tên";}}
module.exports.run=async function({api,event,args,Threads,reply}){
 const action=String(args[0]||"help").toLowerCase(),group=event?.type===ThreadType.Group;
 if(action==="on"||action==="off"){
  if(!group)return send(api,event,reply,"Lệnh bật/tắt chỉ dùng trong nhóm.");
  const uid=String(event?.data?.uidFrom||"");
  let allowed=Boolean(global.users?.admin?.includes(uid));
  try{const info=await api.getGroupInfo(String(event.threadId));const g=info?.gridInfoMap?.[String(event.threadId)]||{};const admins=(g.adminIds||g.admins||[]).map(x=>String(x.uid||x));allowed=allowed||String(g.creatorId||"")===uid||admins.includes(uid);}catch{}
  if(!allowed)return send(api,event,reply,"Chỉ quản trị viên nhóm hoặc admin bot mới được bật/tắt bot.");
  const r=await Threads.getData(String(event.threadId)),d={...(r?.data||{}),bot_enabled:action==="on",bot_enabled_at:action==="on"?Date.now():null};
  await Threads.setData(String(event.threadId),d);
  return send(api,event,reply,action==="on"?"Đã bật bot trong nhóm này. Nhóm sẽ xuất hiện trong /status.":"Đã tắt bot trong nhóm này.");
 }
 if(action==="groups"||action==="list"){
  const rows=(Threads.getAll()||[]).filter(x=>x?.data?.bot_enabled===true);
  if(!rows.length)return send(api,event,reply,"Chưa có nhóm nào bật bot. Dùng /mybot on trong nhóm cần kích hoạt.");
  const lines=await Promise.all(rows.slice(0,30).map(async(x,i)=>(i+1)+". "+await groupName(api,x.threadId)+" · "+x.threadId));
  return send(api,event,reply,"NHÓM ĐANG BẬT BOT · "+rows.length+"\n\n"+lines.join("\n"));
 }
 return send(api,event,reply,"MYBOT\n/mybot on — Bật bot trong nhóm hiện tại\n/mybot off — Tắt bot trong nhóm hiện tại\n/mybot groups — Xem các nhóm đã bật\n/status — Xem trạng thái bot và thiết bị máy chủ");
};
module.exports._test={groupName};
