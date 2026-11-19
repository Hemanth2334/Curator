import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The website runs on http://localhost:5174 and sends every /api/... request
// to the Curator backend on port 8001 (so it never clashes with CineMatch on 5173/8000).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { "/api": "http://localhost:8001" } },
});
