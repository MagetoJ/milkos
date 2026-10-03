import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler advisory. Older screens (login, centres, team, the shells' data loaders) still
      // reset or load state from effects; report it without failing the build until they're reworked.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'backend/**', 'next-env.d.ts', '.agents/**', '.claude/**', '.cursor/**', '.devin/**'],
  },
];

export default config;
