// Ajustes guardados en chrome.storage.local. Todo es local: no hay cuentas,
// servidores ni telemetría.

export const LIST_IDS = ["easylist", "easyprivacy", "annoyances", "youtube"];

export const DEFAULT_SETTINGS = {
  enabled: true,
  lists: {
    easylist: true,
    easyprivacy: true,
    annoyances: false,
    youtube: true
  },
  allowlist: [],
  customFilters: ""
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return {
    enabled: stored.enabled ?? DEFAULT_SETTINGS.enabled,
    lists: { ...DEFAULT_SETTINGS.lists, ...(stored.lists || {}) },
    allowlist: Array.isArray(stored.allowlist) ? stored.allowlist : [],
    customFilters: typeof stored.customFilters === "string" ? stored.customFilters : ""
  };
}

export function setSettings(patch) {
  return chrome.storage.local.set(patch);
}

// Normaliza lo que escribe el usuario ("https://www.Ejemplo.com/ruta") a un
// nombre de host ("ejemplo.com"). Devuelve "" si no es válido.
export function normalizeHost(input) {
  let value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = "http://" + value;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").replace(/\.$/, "");
    return isValidHost(host) ? host : "";
  } catch {
    return "";
  }
}

export function isValidHost(host) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) && host.length <= 253;
}

// "a.b.ejemplo.com" -> ["a.b.ejemplo.com", "b.ejemplo.com", "ejemplo.com", "com"]
export function hostChain(host) {
  const parts = host.split(".");
  const chain = [];
  for (let i = 0; i < parts.length; i++) chain.push(parts.slice(i).join("."));
  return chain;
}

export function isAllowlisted(host, allowlist) {
  if (!host) return false;
  const set = new Set(allowlist);
  return hostChain(host).some((h) => set.has(h));
}

export function domainPatterns(domain) {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}
