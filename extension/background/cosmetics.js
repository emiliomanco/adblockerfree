// Ocultación cosmética: calcula qué selectores CSS hay que aplicar en cada
// sitio a partir de filters/<lista>.cosmetic.json y de "Mis filtros".
//
// El CSS genérico (válido para todas las webs) se inyecta con content scripts
// registrados (ver content-scripts.js). Aquí sólo se calcula:
//   - el CSS específico del dominio
//   - el CSS genérico en los dominios con excepciones (#@#)
//   - los filtros "procedurales" (:has-text) que aplica content/cosmetic.js

import { hostChain } from "./settings.js";

export const COSMETIC_LISTS = ["easylist", "easyprivacy", "annoyances"];
const CHUNK = 50;

const listCache = new Map();
const genericCache = new Map();

function prepare(data) {
  return {
    ...data,
    genericExceptionSet: new Set(data.genericExceptionDomains || []),
    generichideSet: new Set(data.generichide || []),
    elemhideSet: new Set(data.elemhide || [])
  };
}

export function loadCosmeticList(id) {
  if (!listCache.has(id)) {
    const promise = fetch(chrome.runtime.getURL(`filters/${id}.cosmetic.json`))
      .then((r) => r.json())
      .then(prepare)
      .catch((err) => {
        listCache.delete(id);
        throw err;
      });
    listCache.set(id, promise);
  }
  return listCache.get(id);
}

// Los selectores genéricos se leen del propio CSS (un selector por línea).
function loadGenericSelectors(id) {
  if (!genericCache.has(id)) {
    const promise = fetch(chrome.runtime.getURL(`filters/${id}.generic.css`))
      .then((r) => r.text())
      .then((css) =>
        css
          .split("\n")
          .filter((l) => l && !l.startsWith("{") && !l.startsWith("/*"))
          .map((l) => (l.endsWith(",") ? l.slice(0, -1) : l))
      );
    genericCache.set(id, promise);
  }
  return genericCache.get(id);
}

let customData = null;
export function setCustomCosmetics(cosmetic) {
  if (!cosmetic) {
    customData = null;
    return;
  }
  // Una excepción del usuario puede anular selectores genéricos de cualquier
  // lista, así que esos dominios reciben el CSS genérico desde aquí.
  const genericExceptionDomains = Object.keys(cosmetic.exceptions || {}).filter((d) => !d.endsWith(".*"));
  customData = prepare({ ...cosmetic, genericExceptionDomains });
}

// Acceso seguro a los mapas dominio -> lista (evita claves heredadas como "constructor").
const NONE = [];
const own = (map, key) => (map && Object.hasOwn(map, key) ? map[key] : NONE);

// Claves de búsqueda para un host: la cadena de dominios y las variantes con
// comodín de TLD que usa EasyList ("ejemplo.*").
function lookupKeys(host) {
  const chain = hostChain(host);
  const parts = host.split(".");
  const keys = new Set(chain);
  for (let i = 0; i < parts.length - 1; i++) {
    for (let j = i + 1; j < parts.length; j++) keys.add(parts.slice(i, j).join(".") + ".*");
  }
  return { chain, keys };
}

export async function getCosmeticsFor(host, settings) {
  const lists = [];
  for (const id of COSMETIC_LISTS) {
    if (settings.lists[id]) lists.push({ id, data: await loadCosmeticList(id) });
  }
  if (customData) lists.push({ id: "custom", data: customData });
  if (!host || !lists.length) return { css: "", procedural: [] };

  const { chain, keys } = lookupKeys(host);
  const onChain = (set) => chain.some((d) => set.has(d));

  if (lists.some((l) => onChain(l.data.elemhideSet))) return { css: "", procedural: [] };
  const generichide = lists.some((l) => onChain(l.data.generichideSet));

  const exceptions = new Set();
  for (const { data } of lists) {
    for (const k of keys) for (const s of own(data.exceptions, k)) exceptions.add(s);
  }

  const selectors = new Set(); // validados al compilar las listas
  const userSelectors = new Set(); // escritos por el usuario: una regla por selector
  const procedural = [];

  const accept = (entry, add) => {
    const [sel, exclude] = Array.isArray(entry) ? entry : [entry, null];
    if (exceptions.has(sel)) return;
    if (exclude && exclude.some((d) => keys.has(d))) return;
    add(sel);
  };

  for (const { id, data } of lists) {
    const sink = id === "custom" ? userSelectors : selectors;
    for (const k of keys) {
      for (const e of own(data.specific, k)) accept(e, (s) => sink.add(s));
      for (const e of own(data.procedural, k)) accept(e, (s) => procedural.push(s));
    }
    if (generichide) continue;
    if (id === "custom") {
      for (const s of data.generic || []) if (!exceptions.has(s)) userSelectors.add(s);
    } else if (onChain(data.genericExceptionSet) || (customData && onChain(customData.genericExceptionSet))) {
      for (const s of await loadGenericSelectors(id)) if (!exceptions.has(s)) selectors.add(s);
    }
  }

  return { css: toCss([...selectors], [...userSelectors]), procedural };
}

function toCss(selectors, userSelectors) {
  const rules = [];
  for (let i = 0; i < selectors.length; i += CHUNK) {
    rules.push(selectors.slice(i, i + CHUNK).join(",") + "{display:none!important}");
  }
  for (const s of userSelectors) rules.push(s + "{display:none!important}");
  return rules.join("\n");
}

// Datos que necesita el registro de content scripts para excluir el CSS
// genérico de los dominios con excepciones.
export async function getGenericExclusions(enabledIds) {
  const perList = {};
  const global = new Set();
  for (const id of enabledIds) {
    const data = await loadCosmeticList(id);
    perList[id] = data.genericExceptionDomains || [];
    for (const d of data.generichide || []) global.add(d);
    for (const d of data.elemhide || []) global.add(d);
  }
  if (customData) {
    for (const d of customData.genericExceptionDomains) global.add(d);
    for (const d of customData.generichide || []) global.add(d);
  }
  return { perList, global: [...global] };
}
