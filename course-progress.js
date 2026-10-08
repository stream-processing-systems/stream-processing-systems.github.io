// Reading progress kept in this browser only (localStorage, no account):
// new (not opened), seen (opened), done (marked as read by the reader).
// Progress is per article and shared by its English and Russian pages.
(() => {
  const storageKey = 'course-progress';
  const labels = {
    en: { new: 'Not opened', seen: 'Opened', done: 'Read' },
    ru: { new: 'Не открыта', seen: 'Открыта', done: 'Прочитана' },
  };
  const language = document.documentElement.lang?.startsWith('ru') ? 'ru' : 'en';

  function load() {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') || {}; } catch { return {}; }
  }
  function save(progress) {
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* storage may be off */ }
  }
  // "/ru/course/fundamentals/x/" and "/en/course/fundamentals/x/" share "/course/fundamentals/x/".
  function articleKey(href) {
    try {
      const { pathname } = new URL(href, location.href);
      const match = pathname.match(/^\/(?:en|ru)(\/course\/.+)$/);
      return match ? (match[1].endsWith('/') ? match[1] : `${match[1]}/`) : null;
    } catch { return null; }
  }

  const progress = load();
  const currentKey = articleKey(location.href);
  if (currentKey && !progress[currentKey]) {
    progress[currentKey] = 'seen';
    save(progress);
  }
  const stateOf = (key) => progress[key] ?? 'new';

  function decorateSidebar() {
    document.querySelectorAll('.sidebar-content ul a[href]').forEach((link) => {
      const key = articleKey(link.href);
      if (!key) return;
      let mark = link.querySelector('.course-progress');
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'course-progress';
        link.prepend(mark);
      }
      const state = stateOf(key);
      mark.dataset.state = state;
      mark.title = labels[language][state];
      mark.setAttribute('aria-label', labels[language][state]);
      mark.setAttribute('role', 'img');
    });
  }

  function setupToggle() {
    const toggle = document.querySelector('[data-course-progress-toggle]');
    if (!toggle || !currentKey) return;
    const render = () => {
      const done = stateOf(currentKey) === 'done';
      toggle.setAttribute('aria-checked', String(done));
      toggle.querySelector('.course-progress').dataset.state = done ? 'done' : 'seen';
    };
    toggle.addEventListener('click', () => {
      progress[currentKey] = stateOf(currentKey) === 'done' ? 'seen' : 'done';
      save(progress);
      render();
      decorateSidebar();
    });
    toggle.hidden = false;
    render();
  }

  const start = () => { decorateSidebar(); setupToggle(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
