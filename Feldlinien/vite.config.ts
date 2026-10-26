import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build is one self-contained index.html (script, styles and font
// inlined), so it can be copied anywhere or opened by double-click.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  test: {
    environment: 'node'
  }
});
