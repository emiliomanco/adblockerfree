import { getSettings, setSettings, normalizeHost, isAllowlisted, LIST_IDS } from "./settings.js";
import { syncStaticRulesets, syncDynamicRules } from "./dnr.js";
import { syncContentScripts } from "./content-scripts.js";
import { getCosmeticsFor, setCustomCosmetics } from "./cosmetics.js";
import { parseCustomFilters } from "./custom-filters.js";

const ICONS_ON = { 16: "/icons/icon16.png", 32: "/icons/icon32.png", 48: "/icons/icon48.png" };
const ICONS_OFF = { 16: "/icons/icon16-off.png", 32: "/icons/icon32-off.png", 48: "/icons/icon48-off.png" };

// ---------------------------------------------------------------------------
// Aplicar ajustes
// ---------------------------------------------------------------------------

let customParsedFor = null;
let customParsed = null;

function getCustomParsed(text) {
  if (customParsedFor !== text) {
    customParsed = parseCustomFilters(text);
    customParsedFor = text;
    setCustomCosmetics(customParsed.cosmetic);
  }
  return customParsed;
}

// Las aplicaciones se ejecutan de una en una; las peticiones que llegan mientras
// otra está en cola se agrupan en una sola.
let running = Promise.resolve();
let queued = null;

function applySettings() {
  if (!queued) {
    queued = running
      .catch(() => {})
      .then(() => {
        queued = null;
        return doApply();
      });
    running = queued;
  }
  return queued;
}

async function doApply() {
  const settings = await getSettings();
  const custom = getCustomParsed(settings.customFilters);

  const wanted = settings.enabled ? LIST_IDS.filter((id) => settings.lists[id]) : [];
  const failedLists = await syncStaticRulesets(wanted);
  const dynamic = await syncDynamicRules({
    enabled: settings.enabled,
    allowlist: settings.allowlist,
    customRules: custom.network
  });
  await syncContentScripts(settings);

  await chrome.action.setIcon({ path: settings.enabled ? ICONS_ON : ICONS_OFF });
  await chrome.declarativeNetRequest
    .setExtensionActionOptions({ displayActionCountAsBadgeText: settings.enabled })
    .catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ color: "#c62828" });

  await chrome.storage.session.set({
    status: {
      failedLists,
      invalidCustom: [...custom.invalid, ...dynamic.rejected],
      appliedAt: Date.now()
    }
  });
}

// Al instalar/actualizar Chrome borra los content scripts registrados: se rehacen.
chrome.runtime.onInstalled.addListener(() => applySettings());

chrome.runtime.onStartup.addListener(() => applySettings());

const SETTING_KEYS = ["enabled", "lists", "allowlist", "customFilters"];
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTING_KEYS.some((k) => k in changes)) applySettings();
});

// ---------------------------------------------------------------------------
// Mensajes de content scripts, popup y opciones
// ---------------------------------------------------------------------------

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : "";
  } catch {
    return "";
  }
}

async function handleCosmetics(msg, sender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return {};
  const settings = await getSettings();
  if (!settings.enabled) return {};
  getCustomParsed(settings.customFilters);

  const host = String(msg.host || "").toLowerCase();
  const topHost = hostOf(sender.tab.url) || host;
  if (isAllowlisted(topHost, settings.allowlist) || isAllowlisted(host, settings.allowlist)) return {};

  const { css, procedural } = await getCosmeticsFor(host, settings);
  if (css) {
    try {
      const target = sender.documentId
        ? { tabId, documentIds: [sender.documentId] }
        : { tabId, frameIds: [sender.frameId ?? 0] };
      await chrome.scripting.insertCSS({ target, css, origin: "USER" });
    } catch {
      // Marcos donde no se puede inyectar (p. ej. about:blank): lo hace el content script.
      return { css, procedural };
    }
  }
  return { procedural };
}

async function handlePopupState(msg) {
  const settings = await getSettings();
  const host = hostOf(msg.url);
  const { ytAdsSkipped = 0 } = await chrome.storage.local.get("ytAdsSkipped");
  return {
    enabled: settings.enabled,
    host,
    supported: Boolean(host),
    allowlisted: isAllowlisted(host, settings.allowlist),
    ytAdsSkipped
  };
}

async function setSiteAllowed(host, allowed) {
  const settings = await getSettings();
  const clean = normalizeHost(host);
  if (!clean) return;
  let allowlist = settings.allowlist.slice();
  if (allowed) {
    if (!allowlist.includes(clean)) allowlist.push(clean);
  } else {
    // Quita el dominio y cualquier dominio padre que lo estuviera permitiendo.
    allowlist = allowlist.filter((d) => !isAllowlisted(host, [d]));
  }
  await setSettings({ allowlist });
  await applySettings();
}

async function addCustomFilter(filter, sender) {
  const sep = filter.indexOf("##");
  const selector = sep >= 0 ? filter.slice(sep + 2) : "";
  if (!selector || /[{}]|\/\*/.test(selector) || filter.includes("\n")) return { error: "invalid" };
  const settings = await getSettings();
  const lines = settings.customFilters.split(/\r?\n/).map((l) => l.trim());
  if (!lines.includes(filter)) {
    const text = (settings.customFilters.trimEnd() + "\n" + filter).trimStart();
    await setSettings({ customFilters: text });
    await applySettings();
  }
  // Aplicarlo ya en la página abierta.
  if (sender.tab) {
    await chrome.scripting
      .insertCSS({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
        css: `${selector}{display:none!important}`,
        origin: "USER"
      })
      .catch(() => {});
  }
}

async function incrementYtCounter() {
  const { ytAdsSkipped = 0 } = await chrome.storage.local.get("ytAdsSkipped");
  await chrome.storage.local.set({ ytAdsSkipped: ytAdsSkipped + 1 });
}

// Mensajes que sólo pueden enviar las páginas de la propia extensión (popup,
// opciones), nunca los content scripts que corren dentro de las webs.
const PRIVILEGED = new Set(["popup:state", "site:set-allowed", "global:set-enabled", "picker:start", "status:get"]);

function fromExtensionPage(sender) {
  // Los content scripts llevan la URL de la web; las páginas propias, la de la extensión.
  return sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL("")));
}

const handlers = {
  "cosmetic:get": handleCosmetics,
  "popup:state": handlePopupState,
  "site:set-allowed": (msg) => setSiteAllowed(msg.host, msg.allowed),
  "global:set-enabled": async (msg) => {
    await setSettings({ enabled: Boolean(msg.enabled) });
    await applySettings();
  },
  "picker:start": async (msg) => {
    await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["content/picker.js"] });
  },
  "picker:add": (msg, sender) => addCustomFilter(String(msg.filter || "").trim(), sender),
  "yt:ad-skipped": () => incrementYtCounter(),
  "status:get": async () => (await chrome.storage.session.get("status")).status || null
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  if (PRIVILEGED.has(msg.type) && !fromExtensionPage(sender)) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(
      (result) => sendResponse(result ?? {}),
      (err) => {
        console.error(msg.type, err);
        sendResponse({ error: String(err?.message || err) });
      }
    );
  return true;
});
