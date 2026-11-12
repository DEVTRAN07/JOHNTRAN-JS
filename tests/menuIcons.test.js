"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createCanvas } = require("canvas");
const { CATEGORY_ICON_SLUGS, drawCategoryIcon } = require("../core/canvas/menuIcons");

test("all folder categories render clean vector icons at menu size", () => {
  assert.deepEqual(CATEGORY_ICON_SLUGS, ["info","public","music","game","tools","test","anti","manager","admin","mybot","hidden"]);
  for (const slug of CATEGORY_ICON_SLUGS) {
    const canvas=createCanvas(80,80), ctx=canvas.getContext("2d");
    assert.equal(drawCategoryIcon(ctx,slug,40,40,38),true,slug);
    const pixels=ctx.getImageData(0,0,80,80).data;
    let visible=0;
    for(let i=3;i<pixels.length;i+=4) if(pixels[i]>0) visible++;
    assert.ok(visible>100,`icon ${slug} must render visible pixels`);
  }
});

test("unknown folders get a visible generic icon and invalid sizes are ignored", () => {
  const canvas=createCanvas(80,80), ctx=canvas.getContext("2d");
  assert.equal(drawCategoryIcon(ctx,"future-folder",40,40,54),true);
  const pixels=ctx.getImageData(0,0,80,80).data;
  assert.ok(pixels.some((value,index)=>index%4===3&&value>0));
  assert.equal(drawCategoryIcon(ctx,"info",40,40,0),false);
});
