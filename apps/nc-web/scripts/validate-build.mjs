import { readFileSync } from 'node:fs';
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
for (const path of ['/v1/*', '/img/*']) {
  if (!redirects.split('\n').some(line => line.startsWith(path + ' '))) throw new Error('Missing proxy: ' + path);
}
for (const asset of ['index.html', 'home.js', 'styles.css', 'brand-mark.png', '_headers']) readFileSync(new URL('../public/' + asset, import.meta.url));
console.log('Netlify public assets and staging proxy rules validated.');
