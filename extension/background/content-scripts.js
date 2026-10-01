// Registro dinámico de content scripts. Se registran (en vez de declararlos en
// manifest.json) para poder excluir los sitios permitidos y para desactivarlos
// por completo al pausar la extensión.

import { domainPatterns, isValidHost } from "./settings.js";
import { COSMETIC_LISTS, getGenericExclusions } from "./cosmetics.js";

const PREFIX = "abf-";
const YOUTUBE_MATCHES = [
  "*://*.youtube.com/*",
  "*://youtube.com/*",
  "*://*.youtube-nocookie.com/*",
  "*://youtube-nocookie.com/*"
];

function patternsFor(domains) {
  const out = new Set();
  for (const d of domains) {
    if (isValidHost(d)) for (const p of domainPatterns(d)) out.add(p);
  }
  return [...out];
}

export async function syncContentScripts(settings) {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ours = registered.filter((s) => s.id.startsWith(PREFIX)).map((s) => s.id);
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  if (!settings.enabled) return;

  const allowPatterns = patternsFor(settings.allowlist);
  const scripts = [
    {
      id: PREFIX + "cosmetic",
      js: ["content/cosmetic.js"],
      matches: ["<all_urls>"],
      excludeMatches: allowPatterns,
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: "document_start"
    }
  ];

  const cosmeticLists = COSMETIC_LISTS.filter((id) => settings.lists[id]);
  const exclusions = await getGenericExclusions(cosmeticLists);
  const globalExcluded = patternsFor(exclusions.global);
  for (const id of cosmeticLists) {
    scripts.push({
      id: `${PREFIX}generic-${id}`,
      css: [`filters/${id}.generic.css`],
      matches: ["<all_urls>"],
      excludeMatches: [...new Set([...allowPatterns, ...globalExcluded, ...patternsFor(exclusions.perList[id])])],
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: "document_start"
    });
  }

  if (settings.lists.youtube) {
    scripts.push(
      {
        id: PREFIX + "youtube-main",
        js: ["content/youtube-main.js"],
        matches: YOUTUBE_MATCHES,
        excludeMatches: allowPatterns,
        allFrames: true,
        runAt: "document_start",
        world: "MAIN"
      },
      {
        id: PREFIX + "youtube",
        js: ["content/youtube.js"],
        css: ["content/youtube.css"],
        matches: YOUTUBE_MATCHES,
        excludeMatches: allowPatterns,
        allFrames: true,
        runAt: "document_start"
      }
    );
  }

  for (const s of scripts) if (!s.excludeMatches?.length) delete s.excludeMatches;
  await chrome.scripting.registerContentScripts(scripts);
}
