import antfu from '@antfu/eslint-config'
import reactHooks from 'eslint-plugin-react-hooks'

export default antfu(
  {
    // ESLint 10 currently rejects the react-dom plugin shape from
    // antfu/react/setup in this dependency set. Keep the React preset off
    // until @antfu/eslint-config ships an ESLint 10-compatible setup.
    react: false,
    typescript: true,
    yaml: false,
    stylistic: false,
    // LuCI wraps its modules in functions; validate them with tests/openwrt/ui.test.cjs.
    ignores: ['wing', 'apps/web/src/schemas/**', 'openwrt/htdocs/**'],
    rules: {
      'no-template-curly-in-string': 'off',
      // Allow exporting variants alongside components (shadcn pattern)
      'react-refresh/only-export-components': 'off',
      // Allow array index as key when items have no stable ID
      'react/no-array-index-key': 'off',
      // Allow dangerouslySetInnerHTML for trusted content (chart tooltips)
      'react-dom/no-dangerously-set-innerhtml': 'off',
      // Allow direct setState in useEffect for sync patterns
      'react-hooks-extra/no-direct-set-state-in-use-effect': 'off',
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/web/src/pages/Orchestrate/index.tsx'],
    rules: {
      'e18e/prefer-array-some': 'off',
      'no-empty': 'off',
      'no-useless-return': 'off',
      'perfectionist/sort-imports': 'off',
    },
  },
  {
    // Playwright fixtures. These drive a live LuCI panel and report to an
    // operator, so several defaults fight the file's purpose:
    //
    // - `console.log` is how a fixture prints its PASS line.
    // - `process.env` is the documented configuration surface
    //   (`DAED_PANEL_URL`, `DAED_PANEL_CONTROL`, `DAED_GROUP_OUTPUT`, ...).
    // - `innerText` is deliberate: `textContent` also returns `display:none`
    //   copy, so assertions would pass on text the user cannot see.
    // - `prefer-template`, `one-var` and import sorting are pure formatting;
    //   these files are long, hand-tuned selectors and rewriting them would
    //   bury real changes in noise.
    // - `ui.test.cjs` loads each LuCI view module the only way it can: it
    //   wraps the file in a function and evaluates it against a fake `L`,
    //   which requires the Function constructor.
    files: ['tests/openwrt/*.cjs'],
    rules: {
      'no-console': 'off',
      'no-new': 'off',
      'no-new-func': 'off',
      'node/prefer-global/process': 'off',
      'one-var': 'off',
      'perfectionist/sort-imports': 'off',
      'prefer-template': 'off',
      'unicorn/prefer-dom-node-text-content': 'off',
    },
  },
)
