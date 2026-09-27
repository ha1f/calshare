// ESLint flat config。§9.1 の XSS 対策（innerHTML 等の禁止）と、
// core が外部依存を持たないこと（相対 import のみ）を機械的に検査する。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const noRawHtml = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[property.name='innerHTML']",
      message: 'innerHTML は使わない。textContent / createElement を使う（§9.1）',
    },
    {
      selector: "MemberExpression[property.name='outerHTML']",
      message: 'outerHTML は使わない（§9.1）',
    },
    {
      selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
      message: 'insertAdjacentHTML は使わない（§9.1）',
    },
    {
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message: 'dangerouslySetInnerHTML は使わない（§9.1）',
    },
    {
      selector: "Property[key.name='dangerouslySetInnerHTML']",
      message: 'dangerouslySetInnerHTML は使わない（§9.1）',
    },
  ],
}

export default tseslint.config(
  { ignores: ['dist/', 'dist-worker/', '.wrangler/', 'worker-configuration.d.ts', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.core.json', './tsconfig.server.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    rules: {
      ...noRawHtml,
      // Deps を型で揃えるため使わない引数も受け取る routes/*.ts の規約（§11.5）に合わせ、
      // 先頭 _ の引数は未使用でも許可する
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // scripts/ は Node で直接実行する。ブラウザや Workers と違い Node のグローバルが使える
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'process',
          'console',
          'fetch',
          'URL',
          'URLSearchParams',
          'TextDecoder',
          'TextEncoder',
          'Buffer',
          'AbortController',
          'setTimeout',
          'clearTimeout',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  {
    // 3 つの tsconfig のどれにも含まれないファイル（型情報付き lint の対象外）
    files: ['*.config.ts', 'eslint.config.js', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // core は外部依存ゼロを保証するため相対 import のみ許可する（§11.1）。
    // group（gitignore 形式）は import 指定子の `./x` のような相対パスを除外できないため、
    // 非相対パスにだけマッチする正規表現で判定する。
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.\\.?/)',
              message: 'core は相対 import のみ許可する（外部依存ゼロ、§11.1）',
            },
          ],
        },
      ],
    },
  },
)
