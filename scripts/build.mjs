#!/usr/bin/env node
// build.mjs — 互联网漫游指南 构建脚本（零依赖，Node >= 18）
// 读取 data/ 下的窗、墓、世界地理数据 + src/template.html，生成单文件 index.html
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// ---- 1. 世界地图：GeoJSON → SVG path（等距圆柱投影，1000x500） ----
const W = 1000, H = 500;
const px = (lon) => (((lon + 180) / 360) * W).toFixed(1);
const py = (lat) => (((90 - lat) / 180) * H).toFixed(1);

function ringToPath(ring) {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    d += (i === 0 ? "M" : "L") + px(lon) + "," + py(lat);
  }
  return d + "Z";
}
function geomToPath(geom) {
  if (!geom) return "";
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let d = "";
  for (const poly of polys) for (const ring of poly) d += ringToPath(ring);
  return d;
}

const geo = JSON.parse(read("data/world-geo.json"));
const land = geo.features.map((f) => geomToPath(f.geometry)).join("");

// 经纬网（每 30° 一根细线）
let grid = "";
for (let lon = -150; lon <= 150; lon += 30) grid += `M${px(lon)},0L${px(lon)},${H}`;
for (let lat = -60; lat <= 60; lat += 30) grid += `M0,${py(lat)}L${W},${py(lat)}`;

// ---- 2. 数据注入 ----
const windows = JSON.parse(read("data/windows.json"));
const gravesDoc = JSON.parse(read("data/graves.json"));

// 给每个窗算好地图坐标，注入前端
const windowsWithXY = windows.map((w) => ({
  ...w,
  x: +px(w.anchor.lon),
  y: +py(w.anchor.lat),
}));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 秘境名录（静态渲染）
const entriesHtml = windows
  .map(
    (w, i) => `
      <article class="entry${i % 2 ? " entry--offset" : ""}">
        <div class="entry__no">${String(i + 1).padStart(2, "0")}</div>
        <div class="entry__body">
          <h3><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a></h3>
          <div class="entry__host">${esc(w.host)}</div>
          <p>${esc(w.blurb)}</p>
          <div class="entry__meta">⚑ ${esc(w.anchor.label)} · 存活验证 ${esc(w.verified)}</div>
        </div>
      </article>`
  )
  .join("");

// 讣告墙（静态渲染）
const gravesHtml = gravesDoc.graves
  .map(
    (g) => `
      <div class="tomb${g.fresh ? " tomb--fresh" : ""}">
        ${g.fresh ? '<div class="tomb__new">今日新立</div>' : ""}
        <div class="r-ip">R.I.P.</div>
        <h3>${esc(g.name)}</h3>
        <div class="years">${esc(g.years)}</div>
        <p>${esc(g.epitaph)}</p>
      </div>`
  )
  .join("");

// ---- 3. 模板渲染 ----
const tpl = read("src/template.html");
const html = tpl
  .replace("__MAP_LAND__", land)
  .replace("__MAP_GRID__", grid)
  .replace("__WINDOWS_JSON__", JSON.stringify(windowsWithXY))
  .replace("__ENTRIES__", entriesHtml)
  .replace("__GRAVES__", gravesHtml)
  .replace("__MISSING_NOTE__", esc(gravesDoc.missing))
  .replaceAll("__BUILD_DATE__", new Date().toISOString().slice(0, 10));

writeFileSync(join(root, "index.html"), html);
console.log(`✓ index.html 生成：${windows.length} 扇窗 / ${gravesDoc.graves.length} 座碑 / 陆地路径 ${(land.length / 1024).toFixed(0)}KB / 总计 ${(html.length / 1024).toFixed(0)}KB`);
