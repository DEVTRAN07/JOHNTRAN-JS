"use strict";
const os=require("os"),fs=require("fs"),{execFile}=require("child_process"),{promisify}=require("util");
const run=promisify(execFile);
function cpuSnap(){return os.cpus().map(c=>({...c.times}));}
function netSnap(){try{let rx=0,tx=0;for(const line of fs.readFileSync("/proc/net/dev","utf8").trim().split("\n").slice(2)){const p=line.trim().split(":");if(p[0].trim()==="lo"||!p[1])continue;const v=p[1].trim().split(/\s+/).map(Number);rx+=v[0]||0;tx+=v[8]||0;}return {rx,tx};}catch{return null;}}
async function disk(){try{if(process.platform!=="win32"){const r=await run("df",["-Pk","/"],{timeout:2500});const a=r.stdout.trim().split("\n").pop().trim().split(/\s+/);return {total:Number(a[1])*1024,used:Number(a[2])*1024};}}catch{}try{const s=await fs.promises.statfs("/");return {total:Number(s.blocks)*Number(s.bsize),used:(Number(s.blocks)-Number(s.bfree))*Number(s.bsize)};}catch{return null;}}
async function collectDeviceMetrics(){
 const cpus0=cpuSnap(),net0=netSnap();await new Promise(r=>setTimeout(r,400));const cpus1=cpuSnap(),net1=netSnap();
 let total=0,idle=0;for(let i=0;i<Math.min(cpus0.length,cpus1.length);i++){const a=cpus0[i],b=cpus1[i];const dt=Object.keys(b).reduce((s,k)=>s+(b[k]-a[k]),0);total+=dt;idle+=b.idle-a.idle;}
 const d=await disk(),mem=os.totalmem(),used=mem-os.freemem();
 return {hostname:os.hostname(),platform:os.platform(),release:os.release(),arch:os.arch(),cpuModel:os.cpus()[0]?.model||"Unknown",cpuCores:os.cpus().length,cpuPercent:total?Math.round(Math.max(0,Math.min(100,100*(1-idle/total)))):0,ramTotal:mem,ramUsed:used,diskTotal:d?.total||0,diskUsed:d?.used||0,rxKBs:net0&&net1?Math.max(0,(net1.rx-net0.rx)/409.6):null,txKBs:net0&&net1?Math.max(0,(net1.tx-net0.tx)/409.6):null,processRam:process.memoryUsage().rss,node:process.version};
}
module.exports={collectDeviceMetrics};
