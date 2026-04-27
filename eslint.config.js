import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `build/` is the Vite output dir for this project (see vite.config — outDir
  // is "build" not the default "dist"). Without this, ESLint walks the
  // minified bundles and reports thousands of unrelated errors.
  globalIgnores(['dist', 'build']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
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

      // ── jsx-a11y rule severity overrides ─────────────────────────────────
      // The codebase has ~426 instances of <div onClick> patterns flagged by
      // these two rules. Fixing them all requires a systematic refactor
      // (likely a <ClickableDiv> helper or migration to <button>) that is
      // tracked separately. Downgrading to `warn` so violations surface in
      // CI logs without blocking builds.
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',

      // autoFocus is used intentionally in this codebase on search inputs
      // inside picker modals (the user explicitly opened the modal to
      // search, so focusing the search field is the desired behavior).
      // The proper a11y fix here pairs with item 3 (modal focus trap),
      // where focus management becomes a first-class concern. Until then,
      // these intentional uses ride as warnings.
      'jsx-a11y/no-autofocus': 'warn',

      // 4 instances flag modal-backdrop / toast click-to-dismiss patterns
      // where role="dialog" or role="status" is on the same div as onClick.
      // The clean fix is to split the role onto an inner sheet and leave
      // the outer scrim role-less — exactly what the focus-trap PR (item 3)
      // will do across all modals. Downgrading to `warn` until then.
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    },
  },
])
