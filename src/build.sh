#!/bin/sh
# Inline the engine, worker glue and GPU preview into the page:
# src/app.html + src/engine.js + src/worker.js + src/gpu.js -> comput.html (Claude artifact) and docs/comput/index.html (brangic.studio/comput)
cd "$(dirname "$0")/.."
node -e '
const fs=require("fs"), rd=(f)=>fs.readFileSync(f,"utf8");
const out=rd("src/app.html").replace("/*ENGINE*/",()=>rd("src/engine.js")).replace("/*WORKER*/",()=>rd("src/worker.js").replace(/<\/script/gi,"<\\/script")).replace("/*GPU*/",()=>rd("src/gpu.js")).replace("/*PROMPTS*/",()=>rd("src/prompts.js"));
fs.writeFileSync("comput.html", out);
fs.writeFileSync("docs/comput/index.html", "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1,viewport-fit=cover\"></head><body>"+out+"</body></html>");
'
echo built
