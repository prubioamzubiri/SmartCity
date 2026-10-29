import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages sirve bajo /SmartCity/; el despliegue con Docker usa la raíz (VITE_BASE=/).
  base: process.env.VITE_BASE ?? '/SmartCity/',
});
