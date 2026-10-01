// Content script (todas las webs y marcos). Pide al service worker la
// ocultación cosmética de este sitio. El CSS lo inyecta el service worker como
// hoja de estilos de usuario; aquí sólo se aplican los filtros que dependen del
// texto de los elementos (:has-text / :-abp-contains), que el CSS no permite.
(() => {
  "use strict";

  let host = location.hostname;
  if (!host) {
    try {
      host = window.parent.location.hostname; // about:blank / srcdoc
    } catch {
      return;
    }
  }
  if (!host) return;

  try {
    chrome.runtime.sendMessage({ type: "cosmetic:get", host }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (res.css) injectStyle(res.css);
      if (res.procedural && res.procedural.length) startProcedural(res.procedural);
    });
  } catch {
    return; // la extensión se ha recargado: este script ya no está conectado
  }

  function injectStyle(css) {
    const style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Filtros procedurales
  // ---------------------------------------------------------------------------

  const TEXT_PSEUDO = /:(?:has-text|-abp-contains|contains)\(/;

  function closingParen(str, start) {
    let depth = 1;
    let quote = null;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (c === "\\") {
        i++;
      } else if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "(") {
        depth++;
      } else if (c === ")" && --depth === 0) {
        return i;
      }
    }
    return -1;
  }

  // Busca la primera pseudo-clase procedural de nivel superior.
  function parse(selector) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < selector.length; i++) {
      const c = selector[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === ":" && depth === 0) {
        const m = /^:(has-text|-abp-contains|contains|has)\(/.exec(selector.slice(i));
        if (!m) continue;
        const argStart = i + m[0].length;
        const argEnd = closingParen(selector, argStart);
        if (argEnd < 0) return { invalid: true };
        const arg = selector.slice(argStart, argEnd);
        if (m[1] === "has" && !TEXT_PSEUDO.test(arg)) {
          i = argEnd; // :has() nativo
          continue;
        }
        return { prefix: selector.slice(0, i), name: m[1], arg, rest: selector.slice(argEnd + 1) };
      }
    }
    return null;
  }

  function qsa(root, selector, relative) {
    let sel = selector.trim();
    if (relative) sel = ":scope " + sel;
    try {
      return Array.from(root.querySelectorAll(sel));
    } catch {
      return [];
    }
  }

  function textMatcher(arg) {
    const re = /^\/(.*)\/([imsu]*)$/.exec(arg);
    if (re) {
      try {
        const regex = new RegExp(re[1], re[2]);
        return (text) => regex.test(text);
      } catch {
        return () => false;
      }
    }
    return (text) => text.includes(arg);
  }

  function query(selector, root, relative) {
    const p = parse(selector);
    if (!p) return qsa(root, selector, relative);
    if (p.invalid) return [];

    const prefix = p.prefix === "" || /[\s>+~]$/.test(p.prefix) ? p.prefix + "*" : p.prefix;
    let found = qsa(root, prefix, relative);

    if (p.name === "has") {
      found = found.filter((el) => query(p.arg, el, true).length > 0);
    } else {
      const match = textMatcher(p.arg);
      found = found.filter((el) => match(el.textContent || ""));
    }

    const rest = p.rest;
    if (!rest.trim()) return found;
    if (/^\s/.test(rest) || /^[>+~]/.test(rest)) {
      const out = new Set();
      for (const el of found) for (const child of query(rest, el, true)) out.add(child);
      return [...out];
    }
    // Continuación compuesta (p. ej. ":has-text(x).clase"): se filtra con matches().
    if (TEXT_PSEUDO.test(rest)) return [];
    return found.filter((el) => {
      try {
        return el.matches("*" + rest);
      } catch {
        return false;
      }
    });
  }

  function startProcedural(selectors) {
    const hidden = new WeakSet();
    let scheduled = false;

    const run = () => {
      scheduled = false;
      for (const sel of selectors) {
        for (const el of query(sel, document, false)) {
          if (hidden.has(el)) continue;
          hidden.add(el);
          el.style.setProperty("display", "none", "important");
        }
      }
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(run, 150);
    };

    const start = () => {
      run();
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})();
