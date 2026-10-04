import { httpFetch } from './http-fetch';

// Loaded before every unit and integration test file (vitest.config.mts): see http-fetch.ts for why.
globalThis.fetch = httpFetch as typeof fetch;
