#!/usr/bin/env node
// build.mjs — 互联网漫游指南 构建脚本（零依赖，Node >= 18）
// 读取 data/ 下的窗、墓、世界地理数据 + src/template.html，生成单文件 index.html
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// ---- 1. 世界地图：GeoJSON → SVG path（罗宾逊投影 Robinson 1963，1600x820 全景） ----
// 罗宾逊投影：经纬线都是曲线的拟圆柱投影，国家地理用了二十年的那种。
// 系数表每 5° 纬度一档：[X 经向伸缩, Y 纬向位置]
const ROB = [
  [1, 0], [0.9986, 0.062], [0.9954, 0.124], [0.99, 0.186], [0.9822, 0.248],
  [0.973, 0.31], [0.96, 0.372], [0.9427, 0.434], [0.9216, 0.4958],
  [0.8962, 0.5571], [0.8679, 0.6176], [0.835, 0.6769], [0.7986, 0.7346],
  [0.7597, 0.7903], [0.7186, 0.8435], [0.6732, 0.8936], [0.6213, 0.9394],
  [0.5722, 0.9761], [0.5322, 1],
];
const W = 1600, H = 820, PAD = 46;
const KX = 0.8487, KY = 1.3523; // 罗宾逊标准常数
const S = Math.min((W - 2 * PAD) / (2 * KX * Math.PI), (H - 2 * PAD) / (2 * KY));
const CX = W / 2, CY = H / 2;

function robinson(lat) {
  const a = Math.min(90, Math.abs(lat));
  const i = Math.min(17, Math.floor(a / 5));
  const f = a / 5 - i;
  const [x0, y0] = ROB[i], [x1, y1] = ROB[i + 1];
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}
const f1 = (n) => +n.toFixed(1);
const px = (lon, lat) => f1(CX + KX * robinson(lat)[0] * (lon * Math.PI / 180) * S);
const py = (lat) => f1(CY - KY * robinson(lat)[1] * Math.sign(lat) * S);

function ringToPath(ring) {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    d += (i === 0 ? "M" : "L") + px(lon, lat) + "," + py(lat);
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

// 曲线经纬网：经线每 30°（纬向采样 2°），纬线每 30°（经向采样 3°）
let grid = "";
for (let lon = -150; lon <= 150; lon += 30) {
  const pts = [];
  for (let lat = -88; lat <= 88; lat += 2) pts.push(px(lon, lat) + "," + py(lat));
  grid += "M" + pts.join("L");
}
for (let lat = -60; lat <= 60; lat += 30) {
  const pts = [];
  for (let lon = -180; lon <= 180; lon += 3) pts.push(px(lon, lat) + "," + py(lat));
  grid += "M" + pts.join("L");
}

// 地图外框（罗宾逊投影的边界是一条曲线）：右缘自下而上，左缘自上而下
const framePts = [];
for (let lat = -90; lat <= 90; lat += 1.5) framePts.push(px(180, lat) + "," + py(lat));
for (let lat = 90; lat >= -90; lat -= 1.5) framePts.push(px(-180, lat) + "," + py(lat));
const frame = "M" + framePts.join("L") + "Z";

// 星野：固定种子的伪随机，撒在陆地下层（陆地不透光，星星只在海洋里闪）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261024);
let stars = "";
for (let i = 0; i < 180; i++) {
  const lon = rnd() * 360 - 180;
  const lat = (rnd() * 2 - 1) * 86;
  const r = (0.35 + rnd() * 1.0).toFixed(2);
  const o = (0.10 + rnd() * 0.45).toFixed(2);
  const gold = rnd() < 0.12;
  stars += `<circle cx="${px(lon, lat)}" cy="${py(lat)}" r="${r}" fill="${gold ? "#e8b34b" : "#e9e1cf"}" opacity="${o}"/>`;
}

// ---- 2. 数据注入 ----
const windows = JSON.parse(read("data/windows.json"));
const gravesDoc = JSON.parse(read("data/graves.json"));

// 给每个窗算好地图坐标与名录编号，注入前端
const windowsWithXY = windows.map((w, i) => ({
  ...w,
  num: i + 1,
  x: px(w.anchor.lon, w.anchor.lat),
  y: py(w.anchor.lat),
}));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 秘境名录（静态渲染）
const entriesHtml = windows
  .map(
    (w, i) => `
      <article class="entry${i % 2 ? " entry--offset" : ""}" data-id="${esc(w.id)}">
        <div class="entry__no">${String(i + 1).padStart(2, "0")}</div>
        <div class="entry__body">
          <h3><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a></h3>
          <div class="entry__host">${esc(w.host)}</div>
          <p>${esc(w.blurb)}</p>
          <div class="entry__meta">⚑ ${esc(w.anchor.label)} · 存活验证 ${esc(w.verified)} · <a class="entry__loc" data-id="${esc(w.id)}" href="#w-${esc(w.id)}">在地图上找到它 ↑</a></div>
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
  .replaceAll("__MAP_FRAME__", frame)
  .replace("__MAP_STARS__", stars)
  .replace("__MAP_LAND__", land)
  .replace("__MAP_GRID__", grid)
  .replace("__WINDOWS_JSON__", JSON.stringify(windowsWithXY))
  .replaceAll("__WIN_COUNT__", String(windows.length))
  .replace("__ENTRIES__", entriesHtml)
  .replace("__GRAVES__", gravesHtml)
  .replace("__MISSING_NOTE__", esc(gravesDoc.missing))
  .replaceAll("__BUILD_DATE__", new Date().toISOString().slice(0, 10));

writeFileSync(join(root, "index.html"), html);
console.log(`✓ index.html 生成：${windows.length} 扇窗 / ${gravesDoc.graves.length} 座碑 / 陆地路径 ${(land.length / 1024).toFixed(0)}KB / 总计 ${(html.length / 1024).toFixed(0)}KB`);
