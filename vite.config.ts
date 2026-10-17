// For editors and tools that read Vite's config: the machine imports Coin-Op City only through the kit, @kit/... is
// kit/src/kit/. The stand-in host (npm run dev) sets the same alias itself.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@kit': resolve(import.meta.dirname, 'kit/src/kit') } },
});
