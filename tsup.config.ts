import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['api/server.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
});