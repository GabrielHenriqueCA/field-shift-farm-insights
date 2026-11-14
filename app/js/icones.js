// Aviso de SI: ícones desenhados com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
(function (R) {
  "use strict";
  const s = (corpo) => `<svg viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
  R.icones = {
    soja: s(`<path d="M16 28V12" stroke="#3DBE7A" stroke-width="1.8"/><ellipse cx="11" cy="11" rx="4" ry="6.5" transform="rotate(-28 11 11)" fill="#3DBE7A" fill-opacity=".85"/><ellipse cx="21" cy="11" rx="4" ry="6.5" transform="rotate(28 21 11)" fill="#3DBE7A" fill-opacity=".85"/><ellipse cx="16" cy="7" rx="3.4" ry="5.5" fill="#5fd897"/>`),
    milho: s(`<path d="M16 29v-6" stroke="#8FBF5A" stroke-width="1.8"/><ellipse cx="16" cy="13" rx="5" ry="10" fill="#E9C46A"/><path d="M13 7v13M16 4v18M19 7v13" stroke="#b8902f" stroke-width="1"/><path d="M11 22c-3-2-4-6-3-10M21 22c3-2 4-6 3-10" stroke="#8FBF5A" stroke-width="1.8"/>`),
    sorgo: s(`<path d="M16 29V14" stroke="#8FBF5A" stroke-width="1.8"/><g fill="#C8873A"><circle cx="16" cy="5" r="2.2"/><circle cx="12.5" cy="8" r="2.2"/><circle cx="19.5" cy="8" r="2.2"/><circle cx="16" cy="9.5" r="2.2"/><circle cx="13" cy="12.5" r="2.2"/><circle cx="19" cy="12.5" r="2.2"/></g>`),
    algodao: s(`<path d="M16 29v-8" stroke="#8FBF5A" stroke-width="1.8"/><path d="M10 20l6 3 6-3" stroke="#8B5E34" stroke-width="1.8"/><g fill="#F4F1EA"><circle cx="12" cy="13" r="4.5"/><circle cx="20" cy="13" r="4.5"/><circle cx="16" cy="9" r="4.8"/><circle cx="16" cy="16" r="4"/></g>`),
    milheto: s(`<path d="M16 29V16" stroke="#8FBF5A" stroke-width="1.8"/><rect x="13" y="3" width="6" height="15" rx="3" fill="#8FBF5A"/><path d="M13.5 7h5M13.5 10.5h5M13.5 14h5" stroke="#5a8a32" stroke-width="1"/>`),
    braquiaria: s(`<path d="M16 29C15 20 10 14 6 11M16 29c0-9 1-16 3-22M16 29c2-7 6-12 10-14M16 29c-1-6-3-10-6-13" stroke="#2E8B57" stroke-width="2.2"/>`),
    consorcio: s(`<ellipse cx="12" cy="12" rx="4" ry="8.5" fill="#E9C46A"/><path d="M12 28v-7" stroke="#8FBF5A" stroke-width="1.6"/><path d="M22 29c0-7 1-12 3-17M22 29c-1-5-3-9-5-11M22 29c2-5 4-8 7-9" stroke="#2E8B57" stroke-width="2"/>`),
    pousio: s(`<circle cx="16" cy="16" r="10" stroke="#8B5E34" stroke-width="1.8" stroke-dasharray="3 3"/><path d="M9 22h14" stroke="#8B5E34" stroke-width="1.8"/>`),
    solo: s(`<path d="M4 20h24M6 25h20M9 15c2-5 5-8 7-8s5 3 7 8" stroke="#D2A57A" stroke-width="2"/>`),
    risco: s(`<path d="M16 4l13 23H3z" stroke="#E76F51" stroke-width="2"/><path d="M16 13v6M16 23h.01" stroke="#E76F51" stroke-width="2.2"/>`),
    agua: s(`<path d="M16 4c5 7 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8 8-15z" stroke="#4C8DF6" stroke-width="2"/>`),
    renda: s(`<path d="M5 24l7-7 5 4 10-11" stroke="#E9C46A" stroke-width="2.2"/><path d="M21 10h6v6" stroke="#E9C46A" stroke-width="2.2"/>`),
    clima: s(`<circle cx="12" cy="12" r="5" stroke="#E9C46A" stroke-width="2"/><path d="M14 26h11a5 5 0 0 0 0-10 7 7 0 0 0-12 3" stroke="#4C8DF6" stroke-width="2"/>`),
    relevo: s(`<path d="M3 26l9-14 5 7 4-5 8 12z" stroke="#D2A57A" stroke-width="2"/>`),
    satelite: s(`<rect x="12" y="12" width="8" height="8" rx="1.5" transform="rotate(45 16 16)" stroke="#4C8DF6" stroke-width="2"/><path d="M6 6l5 5M21 21l5 5M4 12l4-4M20 28l4-4M24 4l4 4" stroke="#4C8DF6" stroke-width="2"/>`),
  };
})(globalThis.Rotare = globalThis.Rotare || {});
