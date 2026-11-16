import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/client/public/**',
      'assets-src/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Sim purity: game rules must run identically on server and client.
    files: ['packages/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@babylonjs/*'], message: 'packages/sim must not depend on the renderer.' },
            {
              group: ['**/apps/**', '@citadel/client', '@citadel/server'],
              message: 'packages/sim must not import apps.',
            },
            {
              group: ['node:*', 'fs', 'path', 'ws'],
              message: 'packages/sim must not use Node or network APIs.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'No DOM in packages/sim.' },
        { name: 'document', message: 'No DOM in packages/sim.' },
        { name: 'performance', message: 'Use world ticks, not wall-clock time.' },
        { name: 'setTimeout', message: 'Use world ticks, not timers.' },
        { name: 'setInterval', message: 'Use world ticks, not timers.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use World.rng so matches are replayable.' },
        { object: 'Date', property: 'now', message: 'Use world ticks, not wall-clock time.' },
      ],
    },
  },
);
