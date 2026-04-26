import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Catch any future external link that omits rel="noopener noreferrer".
      // Using a lightweight regex rule (no extra plugin dependency).
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='target'][value.value='_blank']",
          message: 'Add rel="noopener noreferrer" to any target="_blank" link, or use a helper that includes it.',
        },
      ],
    },
  },
])
