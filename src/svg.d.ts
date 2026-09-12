declare module "*.svg" { const content: string; export default content; }
declare module "*.txt" { const content: string; export default content; }
// Vite's ?raw suffix: test/flags.test.ts reads wrangler.jsonc itself rather than a copy of its flag list.
declare module "*?raw" { const content: string; export default content; }
declare module "cloudflare:email" { export class EmailMessage { constructor(from: string, to: string, raw: string | ReadableStream); } }
