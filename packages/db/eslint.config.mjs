import { baseConfig } from '@strictons/config-eslint/base';

export default [
  ...baseConfig,
  {
    ignores: ['src/database.types.ts', 'supabase/.branches/**', 'supabase/.temp/**'],
  },
];
