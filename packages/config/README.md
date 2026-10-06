# Shared configuration

Root `tsconfig.base.json` defines strict TypeScript, `eslint.config.js` defines the lint baseline, and `.prettierrc.json` defines formatting. Apps extend the base and use separate browser/server module resolution. Keep credentials in the root `.env`, never build-time client source.
