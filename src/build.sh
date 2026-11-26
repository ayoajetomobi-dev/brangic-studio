#!/bin/sh
# Inline the engine into the page: src/app.html + src/engine.js -> comput.html (Claude artifact) and docs/comput/index.html (brangic.studio/comput)
cd "$(dirname "$0")/.."
node -e '
const fs=require("fs");
const html=fs.readFileSync("src/app.html","utf8"), eng=fs.readFileSync("src/engine.js","utf8");
const out=html.replace("/*ENGINE*/", ()=>eng);
fs.writeFileSync("comput.html", out);
fs.writeFileSync("docs/comput/index.html", "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1,viewport-fit=cover\"></head><body>"+out+"</body></html>");
'
echo built
