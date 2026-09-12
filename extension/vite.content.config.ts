import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 内容脚本必须是 IIFE，单独一次构建
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome114',
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'RedditCollectorContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
