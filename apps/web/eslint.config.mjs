import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['src/**/*.{ts,tsx}'] })),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
];
