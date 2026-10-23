export default {
  base: './',
  // Down-level syntax for older Android System WebViews (Chrome 80s on stock
  // Android 11 images); everything newer gets the same code.
  build: { target: ['es2020', 'chrome80', 'safari15'] },
}
