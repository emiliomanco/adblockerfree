// Conversión de "Mis filtros" (sintaxis de Adblock Plus / EasyList) a:
//   - reglas dinámicas de declarativeNetRequest (bloqueo de red)
//   - datos cosméticos con el mismo formato que filters/<lista>.cosmetic.json
//
// Sintaxis soportada:
//   ||anuncios.ejemplo.com^            bloquea un dominio
//   /banner/*$image,third-party        bloquea por URL con opciones
//   @@||ejemplo.com/script.js          excepción de red
//   ejemplo.com##.anuncio              oculta elementos en un sitio
//   ##.anuncio-generico                oculta elementos en todos los sitios
//   ejemplo.com#@#.anuncio             excepción cosmética
//   ejemplo.com#?#div:has-text(Patrocinado)   ocultación por texto

const TYPE_MAP = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  subdocument: "sub_frame",
  frame: "sub_frame",
  media: "media",
  font: "font",
  websocket: "websocket",
  ping: "ping",
  object: "object",
  other: "other",
  document: "main_frame",
  doc: "main_frame"
};

const PROCEDURAL = /:(?:has-text|-abp-contains|contains)\(/;

function splitDomains(spec, separator) {
  const include = [];
  const exclude = [];
  for (let d of spec.split(separator)) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    if (d.startsWith("~")) exclude.push(d.slice(1));
    else include.push(d);
  }
  return { include, exclude };
}

function validDomain(d) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*(\.\*)?$/.test(d);
}

function safeSelector(sel) {
  // Evita inyección de CSS ({, }) y comentarios abiertos.
  return sel && !/[{}]|\/\*/.test(sel);
}

function addTo(map, key, value) {
  (map[key] ||= []).push(value);
}

export function parseCustomFilters(text) {
  const cosmetic = {
    generic: [],
    specific: {},
    exceptions: {},
    procedural: {},
    genericExceptionDomains: [],
    generichide: [],
    elemhide: []
  };
  const network = [];
  const invalid = [];

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    const m = /^([^/|@"!]*?)#([@?])?#(.+)$/.exec(line);
    if (m) {
      const [, domainSpec, type, body] = m;
      let selector = body.trim().replace(/:-abp-has\(/g, ":has(");
      const { include, exclude } = splitDomains(domainSpec, ",");
      if (!safeSelector(selector) || ![...include, ...exclude].every(validDomain)) {
        invalid.push(line);
        continue;
      }
      if (type === "@") {
        for (const d of include) addTo(cosmetic.exceptions, d, selector);
        continue;
      }
      const entry = exclude.length ? [selector, exclude] : selector;
      if (PROCEDURAL.test(selector)) {
        if (!include.length) {
          invalid.push(line);
          continue;
        }
        for (const d of include) addTo(cosmetic.procedural, d, entry);
      } else if (include.length) {
        for (const d of include) addTo(cosmetic.specific, d, entry);
      } else {
        cosmetic.generic.push(selector);
        for (const d of exclude) addTo(cosmetic.exceptions, d, selector);
      }
      continue;
    }

    const rule = convertNetworkFilter(line);
    if (rule) network.push({ rule, text: line });
    else invalid.push(line);
  }

  return { cosmetic, network, invalid };
}

// Convierte un filtro de red ABP a una regla DNR (sin id). Devuelve null si no
// se puede convertir.
export function convertNetworkFilter(line) {
  let filter = line;
  const allow = filter.startsWith("@@");
  if (allow) filter = filter.slice(2);

  let pattern = filter;
  let options = [];
  const dollar = filter.lastIndexOf("$");
  if (dollar > 0 && !/^\/.*\/$/.test(filter)) {
    pattern = filter.slice(0, dollar);
    options = filter.slice(dollar + 1).split(",").map((o) => o.trim().toLowerCase());
  }
  if (!pattern || pattern === "*" || /\s/.test(pattern)) return null;

  const condition = {};
  const resourceTypes = [];
  const excludedResourceTypes = [];
  let important = false;
  let isDocument = false;

  for (const opt of options) {
    if (!opt) continue;
    if (opt === "third-party" || opt === "3p") condition.domainType = "thirdParty";
    else if (opt === "~third-party" || opt === "1p" || opt === "first-party") condition.domainType = "firstParty";
    else if (opt === "match-case") condition.isUrlFilterCaseSensitive = true;
    else if (opt === "important") important = true;
    else if (opt.startsWith("domain=")) {
      const { include, exclude } = splitDomains(opt.slice(7), "|");
      if (![...include, ...exclude].every((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(d))) return null;
      if (include.length) condition.initiatorDomains = include;
      if (exclude.length) condition.excludedInitiatorDomains = exclude;
    } else if (opt.startsWith("~") && TYPE_MAP[opt.slice(1)]) {
      excludedResourceTypes.push(TYPE_MAP[opt.slice(1)]);
    } else if (TYPE_MAP[opt]) {
      if (TYPE_MAP[opt] === "main_frame") isDocument = true;
      resourceTypes.push(TYPE_MAP[opt]);
    } else {
      return null; // opción desconocida
    }
  }

  if (/^\/.+\/$/.test(pattern)) {
    condition.regexFilter = pattern.slice(1, -1);
  } else {
    if (/[^\x00-\x7f]/.test(pattern)) return null;
    condition.urlFilter = pattern;
  }

  let action;
  if (allow && isDocument) {
    action = { type: "allowAllRequests" };
    condition.resourceTypes = ["main_frame", "sub_frame"];
  } else {
    action = { type: allow ? "allow" : "block" };
    if (resourceTypes.length) condition.resourceTypes = [...new Set(resourceTypes)];
    else if (excludedResourceTypes.length) condition.excludedResourceTypes = [...new Set(excludedResourceTypes)];
  }

  return {
    priority: (allow ? 2000 : 1000) + (important ? 1000 : 0),
    action,
    condition
  };
}
