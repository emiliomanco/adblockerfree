import { localize, t } from "../ui/i18n.js";
import { getSettings, setSettings, normalizeHost } from "../background/settings.js";

localize();

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString(chrome.i18n.getUILanguage());

const LISTS = [
  { id: "easylist", name: "listEasylist", desc: "listEasylistDesc" },
  { id: "youtube", name: "listYoutube", desc: "listYoutubeDesc", hideCount: true },
  { id: "easyprivacy", name: "listEasyprivacy", desc: "listEasyprivacyDesc" },
  { id: "annoyances", name: "listAnnoyances", desc: "listAnnoyancesDesc" }
];

const listInfo = await fetch("../filters/lists.json").then((r) => r.json()).catch(() => ({}));

// --- Navegación ----------------------------------------------------------------
function showPanel() {
  const id = (location.hash || "#general").slice(1);
  for (const panel of document.querySelectorAll(".panel")) panel.classList.toggle("active", panel.id === id);
  for (const link of document.querySelectorAll("nav a")) link.classList.toggle("active", link.hash === "#" + id);
}
window.addEventListener("hashchange", showPanel);
showPanel();

// --- General -------------------------------------------------------------------
async function renderGeneral() {
  const settings = await getSettings();
  $("enabled").checked = settings.enabled;

  const container = $("lists");
  container.textContent = "";
  for (const list of LISTS) {
    const row = document.createElement("label");
    row.className = "row";
    const rules = list.hideCount ? 0 : listInfo[list.id]?.networkRules;
    row.innerHTML = `
      <div class="grow">
        <div class="title"></div>
        <div class="hint"></div>
        <div class="meta"></div>
      </div>
      <span class="switch"><input type="checkbox"><span></span></span>`;
    row.querySelector(".title").textContent = t(list.name);
    row.querySelector(".hint").textContent = t(list.desc);
    row.querySelector(".meta").textContent = rules ? t("rulesCount", [fmt(rules)]) : "";
    const input = row.querySelector("input");
    input.checked = Boolean(settings.lists[list.id]);
    input.disabled = !settings.enabled;
    input.addEventListener("change", async () => {
      const current = await getSettings();
      await setSettings({ lists: { ...current.lists, [list.id]: input.checked } });
    });
    container.append(row);
  }

  const { ytAdsSkipped = 0 } = await chrome.storage.local.get("ytAdsSkipped");
  $("ytCount").textContent = fmt(ytAdsSkipped);
}

$("enabled").addEventListener("change", (e) => setSettings({ enabled: e.target.checked }));

// --- Sitios permitidos -----------------------------------------------------------
async function renderAllowlist() {
  const { allowlist } = await getSettings();
  const ul = $("allowItems");
  ul.textContent = "";
  for (const host of [...allowlist].sort()) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = host;
    const button = document.createElement("button");
    button.className = "btn";
    button.textContent = t("remove");
    button.addEventListener("click", async () => {
      const current = await getSettings();
      await setSettings({ allowlist: current.allowlist.filter((h) => h !== host) });
    });
    li.append(span, button);
    ul.append(li);
  }
  $("allowEmpty").hidden = allowlist.length > 0;
}

$("allowForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = normalizeHost($("allowInput").value);
  $("allowError").hidden = Boolean(host);
  if (!host) {
    $("allowError").textContent = t("invalidHost");
    return;
  }
  const { allowlist } = await getSettings();
  if (!allowlist.includes(host)) await setSettings({ allowlist: [...allowlist, host] });
  $("allowInput").value = "";
});

// --- Mis filtros -----------------------------------------------------------------
async function renderCustom() {
  const { customFilters } = await getSettings();
  if (document.activeElement !== $("customFilters")) $("customFilters").value = customFilters;
}

$("saveCustom").addEventListener("click", async () => {
  await setSettings({ customFilters: $("customFilters").value });
  $("customSaved").hidden = false;
  setTimeout(() => ($("customSaved").hidden = true), 2500);
});

// --- Estado (listas que Chrome no pudo activar, filtros inválidos) -------------
async function renderStatus() {
  const status = await chrome.runtime.sendMessage({ type: "status:get" }).catch(() => null);
  const failed = status?.failedLists || [];
  $("failed").hidden = failed.length === 0;
  if (failed.length) {
    const names = failed.map((id) => t(LISTS.find((l) => l.id === id)?.name || id)).join(", ");
    $("failed").textContent = t("listsFailed", [names]);
  }
  const invalid = status?.invalidCustom || [];
  $("customInvalid").hidden = invalid.length === 0;
  const ul = $("customInvalid").querySelector("ul");
  ul.textContent = "";
  for (const line of invalid) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.append(li);
  }
}

// --- Acerca de -------------------------------------------------------------------
function renderAbout() {
  $("version").textContent = chrome.runtime.getManifest().version;
  const ul = $("versions");
  ul.textContent = "";
  for (const list of LISTS) {
    const info = listInfo[list.id];
    if (!info?.version) continue;
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = t(list.name);
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = info.version;
    meta.style.flex = "none";
    li.append(span, meta);
    ul.append(li);
  }
}

async function renderAll() {
  await Promise.all([renderGeneral(), renderAllowlist(), renderCustom()]);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") renderAll();
  if (area === "session" && changes.status) renderStatus();
});

renderAbout();
await renderAll();
await renderStatus();
