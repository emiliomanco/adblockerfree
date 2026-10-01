import { localize, t } from "../ui/i18n.js";

localize();

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString(chrome.i18n.getUILanguage());
const send = (msg) => chrome.runtime.sendMessage(msg);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let state = await send({ type: "popup:state", url: tab?.url || "" });

// Chrome sólo da este dato si el popup se abrió desde el icono (permiso activeTab).
async function blockedCount() {
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
    return fmt(rulesMatchedInfo.length);
  } catch {
    return "–";
  }
}

async function render() {
  $("paused").hidden = state.enabled;
  $("active").hidden = !state.enabled;
  $("ytCount").textContent = fmt(state.ytAdsSkipped);
  if (!state.enabled) return;

  $("count").textContent = await blockedCount();
  $("siteBox").hidden = !state.supported;
  $("unsupported").hidden = state.supported;
  $("pick").disabled = !state.supported || state.allowlisted;
  $("pick").hidden = !state.supported;
  if (state.supported) {
    $("host").textContent = state.host.replace(/^www\./, "");
    $("siteToggle").checked = !state.allowlisted;
    $("siteStatus").textContent = state.allowlisted ? t("sitePaused") : t("siteEnabled");
    $("siteStatus").classList.toggle("off", state.allowlisted);
  }
}

$("siteToggle").addEventListener("change", async (e) => {
  await send({ type: "site:set-allowed", host: state.host, allowed: !e.target.checked });
  state = await send({ type: "popup:state", url: tab.url });
  await render();
  chrome.tabs.reload(tab.id);
});

$("pick").addEventListener("click", async () => {
  await send({ type: "picker:start", tabId: tab.id });
  window.close();
});

$("pauseAll").addEventListener("click", async () => {
  await send({ type: "global:set-enabled", enabled: false });
  state = await send({ type: "popup:state", url: tab.url });
  await render();
  chrome.tabs.reload(tab.id);
});

$("resume").addEventListener("click", async () => {
  await send({ type: "global:set-enabled", enabled: true });
  state = await send({ type: "popup:state", url: tab.url });
  await render();
  chrome.tabs.reload(tab.id);
});

$("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

await render();
