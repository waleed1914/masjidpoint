const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const staticRoots = [publicRoot, path.join(publicRoot, 'css'), path.join(publicRoot, 'js')];
const missing = [];

for (const file of fs.readdirSync(publicRoot).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(publicRoot, file), 'utf8');
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const asset = match[1].split('?')[0];
    if (/^(?:https?:)?\/\//i.test(asset)) continue;
    const relative = asset.replace(/^\/+/, '');
    if (!staticRoots.some(base => fs.existsSync(path.join(base, relative)))) {
      missing.push(`${file}: ${asset}`);
    }
  }
}

if (missing.length) {
  console.error(`Missing public script assets:\n${missing.join('\n')}`);
  process.exit(1);
}

console.log('All HTML script assets resolve through the public static roots.');
