#!/usr/bin/env node
// Pruebas de extremo a extremo: carga la extensión en Chromium (Playwright) y la
// prueba contra páginas servidas en local. Todos los dominios (doubleclick.net,
// www.youtube.com, ...) se redirigen a un servidor local con --host-resolver-rules,
// así que no hace falta conexión a internet.
//
//   npm test

import http from "node:http";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "extension");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "noop.js"))("playwright");
  }
}

// ---------------------------------------------------------------------------
// Datos de prueba sacados de las listas compiladas
// ---------------------------------------------------------------------------

const easylist = JSON.parse(readFileSync(path.join(EXT, "filters/easylist.cosmetic.json"), "utf8"));
const genericCss = readFileSync(path.join(EXT, "filters/easylist.generic.css"), "utf8");
const genericSet = new Set(
  genericCss
    .split("\n")
    .filter((l) => l && !l.startsWith("{") && !l.startsWith("/*"))
    .map((l) => l.replace(/,$/, ""))
);
const simple = (s) => /^[#.][A-Za-z][\w-]*$/.test(s);
const elementFor = (s, extra = "") =>
  s.startsWith("#") ? `<div id="${s.slice(1)}" ${extra}>x</div>` : `<div class="${s.slice(1)}" ${extra}>x</div>`;

// Un filtro específico simple (dominio##.clase) que no esté también en los genéricos.
const [specificDomain, specificSelector] = (() => {
  for (const [domain, entries] of Object.entries(easylist.specific)) {
    if (!/^[a-z0-9-]+\.[a-z]+$/.test(domain) || easylist.exceptions[domain]) continue;
    for (const e of entries) if (typeof e === "string" && simple(e) && !genericSet.has(e)) return [domain, e];
  }
  throw new Error("No se encontró un filtro específico simple");
})();

// Un dominio con excepción (#@#) sobre un selector genérico simple.
const GENERIC_SAMPLE = ".ad-banner-box";
if (!genericSet.has(GENERIC_SAMPLE)) throw new Error(`${GENERIC_SAMPLE} ya no está en EasyList`);
const [exceptionDomain, exceptedSelector] = (() => {
  for (const domain of easylist.genericExceptionDomains) {
    if (!/^[a-z0-9-]+\.[a-z]+$/.test(domain) || easylist.generichide.includes(domain)) continue;
    if ((easylist.exceptions[domain] || []).includes(GENERIC_SAMPLE)) continue;
    const sel = (easylist.exceptions[domain] || []).find((s) => simple(s) && genericSet.has(s));
    if (sel) return [domain, sel];
  }
  throw new Error("No se encontró una excepción genérica simple");
})();

// ---------------------------------------------------------------------------
// Servidor local
// ---------------------------------------------------------------------------

const received = [];

const PAGES = {
  "/ads.html": `<!doctype html><title>ads</title>
    <h1 id="content">Contenido</h1>
    <div class="ad-banner-box" id="generic1">anuncio</div>
    <div id="AD_300" class="x">anuncio</div>
    <div class="custom-ad">custom</div>
    <div class="post" id="sponsored">Patrocinado: compra ya</div>
    <div class="post" id="normal">Una noticia normal</div>
    <div class="target-box"><span id="pickme" style="display:inline-block;width:200px;height:80px;background:#ccc">elige</span></div>
    <img id="adimg" src="http://ad.doubleclick.net/ad.gif">
    <script src="http://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
    <img id="tracker" src="http://tracker.custom/pixel.gif">
    <script>window.parsedOutside = Object.keys(JSON.parse('{"adPlacements":[1],"x":1}'));</script>`,
  "/specific.html": `<!doctype html><title>specific</title>${elementFor(specificSelector, 'data-t="specific"')}`,
  "/exception.html": `<!doctype html><title>exception</title>
    ${elementFor(exceptedSelector, 'data-t="excepted"')}
    <div class="ad-banner-box" data-t="generic">anuncio</div>`,
  "/watch": `<!doctype html><title>yt</title>
    <script>
      var ytInitialPlayerResponse = {"adPlacements":[{"a":1}],"playerAds":[{}],"adSlots":[{}],"videoDetails":{"videoId":"abc"},
        "auxiliaryUi":{"messageRenderers":{"enforcementMessageViewModel":{"x":1}}}};
      var ytInitialData = {"contents":{"richGridRenderer":{"masthead":{"adSlotRenderer":{}},"contents":[
        {"richItemRenderer":{"content":{"adSlotRenderer":{}}}},
        {"richItemRenderer":{"content":{"videoRenderer":{"videoId":"v1"}}}}]}}};
    </script>
    <script>
      window.results = {
        initialPlayer: Object.keys(ytInitialPlayerResponse).sort(),
        enforcement: "enforcementMessageViewModel" in ytInitialPlayerResponse.auxiliaryUi.messageRenderers,
        feed: ytInitialData.contents.richGridRenderer.contents.length,
        masthead: "masthead" in ytInitialData.contents.richGridRenderer,
        parsed: Object.keys(JSON.parse('{"playerResponse":{"adPlacements":[1],"videoDetails":{}}}').playerResponse),
        nativeToString: JSON.parse.toString()
      };
      fetch("/youtubei/v1/player").then((r) => r.json()).then((j) => { results.fetched = Object.keys(j).sort(); });
    </script>
    <div id="movie_player" class="html5-video-player ad-showing">
      <video></video>
      <button class="ytp-skip-ad-button" onclick="window.skipClicked = true">Saltar</button>
    </div>
    <ytd-ad-slot-renderer id="adslot">anuncio</ytd-ad-slot-renderer>
    <tp-yt-paper-dialog id="dlg"><ytd-enforcement-message-view-model>Ad blockers are not allowed</ytd-enforcement-message-view-model></tp-yt-paper-dialog>`
};

const server = http.createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  const url = new URL(req.url, "http://x");
  received.push(`${host}${url.pathname}`);
  if (url.pathname === "/youtubei/v1/player") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ adPlacements: [1], playerAds: [1], videoDetails: { videoId: "abc" } }));
    return;
  }
  const page = PAGES[url.pathname];
  if (page) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }
  if (url.pathname.endsWith(".gif")) {
    res.writeHead(200, { "content-type": "image/gif" });
    res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    return;
  }
  res.writeHead(200, { "content-type": "application/javascript" });
  res.end("/* ok */");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

// ---------------------------------------------------------------------------
// Mini framework de pruebas
// ---------------------------------------------------------------------------

const results = [];
const ONLY = process.env.ONLY;
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY) && !name.startsWith("se aplica")) return;
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push([false, name]);
    console.log(`  ✘ ${name}\n      ${String(err?.stack || err).split("\n").slice(0, 3).join("\n      ")}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: esperado ${e}, obtenido ${a}`);
}

// ---------------------------------------------------------------------------
// Navegador con la extensión
// ---------------------------------------------------------------------------

const { chromium } = await loadPlaywright();
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "abf-test-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP * 127.0.0.1:${PORT}`,
    "--no-proxy-server"
  ]
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];

const errors = [];
context.on("weberror", (e) => errors.push(String(e.error())));

async function lastApplied() {
  return sw.evaluate(async () => (await chrome.storage.session.get("status")).status?.appliedAt || 0);
}
async function waitApplied(since) {
  for (let i = 0; i < 100; i++) {
    if ((await lastApplied()) > since) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Los ajustes no se aplicaron a tiempo");
}
async function setStorage(values) {
  const before = await lastApplied();
  await sw.evaluate((v) => chrome.storage.local.set(v), values);
  await waitApplied(before);
}

async function openPage(url) {
  const page = await context.newPage();
  const blocked = [];
  page.on("requestfailed", (r) => {
    if (r.failure()?.errorText === "net::ERR_BLOCKED_BY_CLIENT") blocked.push(r.url());
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(400);
  return { page, blocked };
}

const display = (page, selector) =>
  page.$eval(selector, (el) => getComputedStyle(el).display).catch(() => "missing");

console.log(`\nAdBlocker Free ${extId}`);
console.log(`Filtro específico: ${specificDomain}##${specificSelector}`);
console.log(`Excepción genérica: ${exceptionDomain}#@#${exceptedSelector}\n`);

await test("se aplica la configuración inicial", async () => {
  for (let i = 0; i < 100; i++) {
    const ready = await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.session)).catch(() => false);
    if (ready && (await lastApplied())) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(await lastApplied(), "applySettings no terminó");
  const rulesets = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  eq(rulesets.sort(), ["easylist", "easyprivacy", "youtube"], "listas activas");
  const scripts = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  eq(scripts.sort(), ["abf-cosmetic", "abf-generic-easylist", "abf-generic-easyprivacy", "abf-youtube", "abf-youtube-main"], "content scripts");
  const status = await sw.evaluate(async () => (await chrome.storage.session.get("status")).status);
  eq(status.failedLists, [], "listas fallidas");
});

await test("bloquea peticiones de anuncios (red)", async () => {
  const { page, blocked } = await openPage("http://news.example/ads.html");
  assert(blocked.some((u) => u.includes("doubleclick.net")), "doubleclick no bloqueado: " + blocked);
  assert(blocked.some((u) => u.includes("googlesyndication.com")), "googlesyndication no bloqueado");
  assert(!received.some((r) => r.startsWith("ad.doubleclick.net")), "la petición llegó al servidor");
  await page.close();
});

await test("oculta anuncios con filtros genéricos y deja el contenido", async () => {
  const { page } = await openPage("http://news.example/ads.html");
  eq(await display(page, "#generic1"), "none", ".ad-banner-box");
  eq(await display(page, "#AD_300"), "none", "#AD_300");
  eq(await display(page, "#content"), "block", "contenido");
  await page.close();
});

await test("aplica filtros específicos sólo en su dominio", async () => {
  const a = await openPage(`http://${specificDomain}/specific.html`);
  eq(await display(a.page, '[data-t="specific"]'), "none", `en ${specificDomain}`);
  const b = await openPage("http://otro-sitio.example/specific.html");
  eq(await display(b.page, '[data-t="specific"]'), "block", "en otro dominio");
  await a.page.close();
  await b.page.close();
});

await test("respeta las excepciones #@# sin perder el resto de filtros genéricos", async () => {
  const { page } = await openPage(`http://${exceptionDomain}/exception.html`);
  eq(await display(page, '[data-t="excepted"]'), "block", "selector exceptuado");
  eq(await display(page, '[data-t="generic"]'), "none", "otros genéricos");
  await page.close();
});

await test("YouTube: elimina los datos de anuncios del reproductor y del feed", async () => {
  const { page } = await openPage("http://www.youtube.com/watch?v=abc");
  await page.waitForFunction(() => window.results && window.results.fetched, null, { timeout: 5000 });
  const r = await page.evaluate(() => window.results);
  eq(r.initialPlayer, ["auxiliaryUi", "videoDetails"], "ytInitialPlayerResponse");
  eq(r.enforcement, false, "aviso anti-bloqueador en los datos");
  eq(r.feed, 1, "elementos del feed");
  eq(r.masthead, false, "masthead publicitario");
  eq(r.parsed, ["videoDetails"], "JSON.parse");
  eq(r.fetched, ["videoDetails"], "fetch /youtubei/v1/player");
  assert(r.nativeToString.includes("[native code]"), "JSON.parse delata la modificación");
  await page.close();
});

await test("YouTube: salta, silencia y acelera los anuncios que llegan a reproducirse", async () => {
  const { page } = await openPage("http://www.youtube.com/watch?v=abc");
  await page.waitForFunction(() => window.skipClicked === true, null, { timeout: 3000 });
  const video = await page.$eval("video", (v) => ({ muted: v.muted, rate: v.playbackRate }));
  eq(video, { muted: true, rate: 16 }, "vídeo del anuncio");
  eq(await display(page, "#adslot"), "none", "ytd-ad-slot-renderer");
  await page.waitForFunction(() => !document.getElementById("dlg"), null, { timeout: 3000 });
  // Al terminar el anuncio se restaura el audio y la velocidad.
  await page.evaluate(() => document.getElementById("movie_player").classList.remove("ad-showing"));
  await page.waitForFunction(() => document.querySelector("video").playbackRate === 1, null, { timeout: 3000 });
  eq(await page.$eval("video", (v) => v.muted), false, "audio restaurado");
  await page.close();
});

await test("no toca JSON.parse fuera de YouTube", async () => {
  const { page } = await openPage("http://news.example/ads.html");
  eq(await page.evaluate(() => window.parsedOutside), ["adPlacements", "x"], "JSON.parse");
  await page.close();
});

await test("Mis filtros: ocultación, filtros por texto y bloqueo de red", async () => {
  await setStorage({
    customFilters: [
      "news.example##.custom-ad",
      "news.example#?#div.post:has-text(Patrocinado)",
      "||tracker.custom^",
      "esto no es {un filtro}##",
      "||*rechazado-por-chrome^"
    ].join("\n")
  });
  const { page, blocked } = await openPage("http://news.example/ads.html");
  eq(await display(page, ".custom-ad"), "none", ".custom-ad");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("sponsored")).display === "none", null, {
    timeout: 3000
  });
  eq(await display(page, "#normal"), "block", "post normal");
  assert(blocked.some((u) => u.includes("tracker.custom")), "tracker.custom no bloqueado");
  const status = await sw.evaluate(async () => (await chrome.storage.session.get("status")).status);
  eq(status.invalidCustom, ["esto no es {un filtro}##", "||*rechazado-por-chrome^"], "filtros inválidos detectados");
  await setStorage({ customFilters: "" });
  await page.close();
});

await test("selector de elementos: bloquea el elemento elegido", async () => {
  const { page } = await openPage("http://news.example/ads.html");
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://news.example/*" }))[0].id);
  await sw.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["content/picker.js"] }), tabId);
  await page.waitForTimeout(200);
  const box = await page.$eval("#pickme", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("pickme")).display === "none", null, {
    timeout: 3000
  });
  const { customFilters } = await sw.evaluate(() => chrome.storage.local.get("customFilters"));
  eq(customFilters, "news.example###pickme", "filtro guardado");
  await setStorage({ customFilters: "" });
  await page.close();
});

await test("sitios permitidos: no bloquea nada en ellos", async () => {
  await setStorage({ allowlist: ["news.example"] });
  const { page, blocked } = await openPage("http://news.example/ads.html");
  eq(blocked, [], "peticiones bloqueadas");
  eq(await display(page, "#generic1"), "block", ".ad-banner-box visible");
  await page.close();
  await setStorage({ allowlist: [] });
});

await test("página de opciones: activar la lista de molestias", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options/options.html`);
  const before = await lastApplied();
  await page.locator("#lists .row", { hasText: "Fanboy" }).click();
  await waitApplied(before);
  const rulesets = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert(rulesets.includes("annoyances"), "annoyances no activada: " + rulesets);
  const scripts = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  assert(scripts.includes("abf-generic-annoyances"), "CSS de molestias no registrado");

  await page.goto(`chrome-extension://${extId}/options/options.html#allowlist`);
  const before2 = await lastApplied();
  await page.fill("#allowInput", "https://www.Ejemplo.com/ruta");
  await page.click("#allowForm button");
  await waitApplied(before2);
  const { allowlist } = await sw.evaluate(() => chrome.storage.local.get("allowlist"));
  eq(allowlist, ["ejemplo.com"], "dominio normalizado");
  await page.close();
  await setStorage({ allowlist: [], lists: { easylist: true, easyprivacy: true, annoyances: false, youtube: true } });
});

await test("popup: se muestra sin errores", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  await page.waitForTimeout(300);
  assert(await page.isVisible("#active"), "panel principal oculto");
  assert(await page.isVisible("#unsupported"), "debería indicar página no compatible");
  await page.close();
});

await test("pausa global: desactiva todo el bloqueo", async () => {
  await setStorage({ enabled: false });
  const rulesets = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  eq(rulesets, [], "listas activas");
  const { page, blocked } = await openPage("http://news.example/ads.html");
  eq(blocked, [], "peticiones bloqueadas");
  eq(await display(page, "#generic1"), "block", ".ad-banner-box visible");
  await page.close();
  await setStorage({ enabled: true });
});

await test("sin errores de JavaScript en las páginas", async () => {
  eq(errors, [], "errores");
});

await context.close();
server.close();
rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} pruebas superadas`);
process.exit(failed ? 1 : 0);
