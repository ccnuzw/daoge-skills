import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// 只开「改错了就是 bug」的规则，不开风格规则。
// 理由：这个仓库没有 lint 历史，一上来就强制风格会一次性报出成百上千条，
// 结果只会被整体关掉或者加一堆 disable 注释 —— 那比没有 lint 更糟。
// 先让 lint 保持「红了就必须修」，以后再逐条收紧。
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.vnext.json', tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      // 类型系统已经覆盖的交给 tsc，避免和 lint 重复报错
      // 未使用声明先记 warn，不阻塞：仓库里已有一些死函数，删一个往往会让它依赖的几个也变成死代码，
      // 一次性清完会变成一场不受控的级联删除。已确认的那一批（import、catch 参数、空 try/catch）
      // 已经在本次提交里清掉，剩下的作为技术债按轮次清。
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // 这两条刻意关掉，不是疏漏，别重新打开：
      // - no-control-regex：这里的控制字符校验正是安全防线本身（路径与文件名注入），
      //   报「正则里有控制字符」等于要求删掉这道防线。
      'no-control-regex': 'off',
      // - no-require-imports：sharp 等可选依赖是运行时按需 require 的，改成静态 import
      //   会让没有装它的环境直接启动失败。
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  },
  {
    // web/src 是 JS + JSX，还没有类型信息。先只开不需要类型就能判定的规则。
    files: ['web/src/**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // 这里是 JS/JSX，没有类型信息；未使用声明同样先记 warn，避免 29 条历史债一次性挡住所有人。
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  },
  {
    // 测试是 CommonJS，require 是它的正常写法，不是要被 TS 规则纠正的问题。
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-useless-escape': 'warn',
      'no-regex-spaces': 'warn',
      // 清理临时目录时的 `catch {}` 是有意的：删不掉也要把剩下的清完。
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
