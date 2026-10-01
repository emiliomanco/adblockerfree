// Traduce los elementos con data-i18n / data-i18n-title / data-i18n-placeholder.
export const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

export function localize(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] === "es" ? "es" : "en";
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}
