import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // Minified, no sourcemaps: the published package ships only the built bundle
  // and type declarations — never the original source (sourcemaps embed it).
  minify: true,
  sourcemap: false,
  clean: true,
  target: 'es2020',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
