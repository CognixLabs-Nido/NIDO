import '@testing-library/jest-dom'

// JSDOM no implementa la API de scroll del navegador. Componentes que
// usan refs para auto-scroll (ej. ConversacionView,
// ConversacionAdminFamiliaView, ConversacionesSplitView a través del
// hook `useScrollAlFondo`) tocan `scrollIntoView`, `scrollTo` y leen
// `scrollTop`/`scrollHeight`/`clientHeight`. Stubbeamos lo mínimo para
// que el render bajo Vitest no rompa. Los tests que verifican el
// comportamiento de scroll redefinen estas propiedades explícitamente
// por elemento.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // no-op
  }
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {
    // no-op
  }
}
