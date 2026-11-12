"use strict";

const STYLES = Object.freeze({
  info:"#ffd166", public:"#5dd6e8", music:"#ff7a9c", game:"#ffb454",
  tools:"#63d7ba", test:"#a99bff", anti:"#ff7884", manager:"#75b8ff",
  admin:"#e8c56d", mybot:"#70d8f2", hidden:"#aab8d0"
});

function rgba(hex, alpha) {
  const v=hex.slice(1), r=parseInt(v.slice(0,2),16), g=parseInt(v.slice(2,4),16), b=parseInt(v.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundedRect(ctx,x,y,w,h,r) {
  const q=Math.max(0,Math.min(r,w/2,h/2));
  ctx.beginPath(); ctx.moveTo(x+q,y); ctx.arcTo(x+w,y,x+w,y+h,q);
  ctx.arcTo(x+w,y+h,x,y+h,q); ctx.arcTo(x,y+h,x,y,q); ctx.arcTo(x,y,x+w,y,q); ctx.closePath();
}

function drawInfo(ctx,color) {
  ctx.beginPath(); ctx.arc(32,32,18,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(32,22,2.2,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
  ctx.beginPath(); ctx.moveTo(32,29); ctx.lineTo(32,43); ctx.stroke();
}
function drawPublic(ctx) {
  ctx.beginPath(); ctx.arc(32,32,19,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(32,32,8.5,19,0,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(32,32,18.5,7.5,0,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14,32); ctx.lineTo(50,32); ctx.stroke();
}
function drawMusic(ctx) {
  ctx.beginPath(); ctx.moveTo(36,14); ctx.lineTo(48,11); ctx.lineTo(48,39); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(36,18); ctx.lineTo(48,15); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(27,43,8,5.5,-0.35,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(36,14); ctx.lineTo(36,43); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(43,40,8,5.5,-0.35,0,Math.PI*2); ctx.fill();
}
function drawGame(ctx) {
  ctx.beginPath(); ctx.moveTo(18,22); ctx.quadraticCurveTo(22,17,29,17); ctx.lineTo(43,17);
  ctx.quadraticCurveTo(51,17,54,25); ctx.lineTo(57,40); ctx.quadraticCurveTo(59,49,51,49);
  ctx.quadraticCurveTo(47,49,42,41); ctx.lineTo(22,41); ctx.quadraticCurveTo(17,50,10,48);
  ctx.quadraticCurveTo(5,46,7,39); ctx.lineTo(11,27); ctx.quadraticCurveTo(13,22,18,22);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(19,27); ctx.lineTo(19,37); ctx.moveTo(14,32); ctx.lineTo(24,32); ctx.stroke();
  ctx.beginPath(); ctx.arc(42,28,2.6,0,Math.PI*2); ctx.arc(48,35,2.6,0,Math.PI*2); ctx.fill();
}
function drawTools(ctx) {
  ctx.beginPath(); ctx.moveTo(39,16); ctx.quadraticCurveTo(48,9,55,17); ctx.lineTo(47,25);
  ctx.lineTo(42,20); ctx.lineTo(34,28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(34,28); ctx.lineTo(18,44); ctx.stroke();
  ctx.beginPath(); ctx.arc(15,47,5.5,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(18,44); ctx.lineTo(22,48); ctx.stroke();
}
function drawTest(ctx) {
  roundedRect(ctx,17,13,31,40,5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(25,13); ctx.lineTo(25,10); ctx.lineTo(40,10); ctx.lineTo(40,13); ctx.stroke();
  for(const y of [25,36,47]) { roundedRect(ctx,23,y-3,5,5,1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(33,y); ctx.lineTo(43,y); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(24,36); ctx.lineTo(26,38); ctx.lineTo(30,33); ctx.stroke();
}
function drawAnti(ctx) {
  ctx.beginPath(); ctx.moveTo(32,11); ctx.lineTo(51,18); ctx.lineTo(49,37);
  ctx.quadraticCurveTo(47,48,32,55); ctx.quadraticCurveTo(17,48,15,37); ctx.lineTo(13,18);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(23,32); ctx.lineTo(29,38); ctx.lineTo(42,24); ctx.stroke();
}
function drawManager(ctx) {
  ctx.beginPath(); ctx.arc(25,25,7,Math.PI,0); ctx.stroke();
  ctx.beginPath(); ctx.arc(43,27,6,Math.PI,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12,49); ctx.quadraticCurveTo(13,37,25,37); ctx.quadraticCurveTo(37,37,38,49); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(38,42); ctx.quadraticCurveTo(49,39,53,49); ctx.stroke();
}
function drawAdmin(ctx) {
  ctx.beginPath(); ctx.moveTo(32,10); ctx.lineTo(51,17); ctx.lineTo(49,36); ctx.quadraticCurveTo(46,49,32,56);
  ctx.quadraticCurveTo(18,49,15,36); ctx.lineTo(13,17); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(22,34); ctx.lineTo(19,25); ctx.lineTo(27,30); ctx.lineTo(32,21);
  ctx.lineTo(37,30); ctx.lineTo(45,25); ctx.lineTo(42,34); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(23,39); ctx.lineTo(41,39); ctx.stroke();
}
function drawMyBot(ctx) {
  ctx.beginPath(); ctx.moveTo(32,13); ctx.lineTo(32,19); ctx.stroke();
  ctx.beginPath(); ctx.arc(32,10,3,0,Math.PI*2); ctx.stroke();
  roundedRect(ctx,13,20,38,31,8); ctx.stroke();
  ctx.beginPath(); ctx.arc(24,33,2.5,0,Math.PI*2); ctx.arc(40,33,2.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(24,43); ctx.lineTo(40,43); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8,30); ctx.lineTo(13,30); ctx.moveTo(51,30); ctx.lineTo(56,30); ctx.stroke();
}
function drawHidden(ctx) {
  ctx.beginPath(); ctx.moveTo(10,32); ctx.quadraticCurveTo(32,12,54,32); ctx.quadraticCurveTo(32,52,10,32); ctx.stroke();
  ctx.beginPath(); ctx.arc(32,32,7,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(15,49); ctx.lineTo(49,15); ctx.stroke();
}
function drawFolder(ctx) {
  roundedRect(ctx,11,22,42,30,6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11,26); ctx.lineTo(11,18); ctx.lineTo(28,18); ctx.lineTo(33,23); ctx.lineTo(49,23); ctx.stroke();
}

const DRAWERS=Object.freeze({
  info:drawInfo, public:drawPublic, music:drawMusic, game:drawGame, tools:drawTools,
  test:drawTest, anti:drawAnti, manager:drawManager, admin:drawAdmin, mybot:drawMyBot, hidden:drawHidden
});

function drawCategoryIcon(ctx,slug,centerX,centerY,size) {
  if(!ctx || !Number.isFinite(size) || size<=0) return false;
  const key=String(slug||"").trim().toLowerCase(), color=STYLES[key]||"#75cbd8";
  ctx.save(); ctx.translate(centerX-size/2,centerY-size/2); ctx.scale(size/64,size/64);
  ctx.lineCap="round"; ctx.lineJoin="round";
  roundedRect(ctx,4,4,56,56,16); ctx.fillStyle=rgba(color,0.13); ctx.fill();
  ctx.strokeStyle=rgba(color,0.48); ctx.lineWidth=1.25; ctx.stroke();
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=3.3;
  (DRAWERS[key]||drawFolder)(ctx,color);
  ctx.restore(); return true;
}

module.exports={CATEGORY_ICON_SLUGS:Object.freeze(Object.keys(DRAWERS)),drawCategoryIcon};
