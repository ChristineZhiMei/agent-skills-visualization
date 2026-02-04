import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import vueParser from 'vue-eslint-parser'

// 弱化 ESLint：仅保留与 Prettier 一致的简单格式化规范，不做类型/逻辑等严格校验
export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  // .ts 文件：仅解析 + Prettier 格式化
  {
    files: ['**/*.ts', '**/*.mts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    },
    plugins: { prettier: eslintPluginPrettier },
    rules: {
      ...eslintPluginPrettier.configs.recommended.rules
    }
  },
  // .vue 文件：仅解析 + Prettier 格式化
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser
      }
    },
    plugins: { prettier: eslintPluginPrettier },
    rules: {
      ...eslintPluginPrettier.configs.recommended.rules
    }
  },
  eslintConfigPrettier
)
