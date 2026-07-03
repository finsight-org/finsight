import '@testing-library/jest-dom/vitest'
import '@/i18n/i18n'

Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => undefined
Element.prototype.releasePointerCapture ??= () => undefined
Element.prototype.scrollIntoView = () => undefined
window.scrollTo = () => undefined
