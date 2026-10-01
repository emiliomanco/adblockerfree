// Content script de YouTube (mundo aislado). Red de seguridad para cuando un
// anuncio llega a reproducirse pese a la limpieza de youtube-main.js:
//   - lo silencia y lo acelera al máximo
//   - pulsa "Saltar anuncio" en cuanto aparece
//   - cierra los anuncios superpuestos y el aviso anti-bloqueador
(() => {
  "use strict";

  const SKIP_BUTTONS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
    ".videoAdUiSkipButton"
  ].join(",");

  const ENFORCEMENT = "ytd-enforcement-message-view-model, ytd-enforcement-message-view-model-renderer";

  const state = { inAd: false, muted: false, rate: 1, lastCount: 0 };

  function player() {
    return document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
  }

  function handleAds() {
    const p = player();
    if (!p) return;
    const video = p.querySelector("video");
    const adShowing = p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting");

    if (adShowing && video) {
      if (!state.inAd) {
        state.inAd = true;
        state.muted = video.muted;
        state.rate = video.playbackRate || 1;
        if (Date.now() - state.lastCount > 1000) {
          state.lastCount = Date.now();
          try {
            chrome.runtime.sendMessage({ type: "yt:ad-skipped" }).catch(() => {});
          } catch {
            // extensión recargada
          }
        }
      }
      video.muted = true;
      try {
        if (video.playbackRate < 16) video.playbackRate = 16;
      } catch {
        // velocidad no soportada
      }
      // Los anuncios cortos se pueden saltar directamente al final. No se hace
      // con vídeos largos por si el anuncio va "cosido" al propio vídeo.
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 60) {
        if (video.currentTime < video.duration - 0.2) video.currentTime = video.duration - 0.1;
      }
      for (const button of document.querySelectorAll(SKIP_BUTTONS)) button.click();
    } else if (state.inAd) {
      state.inAd = false;
      if (video) {
        video.muted = state.muted;
        video.playbackRate = state.rate;
      }
    }
  }

  function handleEnforcement() {
    const message = document.querySelector(ENFORCEMENT);
    if (!message) return;
    const dialog = message.closest("tp-yt-paper-dialog, ytd-popup-container > *") || message;
    dialog.remove();
    for (const backdrop of document.querySelectorAll("tp-yt-iron-overlay-backdrop")) {
      backdrop.classList.remove("opened");
      backdrop.style.display = "none";
    }
    document.body && document.body.style.removeProperty("overflow");
    const video = player()?.querySelector("video");
    if (video && video.paused && !state.inAd) video.play().catch(() => {});
  }

  let scheduled = false;
  function check() {
    scheduled = false;
    handleAds();
    handleEnforcement();
  }

  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(check);
  });
  observer.observe(document.documentElement || document, { childList: true, subtree: true });

  // La clase "ad-showing" del reproductor no dispara el observador (sólo se
  // vigilan nodos nuevos), así que además se comprueba periódicamente.
  setInterval(check, 250);
})();
