import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // Live2D 资源反代（bestdori.com 无 CORS，本地开发直连；放在 /api 之前以优先匹配）
      "/api/live2d": {
        target: "https://bestdori.com",
        changeOrigin: true,
        rewrite: (p) =>
          p
            .replace(/^\/api\/live2d\/asset\//, "/assets/")
            .replace(/^\/api\/live2d\/api\//, "/api/"),
      },
      // DeepSeek Search / Fetch 代理：默认连接本地 Lumia Chat Worker。
      "/api/deepseek": {
        target:
          process.env.DEEPSEEK_PROXY_ORIGIN ||
          "http://localhost:8787",
        changeOrigin: true,
      },
      // FastAPI 后端（lumia-fastapi）
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      // 上传的静态图片
      "/static": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
