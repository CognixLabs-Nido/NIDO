import '@testing-library/jest-dom'

// JSDOM no implementa `Element.prototype.scrollIntoView`. Componentes que
// usan refs para auto-scroll (ej. ConversacionView, ConversacionAdminFamiliaView)
// lanzarían "scrollIntoView is not a function" al montar en tests. Stubbeamos
// globalmente para que el `useEffect` con auto-scroll no rompa los tests de
// render. En producción el navegador lo provee.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // no-op
  }
}
