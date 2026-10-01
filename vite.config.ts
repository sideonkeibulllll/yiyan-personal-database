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
        // 首屏性能优化（v2.4.2）：把稳定的第三方依赖拆成独立 vendor chunk。
        // 好处：
        //  1) 主包体积下降，首屏需要解析的代码更少
        //  2) 业务代码变动时 vendor chunk 哈希不变，可长期命中缓存
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          if (/[\\/]node_modules[\\/]@capacitor[\\/]/.test(id)) {
            return 'vendor-capacitor';
          }
          return undefined;
        },
      },
    },
  },
});
