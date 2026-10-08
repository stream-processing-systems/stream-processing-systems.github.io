(() => {
  const article = document.querySelector('[data-course-widgets]');
  if (!article) return;
  let labels;
  try { labels = JSON.parse(article.dataset.widgetLabels); } catch { return; }

  function create(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }
  function button(label, content = label) {
    const node = create('button', '', content);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    return node;
  }

  // Original links still lead to the complete inline definitions without JS.
  if ('showPopover' in HTMLElement.prototype) {
    article.querySelectorAll('a[data-term-id]').forEach((link, index) => {
      const definition = document.getElementById(`definition-${link.dataset.termId}`);
      if (!definition) return;
      const title = definition.querySelector('dt');
      const body = definition.querySelector('dd');
      if (!title || !body) return;
      const trigger = button(`${labels.definition} ${link.textContent}`, link.textContent);
      trigger.className = 'term-link term-trigger';
      const popup = create('div', 'term-popover');
      popup.id = `term-popover-${index}`;
      popup.setAttribute('popover', 'auto');
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-labelledby', `${popup.id}-title`);
      popup.setAttribute('aria-hidden', 'true');
      popup.setAttribute('data-pagefind-ignore', '');
      trigger.setAttribute('popovertarget', popup.id);
      trigger.setAttribute('aria-haspopup', 'dialog');
      const header = create('div', 'popover-header');
      const heading = create('h2', '', title.textContent);
      heading.id = `${popup.id}-title`;
      const close = button(labels.close, '×');
      close.setAttribute('popovertarget', popup.id);
      close.setAttribute('popovertargetaction', 'hide');
      header.append(heading, close);
      popup.append(header, ...[...body.children].map((child) => child.cloneNode(true)));
      document.body.append(popup);
      link.replaceWith(trigger);

      function position() {
        const anchor = trigger.getBoundingClientRect();
        const width = Math.min(360, document.documentElement.clientWidth - 32);
        popup.style.width = `${width}px`;
        popup.style.maxHeight = `${window.innerHeight - 32}px`;
        const height = popup.getBoundingClientRect().height || 230;
        popup.style.left = `${Math.max(16, Math.min(anchor.left, document.documentElement.clientWidth - width - 16))}px`;
        popup.style.top = `${Math.max(16, Math.min(anchor.bottom + 10, window.innerHeight - height - 16))}px`;
      }
      trigger.addEventListener('click', position);
      popup.addEventListener('beforetoggle', (event) => {
        popup.setAttribute('aria-hidden', String(event.newState !== 'open'));
        if (event.newState === 'open') position();
      });
      popup.addEventListener('toggle', (event) => {
        if (event.newState === 'open') position();
      });
      close.addEventListener('click', () => trigger.focus());
      const reposition = () => { if (popup.matches(':popover-open')) position(); };
      window.addEventListener('resize', reposition, { passive: true });
      window.addEventListener('scroll', (event) => {
        if (!popup.matches(':popover-open') || (event.target instanceof Node && popup.contains(event.target))) return;
        position();
      }, { passive: true, capture: true });
    });
  }

  // The source SVG remains a normal link when native dialogs are unavailable.
  const figures = article.querySelectorAll('a[data-diagram-viewer]');
  if (!figures.length || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
  const dialog = create('dialog', 'diagram-viewer');
  dialog.setAttribute('aria-labelledby', 'diagram-viewer-title');
  dialog.setAttribute('data-pagefind-ignore', '');
  const toolbar = create('div', 'viewer-toolbar');
  const titleBlock = create('div', 'viewer-title-block');
  const title = create('h2', '', labels.diagram);
  title.id = 'diagram-viewer-title';
  titleBlock.append(create('p', 'viewer-eyebrow', labels.diagram), title);
  const controls = create('div', 'viewer-controls');
  const zoomOut = button(labels.zoomOut, '−');
  const zoomValue = create('output', 'viewer-zoom', '100%');
  zoomValue.setAttribute('aria-label', labels.zoom);
  zoomValue.setAttribute('aria-live', 'polite');
  const zoomIn = button(labels.zoomIn, '+');
  const fit = button(labels.fit);
  const close = button(labels.close, '×');
  controls.append(zoomOut, zoomValue, zoomIn, fit, close);
  toolbar.append(titleBlock, controls);
  const viewport = create('div', 'viewer-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', labels.diagram);
  viewport.setAttribute('aria-describedby', 'diagram-viewer-hint');
  const image = create('img');
  image.draggable = false;
  viewport.append(image);
  const footer = create('div', 'viewer-footer');
  const hint = create('p', '', labels.diagramHint);
  hint.id = 'diagram-viewer-hint';
  const original = create('a', '', labels.original);
  original.target = '_blank';
  original.rel = 'noopener';
  footer.append(hint, original);
  dialog.append(toolbar, viewport, footer);
  document.body.append(dialog);
  let invoker;
  let zoom = 1;
  let fitWidth = 0;
  let previousOverflow = '';

  function renderZoom() {
    image.style.width = `${Math.round(fitWidth * zoom)}px`;
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= 1;
    zoomIn.disabled = zoom >= 4;
  }
  function fitImage() {
    fitWidth = Math.max(1, Math.min(image.naturalWidth || 1200, viewport.clientWidth - 32));
    zoom = 1;
    renderZoom();
    viewport.scrollTo(0, 0);
  }
  image.addEventListener('load', fitImage);
  figures.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const thumbnail = link.querySelector('img');
      if (!thumbnail) return;
      event.preventDefault();
      invoker = link;
      title.textContent = link.dataset.diagramTitle || thumbnail.alt;
      image.alt = thumbnail.alt;
      image.src = thumbnail.currentSrc || thumbnail.src;
      original.href = link.href;
      previousOverflow = document.documentElement.style.overflow;
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
      fitImage();
      close.focus();
    });
  });
  function changeZoom(delta) {
    const old = zoom;
    zoom = Math.max(1, Math.min(4, zoom + delta));
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / old;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / old;
    renderZoom();
    viewport.scrollLeft = centerX * zoom - viewport.clientWidth / 2;
    viewport.scrollTop = centerY * zoom - viewport.clientHeight / 2;
  }
  zoomIn.addEventListener('click', () => changeZoom(0.5));
  zoomOut.addEventListener('click', () => changeZoom(-0.5));
  fit.addEventListener('click', fitImage);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(0.5); }
    if (event.key === '-') { event.preventDefault(); changeZoom(-0.5); }
    if (event.key === '0') { event.preventDefault(); fitImage(); }
  });
  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = previousOverflow;
    invoker?.focus();
  });
  window.addEventListener('resize', () => { if (dialog.open) fitImage(); }, { passive: true });
})();
