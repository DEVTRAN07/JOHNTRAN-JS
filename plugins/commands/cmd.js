"use strict";
const path=require("path"),fs=require("fs");
const loaderCommand=require("../../core/loader/loaderCommand");
const folderMenu=require("../../core/runtime/folderMenu");
const {invalidate}=require("../../core/runtime/commandRegistry");
module.exports.config={name:"command",aliases:["cmd"],version:"2.0.0",role:2,author:"JOHNTRAN",description:"Quản lý lệnh theo cấu trúc menu mới",category:"MyBot",usage:"cmd <list|folders|info|load|unload|reload>",cooldowns:2};
function send(api,event,msg){return api.sendMessage({msg},event.threadId,event.type);}
function findCommand(name){const key=String(name||"").toLowerCase();for(const [id,mod] of global.client.commands){if(id===key||mod?.config?.name===key||(mod?.config?.aliases||[]).includes(key))return {id,mod};}return null;}
module.exports.run=async function({api,event,args}){
 const action=String(args[0]||"help").toLowerCase(),name=String(args[1]||"").toLowerCase();
 if(!global.users?.admin?.includes(String(event?.data?.uidFrom||"")))return send(api,event,"Bạn không có quyền quản lý lệnh.");
 const prefix=global.config?.prefix||"/";
 if(action==="list"){
  const groups=folderMenu.collectMenuGroups(global.client.commands,event.data.uidFrom);
  const lines=groups.map(g=>"📂 "+g.name+" · "+g.count+" lệnh · "+prefix+g.slug);
  return send(api,event,"JOHNTRAN · COMMAND CENTER\n"+lines.join("\n")+"\n\nTổng: "+groups.reduce((n,g)=>n+g.count,0)+" lệnh");
 }
 if(action==="folders")return send(api,event,folderMenu.renderAllCommands(folderMenu.collectAllCommands(global.client.commands,event.data.uidFrom),prefix,global.config?.name_bot||"JOHNTRAN",require("../../package.json").version));
 if(action==="info"){
  if(!name)return send(api,event,"Dùng: /cmd info <tên lệnh>");
  const found=findCommand(name);if(!found)return send(api,event,"Không tìm thấy lệnh: "+name);
  const c=found.mod.config;return send(api,event,"THÔNG TIN LỆNH\nTên: "+c.name+"\nNhóm menu: "+folderMenu.menuGroupForCommand(found.mod)+"\nMô tả: "+(c.description||"") +"\nQuyền: "+c.role+"\nCú pháp: "+prefix+(c.usage||c.name)+"\nPhiên bản: "+(c.version||""));
 }
 if(action==="load"||action==="reload"){
  if(!name||!/^[a-z0-9_-]+$/i.test(name))return send(api,event,"Dùng: /cmd load <tên file lệnh>");
  const p=path.join(__dirname,name+".js");if(!fs.existsSync(p))return send(api,event,"Không tìm thấy plugins/commands/"+name+".js");
  const result=await loaderCommand(name);invalidate(global.client.commands);
  return send(api,event,result.status===false?"Tải thất bại: "+result.error:"Đã "+(action==="reload"?"nạp lại":"tải")+" lệnh "+name+".");
 }
 if(action==="unload"){
  const found=findCommand(name);if(!found)return send(api,event,"Lệnh chưa được tải: "+name);
  global.client.commands.delete(found.id);delete require.cache[require.resolve(path.join(__dirname,found.id+".js"))];invalidate(global.client.commands);
  return send(api,event,"Đã gỡ lệnh "+found.id+".");
 }
 return send(api,event,"JOHNTRAN · COMMAND CENTER\n/cmd list — Danh sách thư mục menu mới\n/cmd folders — Toàn bộ lệnh\n/cmd info <lệnh> — Chi tiết lệnh\n/cmd load <file> — Tải lệnh\n/cmd reload <file> — Nạp lại lệnh\n/cmd unload <lệnh> — Gỡ lệnh");
};
