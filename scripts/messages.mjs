// Genera _locales/*/messages.json a partir de una única tabla (más fácil de mantener).
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "extension", "_locales");

const M = {
  extName: ["AdBlocker Free", "AdBlocker Free"],
  extDescription: [
    "Bloqueador de anuncios 100% gratis y sin cuentas. Bloquea anuncios, rastreadores y los anuncios de YouTube.",
    "100% free ad blocker, no account needed. Blocks ads, trackers and YouTube ads."
  ],
  // Popup
  blockedOnPage: ["bloqueados en esta página", "blocked on this page"],
  siteEnabled: ["Activado en este sitio", "Enabled on this site"],
  sitePaused: ["Pausado en este sitio", "Paused on this site"],
  pickElement: ["Bloquear un anuncio", "Block an ad"],
  pauseAll: ["Pausar en todas las webs", "Pause on all sites"],
  resumeAll: ["Reanudar el bloqueo", "Resume blocking"],
  globallyPaused: ["AdBlocker Free está en pausa en todas las webs.", "AdBlocker Free is paused on all sites."],
  unsupportedPage: [
    "AdBlocker Free no actúa en las páginas internas del navegador.",
    "AdBlocker Free doesn't run on the browser's internal pages."
  ],
  ytSkipped: ["Anuncios de YouTube saltados", "YouTube ads skipped"],
  options: ["Opciones", "Options"],
  tagline: ["100% gratis · sin cuentas · sin rastreo", "100% free · no account · no tracking"],
  // Selector de elementos
  pickerTitle: ["Bloquear un anuncio", "Block an ad"],
  pickerIntro: [
    "Pasa el ratón por encima del anuncio y haz clic en él. Pulsa Esc para cancelar.",
    "Hover over the ad and click it. Press Esc to cancel."
  ],
  pickerConfirm: [
    "¿Es lo que quieres ocultar? Mueve la barra para ampliar la selección.",
    "Is this what you want to hide? Move the slider to widen the selection."
  ],
  pickerSelector: ["Filtro (selector CSS)", "Filter (CSS selector)"],
  pickerAdjust: ["Ampliar la selección", "Widen the selection"],
  pickerMatches: {
    message: ["Ocultará $COUNT$ elemento(s) en esta página.", "Will hide $COUNT$ element(s) on this page."],
    placeholders: { count: { content: "$1", example: "3" } }
  },
  pickerNoMatch: ["El filtro no coincide con ningún elemento.", "The filter doesn't match any element."],
  pickerPreview: ["Vista previa", "Preview"],
  pickerBlock: ["Bloquear", "Block"],
  cancel: ["Cancelar", "Cancel"],
  // Opciones
  optionsTitle: ["Opciones de AdBlocker Free", "AdBlocker Free options"],
  navGeneral: ["General", "General"],
  navAllowlist: ["Sitios permitidos", "Allowed sites"],
  navCustom: ["Mis filtros", "My filters"],
  navAbout: ["Acerca de", "About"],
  enabledLabel: ["Bloqueo activado", "Blocking enabled"],
  enabledHint: [
    "Desactívalo para pausar AdBlocker Free en todas las webs.",
    "Turn it off to pause AdBlocker Free on every site."
  ],
  listsTitle: ["Listas de filtros", "Filter lists"],
  listEasylist: ["Anuncios (EasyList)", "Ads (EasyList)"],
  listEasylistDesc: [
    "Bloquea la gran mayoría de anuncios de la web. Recomendado.",
    "Blocks the vast majority of ads on the web. Recommended."
  ],
  listEasyprivacy: ["Rastreadores (EasyPrivacy)", "Trackers (EasyPrivacy)"],
  listEasyprivacyDesc: [
    "Bloquea rastreadores y scripts de analítica que siguen lo que haces en internet.",
    "Blocks trackers and analytics scripts that follow what you do online."
  ],
  listYoutube: ["Anuncios de YouTube", "YouTube ads"],
  listYoutubeDesc: [
    "Elimina los anuncios de vídeo, los banners y los vídeos patrocinados de YouTube.",
    "Removes YouTube video ads, banners and sponsored videos."
  ],
  listAnnoyances: ["Molestias (Fanboy's Annoyance)", "Annoyances (Fanboy's Annoyance)"],
  listAnnoyancesDesc: [
    "Oculta avisos de cookies, ventanas de suscripción, widgets sociales y otras distracciones. Puede afectar a alguna web.",
    "Hides cookie notices, newsletter pop-ups, social widgets and other distractions. May affect some sites."
  ],
  rulesCount: {
    message: ["$COUNT$ reglas", "$COUNT$ rules"],
    placeholders: { count: { content: "$1", example: "50000" } }
  },
  listsFailed: {
    message: [
      "Chrome no ha permitido activar: $LISTS$. Puede que otro bloqueador de anuncios esté ocupando el límite de reglas del navegador.",
      "Chrome refused to enable: $LISTS$. Another ad blocker may be using up the browser's rule limit."
    ],
    placeholders: { lists: { content: "$1", example: "EasyPrivacy" } }
  },
  allowlistHint: [
    "AdBlocker Free no bloqueará nada en estos sitios ni en sus subdominios.",
    "AdBlocker Free won't block anything on these sites or their subdomains."
  ],
  allowlistPlaceholder: ["ejemplo.com", "example.com"],
  add: ["Añadir", "Add"],
  remove: ["Quitar", "Remove"],
  allowlistEmpty: ["No hay sitios permitidos.", "No allowed sites yet."],
  invalidHost: ["Ese dominio no es válido.", "That domain isn't valid."],
  customHint: [
    "Un filtro por línea, con la sintaxis de Adblock Plus / EasyList. Lo que bloquees con «Bloquear un anuncio» aparece aquí.",
    "One filter per line, using Adblock Plus / EasyList syntax. Anything you block with “Block an ad” shows up here."
  ],
  customExamples: ["Ejemplos", "Examples"],
  save: ["Guardar", "Save"],
  saved: ["Guardado y aplicado.", "Saved and applied."],
  customInvalid: ["Estos filtros no se han podido aplicar:", "These filters couldn't be applied:"],
  aboutText: [
    "AdBlocker Free es gratis para siempre: sin cuentas, sin suscripciones, sin «anuncios aceptables» y sin enviar ningún dato a ningún servidor. Todo se procesa dentro de tu navegador.",
    "AdBlocker Free is free forever: no accounts, no subscriptions, no “acceptable ads” and no data sent to any server. Everything happens inside your browser."
  ],
  aboutLists: ["Versión de las listas incluidas", "Bundled list versions"],
  aboutUpdate: [
    "Para actualizar las listas, ejecuta «npm run build:filters» en la carpeta del proyecto y recarga la extensión.",
    "To update the lists, run “npm run build:filters” in the project folder and reload the extension."
  ],
  aboutCredits: [
    "Listas de filtros de EasyList (easylist.to), con licencia GPLv3 / CC BY-SA 3.0. Conversión con abp2dnr de eyeo.",
    "Filter lists by EasyList (easylist.to), licensed GPLv3 / CC BY-SA 3.0. Converted with eyeo's abp2dnr."
  ],
  statsTitle: ["Estadísticas", "Statistics"]
};

for (const [index, locale] of [[0, "es"], [1, "en"]]) {
  const out = {};
  for (const [key, value] of Object.entries(M)) {
    if (Array.isArray(value)) out[key] = { message: value[index] };
    else out[key] = { message: value.message[index], placeholders: value.placeholders };
  }
  mkdirSync(path.join(LOCALES, locale), { recursive: true });
  writeFileSync(path.join(LOCALES, locale, "messages.json"), JSON.stringify(out, null, 2) + "\n");
}
console.log("ok");
