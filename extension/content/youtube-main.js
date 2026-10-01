// Se ejecuta en el "mundo" de la página de YouTube (world: MAIN) antes que los
// scripts de YouTube. Elimina los datos de anuncios de las respuestas que recibe
// el reproductor, de modo que los anuncios de vídeo ni siquiera se programan:
//   - ytInitialPlayerResponse / ytInitialData (incrustados en el HTML)
//   - respuestas de fetch/XHR de /youtubei/v1/* (navegación interna)
//   - cualquier JSON.parse con datos de anuncios
// Además quita del feed, la búsqueda y las sugerencias los bloques patrocinados.
(() => {
  "use strict";

  // Claves con la programación de anuncios del reproductor.
  const PLAYER_AD_KEYS = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];

  // "Renderers" de YouTube que sólo contienen publicidad.
  const AD_RENDERERS = new Set([
    "adSlotRenderer",
    "displayAdRenderer",
    "inFeedAdLayoutRenderer",
    "promotedSparklesWebRenderer",
    "promotedSparklesTextSearchRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "searchPyvRenderer",
    "bannerPromoRenderer",
    "statementBannerRenderer",
    "brandVideoShelfRenderer",
    "brandVideoSingletonRenderer",
    "primetimePromoRenderer",
    "actionCompanionAdRenderer",
    "companionAdRenderer",
    "playerLegacyDesktopWatchAdsRenderer"
  ]);

  // Mensajes "Los bloqueadores de anuncios no están permitidos en YouTube".
  const ENFORCEMENT_KEYS = ["enforcementMessageViewModel"];

  const NEEDLE =
    /"(?:adPlacements|adSlots|playerAds|adSlotRenderer|promotedSparklesWebRenderer|searchPyvRenderer|enforcementMessageViewModel|inFeedAdLayoutRenderer|bannerPromoRenderer|statementBannerRenderer)"/;

  const pruned = new WeakSet();

  function isAdItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    for (const key in item) {
      if (AD_RENDERERS.has(key)) return true;
      if (key === "richItemRenderer" || key === "richSectionRenderer") {
        const content = item[key] && item[key].content;
        if (content && typeof content === "object") {
          for (const k in content) if (AD_RENDERERS.has(k)) return true;
        }
      }
    }
    return false;
  }

  function prunePlayer(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const key of PLAYER_AD_KEYS) {
      if (key in obj) delete obj[key];
    }
  }

  function walk(node, depth) {
    if (depth > 64) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (isAdItem(item)) node.splice(i, 1);
        else if (item && typeof item === "object") walk(item, depth + 1);
      }
      return;
    }
    for (const key in node) {
      const value = node[key];
      if (!value || typeof value !== "object") continue;
      if (ENFORCEMENT_KEYS.includes(key) || (key === "masthead" && isAdItem(value))) {
        delete node[key];
        continue;
      }
      walk(value, depth + 1);
    }
  }

  function prune(data) {
    if (!data || typeof data !== "object" || pruned.has(data)) return data;
    pruned.add(data);
    try {
      const roots = Array.isArray(data) ? data : [data];
      for (const root of roots) {
        if (!root || typeof root !== "object") continue;
        prunePlayer(root);
        prunePlayer(root.playerResponse);
        if (root.response) prunePlayer(root.response.playerResponse);
      }
      walk(data, 0);
    } catch {
      // Nunca romper la página por un error al limpiar datos.
    }
    return data;
  }

  // --- JSON.parse ------------------------------------------------------------
  // Se usa Proxy para que toString() siga mostrando la función nativa.
  JSON.parse = new Proxy(JSON.parse, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      if (result && typeof result === "object" && typeof args[0] === "string" && NEEDLE.test(args[0])) {
        prune(result);
      }
      return result;
    }
  });

  // --- fetch: Response.prototype.json ---------------------------------------
  const isYouTubeApi = (url) => typeof url === "string" && /\/youtubei\/v1\/|\/watch\?|\/get_watch/.test(url);

  Response.prototype.json = new Proxy(Response.prototype.json, {
    apply(target, thisArg, args) {
      const promise = Reflect.apply(target, thisArg, args);
      let url = "";
      try {
        url = thisArg.url;
      } catch {
        // ignorar
      }
      return isYouTubeApi(url) ? promise.then(prune) : promise;
    }
  });

  // --- XHR con responseType "json" ------------------------------------------
  const responseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
  if (responseDesc && responseDesc.get) {
    Object.defineProperty(XMLHttpRequest.prototype, "response", {
      ...responseDesc,
      get: new Proxy(responseDesc.get, {
        apply(target, thisArg, args) {
          const value = Reflect.apply(target, thisArg, args);
          if (value && typeof value === "object" && thisArg.responseType === "json" && isYouTubeApi(thisArg.responseURL)) {
            prune(value);
          }
          return value;
        }
      })
    });
  }

  // --- Datos incrustados en el HTML -----------------------------------------
  // `var ytInitialPlayerResponse = {...}` asigna a window: se intercepta con un setter.
  for (const name of ["ytInitialPlayerResponse", "ytInitialData", "playerResponse"]) {
    let value = window[name];
    if (value) prune(value);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() {
          return value;
        },
        set(v) {
          value = prune(v);
        }
      });
    } catch {
      // ignorar
    }
  }
})();
