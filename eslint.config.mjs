// ESLint：一致性守护（C10 的工程面）。只抓真问题，不管排版——
// 本仓库的紧凑样式（StyleSheet 分组单行等）是刻意为之，不交给格式化器。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.expo/**', 'dist/**', 'scripts/**', 'plugins/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // 领域代码常以 `type X = ...` + 断言塑形外部数据；空值合并等风格项不强推
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
