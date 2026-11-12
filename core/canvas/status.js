"use strict";
const fs=require("fs"),os=require("os"),path=require("path"),{createCanvas}=require("canvas"),avatarCache=require("./avatarCache");
const W=1280,H=640;
const C={ink:"#211b2a",muted:"#776b80",purple:"#9364b2",green:"#00b96b",blue:"#078dbb",orange:"#d48618",teal:"#009d7a",violet:"#9b4acb",panel:"#f0edef",line:"#17131c"};
function rounded(c,x,y,w,h,r,fill,stroke=C.line,lw=1.7){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}}
function text(c,s,x,y,size,color=C.ink,weight="600",align="left"){c.font=weight+" "+size+"px Arial, sans-serif";c.fillStyle=color;c.textBaseline="alphabetic";c.textAlign=align;c.fillText(String(s??""),x,y);c.textAlign="left";}
function fmt(n){if(!Number.isFinite(Number(n))||Number(n)<=0)return "N/A";let v=Number(n),u=["B","KB","GB","TB"];let i=0;while(v>=1024&&i<u.length-1){v/=1024;i++;}return v.toFixed(i?1:0)+" "+u[i];}
function pct(n,d){return d>0?Math.max(0,Math.min(100,Math.round(n/d*100))):0;}
function icon(c,type,x,y,color){
 c.save();c.translate(x,y);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=3;c.lineCap="round";c.lineJoin="round";
 if(type==="power"){c.beginPath();c.arc(0,0,13,.25*Math.PI,2.75*Math.PI);c.stroke();c.beginPath();c.moveTo(0,-19);c.lineTo(0,-2);c.stroke();}
 else if(type==="clock"){c.beginPath();c.arc(0,0,14,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(0,-8);c.lineTo(0,1);c.lineTo(7,6);c.stroke();}
 else if(type==="monitor"){c.strokeRect(-14,-10,28,19);c.beginPath();c.moveTo(-7,14);c.lineTo(7,14);c.moveTo(0,9);c.lineTo(0,14);c.stroke();}
 else if(type==="up"||type==="down"){c.beginPath();c.moveTo(0,14);c.lineTo(0,-13);c.moveTo(-9,-4);c.lineTo(0,-13);c.lineTo(9,-4);c.stroke();if(type==="down")c.rotate(Math.PI);}
 else {c.beginPath();c.arc(0,0,11,0,Math.PI*2);c.stroke();}
 c.restore();
}
function metricCard(c,x,y,w,label,value,p,color){
 rounded(c,x,y,w,112,23,C.panel);
 c.beginPath();c.arc(x+53,y+57,30,0,Math.PI*2);c.strokeStyle="#d9d3d9";c.lineWidth=9;c.stroke();
 c.beginPath();c.arc(x+53,y+57,30,-Math.PI/2,-Math.PI/2+Math.PI*2*p/100);c.strokeStyle=color;c.lineWidth=9;c.lineCap="butt";c.stroke();
 text(c,p+"%",x+30,y+64,21,color,"700");
 text(c,label,x+105,y+40,18,C.muted,"700");text(c,value,x+105,y+79,25,C.ink,"700");
}
async function renderStatus(o){
 const d=o.device||{},g=o.group||{},canvas=createCanvas(W,H),c=canvas.getContext("2d");
 const bg=c.createLinearGradient(0,0,W,H);bg.addColorStop(0,"#f4c5b8");bg.addColorStop(.5,"#e6b9d1");bg.addColorStop(1,"#f3cbb4");c.fillStyle=bg;c.fillRect(0,0,W,H);
 c.save();c.shadowColor="rgba(38,20,36,.28)";c.shadowBlur=28;c.shadowOffsetY=12;rounded(c,36,36,1208,568,34,"#f8f6f7",C.line,1.6);c.restore();
 // Header: avatar thật, tên bot, nhóm hiện tại và phiên bản
 c.save();c.beginPath();c.arc(120,105,45,0,Math.PI*2);c.clip();
 const av=avatarCache.getAvatar(o.botAvatar);
 if(av){const s=Math.max(90/av.width,90/av.height);c.drawImage(av,120-av.width*s/2,105-av.height*s/2,av.width*s,av.height*s);}
 else{c.fillStyle="#d9e1e2";c.fillRect(75,60,90,90);text(c,"BOT",96,114,22,"#59636b","700");}
 c.restore();c.beginPath();c.arc(120,105,46,0,Math.PI*2);c.strokeStyle="#fff";c.lineWidth=4;c.stroke();c.beginPath();c.arc(151,137,12,0,Math.PI*2);c.fillStyle="#00c879";c.fill();c.strokeStyle="#fff";c.lineWidth=2;c.stroke();
 text(c,o.botName||"JOHNTRAN",188,104,39,C.ink,"700");
 text(c,"♟ Nhóm: "+(g.name||"Tin nhắn riêng")+" ▤",188,135,22,C.purple,"700");
 text(c,"◉",1040,83,27,C.muted,"700");text(c,"▣",1080,83,25,C.muted,"700");text(c,"v"+(o.version||""),1208,82,22,C.muted,"700","right");
 // Status + uptime (uptime card stays in the reference design; /upt command is separate)
 rounded(c,72,169,558,107,24,C.panel);rounded(c,650,169,558,107,24,C.panel);
 rounded(c,92,191,63,63,18,"#073d2c","#073d2c");icon(c,"power",123,222,C.green);
 text(c,"♧ TRẠNG THÁI NHÓM",172,207,19,C.muted,"700");
 const stateColor=g.enabled?C.green:"#d84b54";
 rounded(c,416,195,178,55,16,g.enabled?"#e5f7ed":"#fdebed",g.enabled?"#a9ddbe":"#f2b9be",1.4);
 text(c,g.enabled?"ĐANG BẬT":"ĐANG TẮT",505,229,22,stateColor,"700","center");
 rounded(c,670,191,63,63,18,"#102f3e","#102f3e");icon(c,"clock",701,222,C.blue);
 text(c,"◷ UPTIME HOẠT ĐỘNG",750,207,19,C.muted,"700");text(c,o.uptime||"N/A",750,251,34,C.blue,"700");
 // CPU / RAM / DISK
 metricCard(c,72,291,367,"⚙ VI XỬ LÝ (CPU)",(d.cpuCores||0)+" Cores · "+(Number(d.cpuPercent)||0).toFixed(1)+"%",Math.round(Number(d.cpuPercent)||0),C.orange);
 metricCard(c,456,291,367,"▣ BỘ NHỚ (RAM)",fmt(d.ramUsed)+" / "+fmt(d.ramTotal),pct(d.ramUsed,d.ramTotal),C.teal);
 metricCard(c,840,291,367,"▤ Ổ CỨNG (DISK)",d.diskTotal?fmt(d.diskUsed)+" / "+fmt(d.diskTotal):"N/A",pct(d.diskUsed,d.diskTotal),C.violet);
 // OS and network
 const lower=[{x:72,label:"HỆ ĐIỀU HÀNH",value:(d.platform==="win32"?"Windows":d.platform==="darwin"?"macOS":d.platform||"OS")+" "+(d.release||""),type:"monitor",color:"#5145b9"},{x:456,label:"TỐC ĐỘ TẢI LÊN",value:d.txKBs==null?"N/A":"↑ "+Number(d.txKBs).toFixed(1)+" KB/s",type:"up",color:C.blue},{x:840,label:"TỐC ĐỘ TẢI XUỐNG",value:d.rxKBs==null?"N/A":"↓ "+Number(d.rxKBs).toFixed(1)+" KB/s",type:"down",color:C.violet}];
 for(const a of lower){rounded(c,a.x,417,367,94,21,C.panel);rounded(c,a.x+16,438,53,53,15,"#202033","#202033");icon(c,a.type,a.x+42,464,a.color);text(c,a.label,a.x+83,452,17,C.muted,"700");text(c,a.value,a.x+83,487,25,a.color,"700");}
 // Footer help text as in the supplied reference
 rounded(c,72,527,1136,51,17,"#f4f1f3");text(c,"ⓘ",91,561,22,C.purple,"700");
 text(c,"Quản trị viên có thể dùng lệnh !off để tạm dừng hoặc !on để kích hoạt bot trong nhóm.",123,561,20,C.muted,"700");
 const file=path.join(os.tmpdir(),"johntran_status_"+Date.now()+".png");await fs.promises.writeFile(file,canvas.toBuffer("image/png"));return file;
}
module.exports={renderStatus};
