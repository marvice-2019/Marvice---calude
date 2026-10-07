// Rebrands an Open-Generative-AI checkout as "Marvice AI Studio".
// Run from the checkout root before `npm run build`:  node <this dir>/apply.mjs
// Each edit is an exact string match; when upstream changes and one no longer
// matches, a warning is printed and the build continues with upstream branding there.
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAND = 'Marvice AI Studio';
const HERE = dirname(fileURLToPath(import.meta.url));
let warnings = 0;

function edit(file, from, to, { all = false } = {}) {
  if (!existsSync(file)) { console.warn(`brand: missing ${file}`); warnings++; return; }
  const src = readFileSync(file, 'utf8');
  if (!src.includes(from)) { console.warn(`brand: no match in ${file}: ${from.slice(0, 60)}`); warnings++; return; }
  writeFileSync(file, all ? src.split(from).join(to) : src.replace(from, to));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|json|html)$/.test(name)) out.push(p);
  }
  return out;
}

// 1. Product name in page titles, UI copy and translations
const files = [
  ...walk('app'), ...walk('messages'), ...walk('packages/studio/src'),
  'src/lib/i18n.js', 'index.html',
];
let renamed = 0;
for (const f of files) {
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  const out = src
    .replaceAll('Open Generative AI Studio', BRAND)
    .replaceAll('Open Generative AI', BRAND)
    .replaceAll('"OpenGenerativeAI"', `"${BRAND}"`);
  if (out !== src) { writeFileSync(f, out); renamed++; }
}
if (!renamed) { console.warn('brand: product name not found anywhere'); warnings++; }

// 2. Logo in the header: Marvice mark on a white tile instead of the cyan layers icon
copyFileSync(join(HERE, 'marvice-mark.svg'), 'public/marvice-mark.svg');
edit('components/StandaloneShell.js',
  `<div className="w-8 h-8 bg-[#22d3ee] rounded-lg flex items-center justify-center shadow-lg shadow-[#22d3ee]/20">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>`,
  `<div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-lg shadow-black/30">
                <img src="/marvice-mark.svg" alt="Marvice" width="26" height="26" />
              </div>`);

// Same mark on the API-key screen, in place of the key icon
edit('components/ApiKeyModal.js',
  `<div className="w-14 h-14 bg-[#22d3ee]/5 rounded-2xl flex items-center justify-center border border-[#22d3ee]/10 mb-6 group hover:border-[#22d3ee]/30 transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.5" className="group-hover:scale-110 transition-transform">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L12 17.25l-4.5-4.5L15.5 7.5z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>`,
  `<div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-black/30">
            <img src="/marvice-mark.svg" alt="Marvice" width="44" height="44" />
          </div>`);

// 3. Favicon (Next.js app-router convention)
copyFileSync(join(HERE, 'marvice-mark.svg'), 'app/icon.svg');

// 4. Drop the third-party promo banner (vadoo.tv) shown above the studio
edit('components/StandaloneShell.js',
  `if (typeof window !== 'undefined') return localStorage.getItem('vadoo_banner_dismissed') !== '1';`,
  `return false;`);

console.log(`brand: ${BRAND} applied to ${renamed} files${warnings ? `, ${warnings} warning(s)` : ''}`);
