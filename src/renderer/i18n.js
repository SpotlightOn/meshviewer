import i18next from "i18next";

let readyPromise = null;

/**
 * Resolves the UI locale from the main process.
 * @returns {Promise<string>} BCP-47 locale (e.g. 'en-US' or 'de-DE').
 */
async function detectLocale() {
  try {
    return await window.api.getLocale();
  } catch {
    return navigator.language;
  }
}

/**
 * Initializes i18next with the language resources and applies translations.
 * @returns {Promise<void>}
 */
async function initI18n() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const locale = await detectLocale();
    const lng = locale.toLowerCase().startsWith("de") ? "de" : "en";
    const [en, de] = await Promise.all([
      fetch("./locales/en.json").then((response) => response.json()),
      fetch("./locales/de.json").then((response) => response.json()),
    ]);
    await i18next.init({
      lng,
      fallbackLng: "en",
      resources: {
        en: { translation: en },
        de: { translation: de },
      },
    });
    document.documentElement.lang = lng;
    applyTranslations();
  })();
  return readyPromise;
}

/**
 * Applies translations to elements marked with data-i18n, data-i18n-title or data-i18n-aria-label.
 */
function applyTranslations() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = i18next.t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = i18next.t(el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", i18next.t(el.dataset.i18nAriaLabel));
  }
}

/**
 * Translates a key using the active language and optional interpolation options.
 * @param {string} key - Translation key (dot notation).
 * @param {object} [options] - Options passed to i18next, e.g. { app: "GIMP" }.
 * @returns {string} Translated string.
 */
function t(key, options) {
  return i18next.t(key, options);
}

export { applyTranslations, initI18n, t };
