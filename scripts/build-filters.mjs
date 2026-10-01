#!/usr/bin/env node
// Descarga las listas de filtros (EasyList, EasyPrivacy, Fanboy Annoyances) y las
// convierte a (dentro de extension/):
//   - rules/<lista>.json            -> reglas declarativeNetRequest (bloqueo de red)
//   - filters/<lista>.generic.css   -> ocultación cosmética genérica (todas las webs)
//   - filters/<lista>.cosmetic.json -> ocultación cosmética específica por dominio
//
// Uso:
//   npm install
//   npm run build:filters            (descarga las listas más recientes)
//   npm run build:filters -- --offline   (usa la copia en scripts/.cache)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const CACHE = path.join(ROOT, "scripts", ".cache");
const OFFLINE = process.argv.includes("--offline");

export const LISTS = [
  {
    id: "easylist",
    url: "https://raw.githubusercontent.com/easylist/easylist/gh-pages/easylist.txt"
  },
  {
    id: "easyprivacy",
    url: "https://raw.githubusercontent.com/easylist/easylist/gh-pages/easyprivacy.txt"
  },
  {
    id: "annoyances",
    url: "https://raw.githubusercontent.com/easylist/easylist/gh-pages/fanboy-annoyance.txt"
  }
];

const CSS_CHUNK = 50;

// Pseudo-clases propias de Adblock Plus / uBlock que el CSS nativo no entiende.
const PROCEDURAL_SUPPORTED = /:(?:has-text|-abp-contains|contains)\(/;
const UNSUPPORTED = /:(?:-abp-properties|xpath|style|remove|matches-css(?:-before|-after)?|upward|min-text-length|watch-attr|matches-path|matches-attr|matches-prop|matches-media|others|if|if-not|nth-ancestor|remove-attr|remove-class|shadow-root)\(|:-abp-|\{|\}|^\^/;

async function loadList(list) {
  const file = path.join(CACHE, `${list.id}.txt`);
  if (!OFFLINE) {
    process.stdout.write(`Descargando ${list.id}... `);
    const res = await fetch(list.url);
    if (!res.ok) throw new Error(`${list.url}: HTTP ${res.status}`);
    const text = await res.text();
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, text);
    console.log(`${(text.length / 1024).toFixed(0)} KB`);
    return text;
  }
  if (!existsSync(file)) throw new Error(`No hay copia local de ${list.id} en ${file}`);
  return readFile(file, "utf8");
}

function listVersion(text) {
  const m = /^! Version: (\S+)/m.exec(text);
  return m ? m[1] : "unknown";
}

function splitDomains(spec) {
  const include = [];
  const exclude = [];
  for (let d of spec.split(",")) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    if (d.startsWith("~")) exclude.push(d.slice(1));
    else include.push(d);
  }
  return { include, exclude };
}

// Dominio "plano" (sin comodines, IPs válidas incluidas) apto para match patterns.
function isPlainDomain(d) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
}

function addTo(map, key, value) {
  (map[key] ||= []).push(value);
}

async function convertNetwork(lines, convertFilter) {
  const rules = [];
  let failed = 0;
  for (const line of lines) {
    try {
      for (const rule of await convertFilter(line)) {
        rule.id = rules.length + 1;
        rules.push(rule);
      }
    } catch {
      failed++;
    }
  }
  return { rules, failed };
}

function parseList(text) {
  const network = [];
  const generic = new Set();
  const globalExceptions = new Set();
  const specific = {};
  const exceptions = {};
  const procedural = {};
  const generichide = new Set();
  const elemhide = new Set();
  let skipped = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;

    const cosmetic = /^([^/|@"!]*?)#([@?$])?#(.+)$/.exec(line);
    if (!cosmetic) {
      // Excepciones que desactivan la ocultación cosmética en un dominio.
      const m = /^@@\|\|([a-z0-9.-]+)\^?\$(.+)$/i.exec(line);
      if (m) {
        const opts = m[2].split(",");
        const domain = m[1].toLowerCase();
        if (opts.some((o) => o === "elemhide" || o === "ehide" || o === "document")) {
          elemhide.add(domain);
        } else if (opts.some((o) => o === "generichide" || o === "ghide")) {
          generichide.add(domain);
        }
      }
      network.push(line);
      continue;
    }

    const [, domainSpec, type, body] = cosmetic;
    if (type === "$") {
      skipped++; // snippets de ABP: no soportados
      continue;
    }
    let selector = body.trim();
    const { include, exclude } = splitDomains(domainSpec);

    if (type === "@") {
      if (include.length === 0) globalExceptions.add(selector);
      for (const d of include) addTo(exceptions, d, selector);
      continue;
    }

    if (type === "?") selector = selector.replace(/:-abp-has\(/g, ":has(");

    let target;
    if (PROCEDURAL_SUPPORTED.test(selector)) {
      const withoutSupported = selector.replace(/:(?:has-text|-abp-contains|contains)\(/g, ":has(");
      if (UNSUPPORTED.test(withoutSupported) || include.length === 0) {
        skipped++;
        continue;
      }
      target = procedural;
    } else {
      if (UNSUPPORTED.test(selector)) {
        skipped++;
        continue;
      }
      target = specific;
    }

    if (include.length === 0) {
      if (target === procedural) {
        skipped++;
        continue;
      }
      // Filtro genérico: si tiene dominios excluidos se convierten en excepciones.
      generic.add(selector);
      for (const d of exclude) addTo(exceptions, d, selector);
      continue;
    }

    const entry = exclude.length ? [selector, exclude] : selector;
    for (const d of include) addTo(target, d, entry);
  }

  for (const s of globalExceptions) generic.delete(s);

  // Dominios con excepciones que afectan a selectores genéricos: en ellos el CSS
  // genérico lo inyecta el service worker (sin los selectores exceptuados).
  const genericExceptionDomains = Object.keys(exceptions)
    .filter((d) => exceptions[d].some((s) => generic.has(s)))
    .sort();

  return {
    network,
    generic: [...generic],
    cosmetic: {
      specific,
      exceptions,
      procedural,
      genericExceptionDomains,
      generichide: [...generichide].filter(isPlainDomain).sort(),
      elemhide: [...elemhide].filter(isPlainDomain).sort()
    },
    skipped
  };
}

// Valida los selectores con el motor CSS real de Chromium (si Playwright está disponible).
async function loadChromiumValidator() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    try {
      const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
      const require = createRequire(path.join(globalRoot, "noop.js"));
      playwright = require("playwright");
    } catch {
      return null;
    }
  }
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  return {
    async invalid(selectors) {
      return page.evaluate((list) => {
        const bad = [];
        for (const s of list) {
          try {
            document.createDocumentFragment().querySelector(s);
          } catch {
            bad.push(s);
          }
        }
        return bad;
      }, selectors);
    },
    close: () => browser.close()
  };
}

function cssFromSelectors(selectors) {
  const out = [];
  for (let i = 0; i < selectors.length; i += CSS_CHUNK) {
    out.push(selectors.slice(i, i + CSS_CHUNK).join(",\n") + "\n{display:none!important}");
  }
  return out.join("\n") + "\n";
}

function jsonLines(rules) {
  return "[\n" + rules.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n";
}

async function main() {
  const require = createRequire(import.meta.url);
  let convertFilter;
  try {
    ({ convertFilter } = require("@eyeo/abp2dnr"));
  } catch {
    console.error("Falta @eyeo/abp2dnr. Ejecuta primero: npm install");
    process.exit(1);
  }

  const validator = await loadChromiumValidator();
  if (!validator) console.warn("Aviso: Playwright no disponible; los selectores no se validarán con Chromium.");

  const summary = {};
  for (const list of LISTS) {
    const text = await loadList(list);
    const parsed = parseList(text);
    const { rules, failed } = await convertNetwork(parsed.network, convertFilter);

    if (validator) {
      const selectorOf = (e) => (Array.isArray(e) ? e[0] : e);
      const all = new Set(parsed.generic);
      for (const entries of Object.values(parsed.cosmetic.specific)) {
        for (const e of entries) all.add(selectorOf(e));
      }
      const bad = new Set(await validator.invalid([...all]));
      parsed.generic = parsed.generic.filter((s) => !bad.has(s));
      for (const [domain, entries] of Object.entries(parsed.cosmetic.specific)) {
        parsed.cosmetic.specific[domain] = entries.filter((e) => !bad.has(selectorOf(e)));
      }
      parsed.skipped += bad.size;
    }

    await writeFile(path.join(EXT, "rules", `${list.id}.json`), jsonLines(rules));
    await writeFile(
      path.join(EXT, "filters", `${list.id}.generic.css`),
      `/* ${list.id} ${listVersion(text)} - selectores genéricos */\n` + cssFromSelectors(parsed.generic)
    );
    await writeFile(
      path.join(EXT, "filters", `${list.id}.cosmetic.json`),
      JSON.stringify({ version: listVersion(text), ...parsed.cosmetic })
    );

    summary[list.id] = {
      version: listVersion(text),
      networkRules: rules.length,
      networkFailed: failed,
      genericSelectors: parsed.generic.length,
      specificDomains: Object.keys(parsed.cosmetic.specific).length,
      proceduralDomains: Object.keys(parsed.cosmetic.procedural).length,
      skippedCosmetic: parsed.skipped
    };
  }
  if (validator) await validator.close();

  // Reglas de YouTube escritas a mano (rules/youtube.json).
  const youtube = JSON.parse(await readFile(path.join(EXT, "rules", "youtube.json"), "utf8"));
  summary.youtube = { networkRules: youtube.length };

  await writeFile(path.join(EXT, "filters", "lists.json"), JSON.stringify(summary, null, 2) + "\n");
  console.table(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
