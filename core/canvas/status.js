"use strict";
const fs=require("fs"),os=require("os"),path=require("path"),{createCanvas,loadImage}=require("canvas"),{getBuffer}=require("../runtime/queuedHttp");
const W=1280;
function box(c,x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();c.strokeStyle=stroke||"#20242b";c.lineWidth=2;c.stroke();}
function txt(c,s,x,y,size,color,weight){c.font=(weight||"600")+" "+size+"px Arial";c.fillStyle=color;c.fillText(String(s),x,y);}
function fmt(n){if(!Number.isFinite(n)||n<=0)return "N/A";const u=["B","KB","MB","GB","TB"];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i?1:0)+" "+u[i];}
function percent(n,d){return d?Math.max(0,Math.min(100,Math.round(n/d*100))):0;}
async function renderStatus(o){
 const d=o.device,groups=o.groups||[],h=850,canvas=createCanvas(W,h),c=canvas.getContext("2d");
 const bg=c.createLinearGradient(0,0,W,h);bg.addColorStop(0,"#e8c7d4");bg.addColorStop(1,"#f4d8c0");c.fillStyle=bg;c.fillRect(0,0,W,h);
 box(c,36,28,W-72,h-56,34,"#f7f5f5","#18151b");
 c.save();c.beginPath();c.arc(116,112,48,0,Math.PI*2);c.clip();let av=null;
 if(/^https?:\/\//i.test(o.botAvatar||""))try{const r=await getBuffer(o.botAvatar,{timeout:5000,retries:0});if(r?.buffer?.length<3000000)av=await loadImage(r.buffer);}catch{}
 if(av){const s=Math.max(96/av.width,96/av.height);c.drawImage(av,116-av.width*s/2,112-av.height*s/2, av.width*s,av.height*s);}else{c.fillStyle="#dbe4e7";c.fillRect(68,64,96,96);txt(c,"BOT",88,121,22,"#52616b","700");}c.restore();
 c.strokeStyle="#fff";c.lineWidth=5;c.beginPath();c.arc(116,112,48,0,Math.PI*2);c.stroke();
 txt(c,o.botName,188,105,40,"#261c2d","700");txt(c,"BOT ZALO · THÔNG TIN THIẾT BỊ",190,139,20,"#9064ad","600");txt(c,"●",1060,91,24,"#00b879","700");txt(c,o.version||"",1090,91,24,"#76647b","700");
 box(c,72,168,1136,112,24,"#eeebed");box(c,92,190,62,62,18,"#073c2b","#073c2b");txt(c,"ON",102,229,22,"#00d084","700");txt(c,"TRẠNG THÁI BOT",172,207,19,"#75677b");txt(c,"ĐANG HOẠT ĐỘNG",172,248,33,"#00ad68","700");txt(c,"MÁY CHỦ THỰC TẾ",680,207,19,"#75677b");txt(c,d.hostname+" · "+d.platform+" "+d.release,680,246,23,"#1485b4","700");
 const cards=[{x:72,label:"CPU",value:d.cpuCores+" Cores · "+d.cpuPercent+"%",p:d.cpuPercent,color:"#d88718"},{x:462,label:"RAM",value:fmt(d.ramUsed)+" / "+fmt(d.ramTotal),p:percent(d.ramUsed,d.ramTotal),color:"#009d7a"},{x:852,label:"DISK",value:d.diskTotal?fmt(d.diskUsed)+" / "+fmt(d.diskTotal):"Không hỗ trợ",p:percent(d.diskUsed,d.diskTotal),color:"#9252c8"}];
 for(const a of cards){box(c,a.x,300,356,116,22,"#eeebed");c.beginPath();c.arc(a.x+58,358,34,0,Math.PI*2);c.strokeStyle="#d7d2d5";c.lineWidth=10;c.stroke();c.beginPath();c.arc(a.x+58,358,34,-Math.PI/2,-Math.PI/2+Math.PI*2*a.p/100);c.strokeStyle=a.color;c.lineWidth=10;c.stroke();txt(c,a.p+"%",a.x+31,365,20,a.color,"700");txt(c,a.label,a.x+110,339,19,"#75677b");txt(c,a.value,a.x+110,377,22,"#282333","700");}
 const lower=[{x:72,label:"HỆ ĐIỀU HÀNH",value:d.platform+" "+d.release,color:"#5443b7"},{x:462,label:"TỐC ĐỘ TẢI LÊN",value:d.txKBs==null?"N/A":"↑ "+d.txKBs.toFixed(1)+" KB/s",color:"#0785b5"},{x:852,label:"TỐC ĐỘ TẢI XUỐNG",value:d.rxKBs==null?"N/A":"↓ "+d.rxKBs.toFixed(1)+" KB/s",color:"#9b4bc8"}];
 for(const a of lower){box(c,a.x,438,356,92,20,"#eeebed");txt(c,a.label,a.x+24,472,18,"#75677b");txt(c,a.value,a.x+24,510,23,a.color,"700");}
 box(c,72,550,1136,246,22,"#eeebed");txt(c,"NHÓM ĐÃ BẬT BOT · "+groups.length,98,589,22,"#795e86","700");
 const shown=groups.slice(0,8);if(!shown.length)txt(c,"Chưa có nhóm nào bật. Dùng /mybot on trong nhóm cần kích hoạt.",100,642,20,"#746c73");
 else shown.forEach((a,i)=>{const col=i%2,row=Math.floor(i/2),x=100+col*550,y=632+row*42;txt(c,"●",x,y,17,"#00b879","700");txt(c,a.name,x+28,y,19,"#282333","600");});
 txt(c,"Thông số lấy trực tiếp từ hệ điều hành/container · Không hiển thị uptime",72,824,16,"#8b7a70","400");
 const file=path.join(os.tmpdir(),"johntran_status_"+Date.now()+".png");fs.writeFileSync(file,canvas.toBuffer("image/png"));return file;
}
module.exports={renderStatus};
