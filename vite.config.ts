import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './', // Electron 加载本地文件需要相对路径
  optimizeDeps: {
    exclude: ['jeep-sqlite'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 首屏性能优化（v2.4.2 起）
        //
        // 策略要点：只拆「体积大 + 首屏必需」的稳定依赖，避免无脑拆包。
        // 教训：曾把 @capacitor/* 也拆成独立 chunk，结果慢网下请求数 +1，
        //       RTT 开销反而压过瘦身收益（实测首屏 1526ms → 1631ms）。
        //       因此 capacitor 保持留在主包里，只拆 react 生态。
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          // react 生态约 200KB，是首屏最大且最稳定的依赖 → 拆出可长期缓存
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
