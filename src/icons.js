// Inline stroke icons (24px grid). Kept as strings so they can be dropped into templates.
const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const I = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  upload: svg('<path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  more: svg('<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevL: svg('<path d="M14.5 17l-5-5 5-5"/>'),
  chevR: svg('<path d="M9.5 17l5-5-5-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  sepia: svg('<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  comment: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  bookmark: svg('<path d="M6 3h12v18l-6-4.5L6 21z"/>'),
  cursor: svg('<path d="M5 3l14 7-6.2 1.8L11 18z"/>'),
  highlight: svg('<path d="M14.5 4.5l5 5L11 18H6v-5z"/><path d="M4 21h16"/>'),
  underline: svg('<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>'),
  strike: svg('<path d="M4 12h16M16.5 7C15.6 5.5 14 4.5 12 4.5c-2.6 0-4.2 1.4-4.2 3.3 0 1.2.6 2.1 1.9 2.7M8 17c.9 1.6 2.3 2.5 4.2 2.5 2.6 0 4.3-1.4 4.3-3.3 0-.5-.1-1-.4-1.4"/>'),
  pen: svg('<path d="M3 21l3.8-1 11.4-11.4a2.1 2.1 0 0 0-3-3L3.8 17z"/><path d="M13.5 7l3 3"/>'),
  note: svg('<path d="M5 4h14v10.5L13.5 20H5z"/><path d="M13.5 20v-5.5H19"/>'),
  text: svg('<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>'),
  eraser: svg('<path d="M8 20h12"/><path d="M5.6 14.6l8.3-8.3a2 2 0 0 1 2.8 0l2.3 2.3a2 2 0 0 1 0 2.8L11.4 19H8.6z"/><path d="M9.5 10.7l4.8 4.8"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  book: svg('<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>', 'width="40" height="40" stroke-width="1.4"'),
  backup: svg('<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5"/>'),
  restore: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
};

// Fill every <span data-icon="name"> placeholder found in a root.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (I[name] && !el.firstElementChild) el.innerHTML = I[name];
  });
}
