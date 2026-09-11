declare module "*.svg" { const content: string; export default content; }
declare module "*.txt" { const content: string; export default content; }
declare module "cloudflare:email" { export class EmailMessage { constructor(from: string, to: string, raw: string | ReadableStream); } }
