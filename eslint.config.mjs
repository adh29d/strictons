import { baseConfig } from '@strictons/config-eslint/base';

export default [
  ...baseConfig,
  {
    ignores: ['apps/**', 'packages/**'],
  },
];
