import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'reference', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already resolves identifiers (TextDecoder, DataView, Blob, ...);
      // the core rule produces false positives on platform globals in TS files.
      'no-undef': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
