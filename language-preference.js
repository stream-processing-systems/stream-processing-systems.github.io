(() => {
  const storageKey = 'course-language';

  function languageFromValue(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().toLowerCase().match(/^(en|ru)(?:[-_][a-z0-9]+)*$/);
    return match ? match[1] : null;
  }

  function languageFromHref(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      return url.pathname.match(/^\/(en|ru)(?:\/|$)/)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function remember(value) {
    const language = languageFromValue(value) ?? languageFromHref(value);
    if (!language) return;
    try {
      window.localStorage.setItem(storageKey, language);
    } catch {
      // A denied storage area should not interfere with navigation.
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-language], [hreflang], [aria-label*="language" i] a') : null;
    if (target instanceof HTMLAnchorElement) remember(target.href);
    else if (target) remember(target.getAttribute('data-language'));
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const isLanguageSelect = target.closest('starlight-lang-select') !== null ||
      target.matches('[data-language], [aria-label*="language" i], [name*="language" i]');
    if (isLanguageSelect) remember(target.value);
  }, true);
})();
