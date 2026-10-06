import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { publicPages } from './src/lib/page-metadata.ts';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', 'VITE_');
  const siteUrl = env.VITE_SITE_URL;
  return {
    plugins: [
      react(),
      tailwind(),
      {
        name: 'public-page-metadata',
        closeBundle() {
          const dist = resolve('dist');
          const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
          const escape = (value: string) =>
            value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
          for (const [route, [name, description]] of Object.entries(publicPages)) {
            let page = html.replace(
              /<title>.*?<\/title>/,
              `<title>${escape(name)} — Receptly</title>`,
            );
            page = page.replace(
              /(<meta\s+(?:name|property)="(?:description|og:description|twitter:description)"\s+content=")[^"]*("\s*\/>)/g,
              `$1${escape(description)}$2`,
            );
            page = page.replace(
              /(<meta\s+(?:name|property)="(?:og:title|twitter:title)"\s+content=")[^"]*("\s*\/>)/g,
              `$1${escape(name)} — Receptly$2`,
            );
            if (['/login', '/register', '/signup'].includes(route))
              page = page.replace(
                '</head>',
                '<meta name="robots" content="noindex, nofollow" /></head>',
              );
            if (siteUrl) {
              const canonical = new URL(route, siteUrl).href;
              const image = new URL('/social-preview.png', siteUrl).href;
              page = page
                .replaceAll('content="/social-preview.png"', `content="${escape(image)}"`)
                .replace(
                  '</head>',
                  `<link rel="canonical" href="${escape(canonical)}" /><meta property="og:url" content="${escape(canonical)}" /></head>`,
                );
            }
            const folder = resolve(dist, route.slice(1));
            mkdirSync(folder, { recursive: true });
            writeFileSync(resolve(folder, 'index.html'), page);
          }
        },
      },
    ],
    envDir: '../..',
    server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } },
    preview: { port: 5174, proxy: { '/api': 'http://127.0.0.1:3001' } },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'firebase', test: /node_modules\/(?:firebase|@firebase)\// },
              {
                name: 'react-core',
                test: /node_modules\/(?:react|scheduler)\//,
              },
              { name: 'react-dom', test: /node_modules\/react-dom\// },
              { name: 'router', test: /node_modules\/(?:react-router|react-router-dom)\// },
              { name: 'validation', test: /node_modules\/zod\// },
            ],
          },
        },
      },
    },
  };
});
