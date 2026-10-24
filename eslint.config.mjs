import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default [
  { ignores: ['dist/**','release/**','native/**','node_modules/**','.runtime/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {files:['src/**/*.{ts,tsx}','public/**/*.js'],languageOptions:{globals:globals.browser},rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},
  {files:['desktop/**/*.cjs','scripts/**/*.{mjs,cjs}'],languageOptions:{globals:globals.node},rules:{'@typescript-eslint/no-require-imports':'off'}},
];
