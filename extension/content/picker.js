// "Bloquear un anuncio en esta página": permite señalar con el ratón un
// elemento de la web y crear un filtro que lo oculte para siempre.
// Se inyecta bajo demanda desde el popup (chrome.scripting.executeScript).
(() => {
  "use strict";

  if (window.__adblockerFreePicker) return;
  window.__adblockerFreePicker = true;

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  // --- Interfaz (en un shadow DOM cerrado para no chocar con los estilos de la web)
  const host = document.createElement("adblockerfree-picker");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .box { position: fixed; pointer-events: none; background: rgba(198, 40, 40, .25);
             outline: 2px solid #c62828; border-radius: 2px; transition: all .05s linear; display: none; }
      .panel { position: fixed; right: 16px; bottom: 16px; width: 340px; max-width: calc(100vw - 32px);
               pointer-events: auto; background: #fff; color: #1f2328; border-radius: 12px;
               box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 16px; font-size: 14px; line-height: 1.4; }
      .panel h1 { font-size: 15px; margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
      .panel h1::before { content: ""; width: 14px; height: 14px; background: #c62828;
               clip-path: polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%); }
      .panel p { margin: 0 0 10px; color: #57606a; }
      textarea { width: 100%; min-height: 54px; resize: vertical; font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
                 border: 1px solid #d0d7de; border-radius: 8px; padding: 6px 8px; color: #1f2328; background: #f6f8fa; }
      label { display: block; font-size: 12px; color: #57606a; margin: 8px 0 4px; }
      input[type=range] { width: 100%; accent-color: #c62828; }
      .count { font-size: 12px; color: #57606a; margin: 6px 0 12px; }
      .buttons { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      button { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .primary { background: #c62828; color: #fff; }
      .primary:hover { background: #a91f1f; }
      .secondary { background: #eaeef2; color: #1f2328; }
      .secondary:hover { background: #dde3e9; }
      .hidden { display: none; }
      @media (prefers-color-scheme: dark) {
        .panel { background: #1f2328; color: #e6edf3; }
        .panel p, label, .count { color: #9da7b3; }
        textarea { background: #0d1117; color: #e6edf3; border-color: #3d444d; }
        .secondary { background: #30363d; color: #e6edf3; }
        .secondary:hover { background: #3d444d; }
      }
    </style>
    <div class="box"></div>
    <div class="panel">
      <h1>${t("pickerTitle")}</h1>
      <p class="intro">${t("pickerIntro")}</p>
      <div class="details hidden">
        <label for="sel">${t("pickerSelector")}</label>
        <textarea id="sel" spellcheck="false"></textarea>
        <label for="lvl">${t("pickerAdjust")}</label>
        <input id="lvl" type="range" min="0" max="0" value="0">
        <div class="count"></div>
      </div>
      <div class="buttons">
        <button class="secondary" data-act="cancel">${t("cancel")}</button>
        <button class="secondary hidden" data-act="preview">${t("pickerPreview")}</button>
        <button class="primary hidden" data-act="block">${t("pickerBlock")}</button>
      </div>
    </div>`;
  (document.body || document.documentElement).appendChild(host);

  const $ = (s) => root.querySelector(s);
  const box = $(".box");
  const panel = $(".panel");
  const selInput = $("#sel");
  const level = $("#lvl");
  const count = $(".count");

  let picking = true;
  let chain = []; // elemento elegido y sus ancestros
  let previewStyle = null;

  // --- Generación de selectores ----------------------------------------------
  const unstable = (name) => /^\d|\d{4,}|[0-9a-f]{8,}|^(?:css|sc|jsx|svelte)-[a-z0-9]+$/i.test(name) || name.length > 40;

  function count$(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  function segment(el) {
    if (el.id && !unstable(el.id)) return "#" + CSS.escape(el.id);
    let seg = el.localName;
    const classes = [...el.classList].filter((c) => !unstable(c)).slice(0, 3);
    seg += classes.map((c) => "." + CSS.escape(c)).join("");
    const parent = el.parentElement;
    if (parent && !classes.length) {
      const same = [...parent.children].filter((c) => c.localName === el.localName);
      if (same.length > 1) seg += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return seg;
  }

  function selectorFor(el) {
    const own = segment(el);
    if (own.startsWith("#") || (/[.]/.test(own) && count$(own) <= 20)) return own;
    const parts = [own];
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement && parts.length < 6) {
      parts.unshift(segment(node));
      const sel = parts.join(" > ");
      if (parts[0].startsWith("#") || count$(sel) === 1) return sel;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // --- Resaltado --------------------------------------------------------------
  function highlight(el) {
    if (!el) {
      box.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px"
    });
  }

  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === host || el === document.documentElement || el === document.body) return null;
    return el;
  }

  // --- Eventos de la página (fase de captura) ----------------------------------
  function isOurs(e) {
    return e.composedPath().includes(host);
  }

  function onMove(e) {
    if (!picking || isOurs(e)) return;
    highlight(targetAt(e.clientX, e.clientY));
  }

  function swallow(e) {
    if (isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (isOurs(e)) return;
    swallow(e);
    if (!picking) return;
    const el = targetAt(e.clientX, e.clientY);
    if (!el) return;
    picking = false;
    chain = [];
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) chain.push(n);
    level.max = String(Math.max(0, chain.length - 1));
    level.value = "0";
    $(".intro").textContent = t("pickerConfirm");
    $(".details").classList.remove("hidden");
    $('[data-act="preview"]').classList.remove("hidden");
    $('[data-act="block"]').classList.remove("hidden");
    updateSelection();
    $('[data-act="block"]').focus(); // Intro = bloquear
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function updateSelection() {
    const el = chain[Number(level.value)];
    selInput.value = selectorFor(el);
    highlight(el);
    updateCount();
  }

  function updateCount() {
    const n = count$(selInput.value.trim());
    count.textContent = n ? t("pickerMatches", [String(n)]) : t("pickerNoMatch");
    if (previewStyle) previewStyle.textContent = previewCss();
  }

  function previewCss() {
    const sel = selInput.value.trim();
    return count$(sel) ? `${sel}{display:none!important}` : "";
  }

  function togglePreview() {
    if (previewStyle) {
      previewStyle.remove();
      previewStyle = null;
      box.style.visibility = "";
      return;
    }
    previewStyle = document.createElement("style");
    previewStyle.textContent = previewCss();
    document.documentElement.appendChild(previewStyle);
    box.style.visibility = "hidden";
  }

  async function block() {
    const selector = selInput.value.trim().replace(/\s*\n\s*/g, " ");
    if (!selector || !count$(selector) || /[{}]/.test(selector)) {
      count.textContent = t("pickerNoMatch");
      return;
    }
    const domain = location.hostname.replace(/^www\./, "");
    const res = await chrome.runtime.sendMessage({ type: "picker:add", filter: `${domain}##${selector}` });
    if (res && res.error) {
      count.textContent = t("pickerNoMatch");
      return;
    }
    close();
  }

  function close() {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"]) {
      window.removeEventListener(type, swallow, true);
    }
    previewStyle?.remove();
    host.remove();
    delete window.__adblockerFreePicker;
  }

  panel.addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "cancel") close();
    else if (act === "preview") togglePreview();
    else if (act === "block") block();
  });
  level.addEventListener("input", updateSelection);
  selInput.addEventListener("input", updateCount);

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"]) {
    window.addEventListener(type, swallow, true);
  }
})();
