#!/usr/bin/env node
// Genera icons/*.png a partir de un SVG usando Chromium (Playwright).
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "noop.js"))("playwright");
  }
}

function svg(color, size) {
  // Octógono tipo "stop" con la palabra AD; en 16px se simplifica a una barra.
  const label =
    size <= 16
      ? `<rect x="22" y="43" width="56" height="14" rx="3" fill="#fff"/>`
      : `<text x="50" y="51" text-anchor="middle" dominant-baseline="central"
           font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900"
           font-size="40" letter-spacing="-1" fill="#fff">AD</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
    <polygon points="30,2 70,2 98,30 98,70 70,98 30,98 2,70 2,30" fill="#fff"/>
    <polygon points="32,7 68,7 93,32 93,68 68,93 32,93 7,68 7,32" fill="${color}"/>
    ${label}
  </svg>`;
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
const variants = [
  { suffix: "", color: "#c62828", sizes: [16, 32, 48, 128] },
  { suffix: "-off", color: "#8b949e", sizes: [16, 32, 48] }
];
for (const { suffix, color, sizes } of variants) {
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(color, size)}</body></html>`
    );
    await page.locator("svg").screenshot({
      path: path.join(ROOT, "extension", "icons", `icon${size}${suffix}.png`),
      omitBackground: true
    });
  }
}
await browser.close();
console.log("Iconos generados en icons/");
