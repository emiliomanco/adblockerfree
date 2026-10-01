// Bloqueo de red con declarativeNetRequest.
//   - Reglas estáticas: rules/<lista>.json (declaradas en manifest.json)
//   - Reglas dinámicas: sitios permitidos + "Mis filtros"

import { LIST_IDS } from "./settings.js";

const ALLOWLIST_RULE_ID = 1;
const CUSTOM_RULE_START = 1000;
const ALLOWLIST_PRIORITY = 100000;

// Activa las listas deseadas. Si Chrome se queda sin cupo de reglas, activa
// todas las que quepan (por orden de importancia) y devuelve las que fallaron.
export async function syncStaticRulesets(wanted) {
  const current = await chrome.declarativeNetRequest.getEnabledRulesets();
  const disable = current.filter((id) => !wanted.includes(id));
  const enable = wanted.filter((id) => !current.includes(id));
  if (!disable.length && !enable.length) return [];
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: disable,
      enableRulesetIds: enable
    });
    return [];
  } catch (err) {
    console.warn("updateEnabledRulesets:", err);
    if (disable.length) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: disable });
    }
    const failed = [];
    for (const id of LIST_IDS.filter((x) => enable.includes(x))) {
      try {
        await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [id] });
      } catch {
        failed.push(id);
      }
    }
    return failed;
  }
}

// customRules: [{ rule, text }] (text = filtro original, para informar de errores)
export async function syncDynamicRules({ enabled, allowlist, customRules }) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const baseRules = [];
  if (enabled && allowlist.length) {
    baseRules.push({
      id: ALLOWLIST_RULE_ID,
      priority: ALLOWLIST_PRIORITY,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: allowlist, resourceTypes: ["main_frame"] }
    });
  }

  const rejected = [];
  const custom = [];
  if (enabled) {
    let id = CUSTOM_RULE_START;
    for (const { rule, text } of customRules) {
      if (rule.condition.regexFilter) {
        const { isSupported } = await chrome.declarativeNetRequest.isRegexSupported({
          regex: rule.condition.regexFilter
        });
        if (!isSupported) {
          rejected.push(text);
          continue;
        }
      }
      custom.push({ rule: { ...rule, id: id++ }, text });
    }
  }

  const removeRuleIds = existing.map((r) => r.id);
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: [...baseRules, ...custom.map((c) => c.rule)]
    });
  } catch {
    // Una regla inválida hace fallar todo el lote: se añaden de una en una para
    // descartar sólo las que Chrome rechaza.
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: baseRules });
    for (const { rule, text } of custom) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
      } catch {
        rejected.push(text);
      }
    }
  }
  return { rejected };
}
