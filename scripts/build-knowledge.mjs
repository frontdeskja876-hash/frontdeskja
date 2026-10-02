// Generates content/generated-knowledge.js — a plain JS module with zero import-syntax
// ambiguity (no JSON import attributes, no fs reads at runtime) so the exact same
// knowledge can be imported by both the Node server (server/knowledge.mjs) and the
// Cloudflare Pages Functions (functions/api/*.js), which run in the Workers runtime and
// have no filesystem to read content/knowledge.md or content/articles.json from.
//
// content/knowledge.md and content/articles.json stay the human-edited source files.
// After editing either, regenerate:
//   npm run build:knowledge
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const knowledge = readFileSync(join(root, 'content/knowledge.md'), 'utf8');
const articlesJson = readFileSync(join(root, 'content/articles.json'), 'utf8');
const { articles } = JSON.parse(articlesJson); // validate shape before baking it in

const out = `// GENERATED FILE — do not edit directly.
// Source: content/knowledge.md + content/articles.json
// Regenerate with: npm run build:knowledge
// (plain JS, not JSON, so it imports identically under Node and the Cloudflare Pages
// Functions / esbuild bundler — no import-attribute or filesystem-access differences)

export const knowledge = ${JSON.stringify(knowledge)};

export const articles = ${JSON.stringify(articles, null, 2)};
`;

writeFileSync(join(root, 'content/generated-knowledge.js'), out);
console.log('Wrote content/generated-knowledge.js');
