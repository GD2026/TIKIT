// Turns the single-file demo build into a page fragment for hosting as a claude.ai Artifact:
// the host adds <!doctype>/<head>/<body>, so we emit <title>, styles, markup and the inline module script.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-demo/index.html', 'utf8');
const pick = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`Fant ikke ${label} i dist-demo/index.html`);
  return m;
};

const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const script = pick(/<script type="module"[^>]*>([\s\S]*?)<\/script>/, 'app-skriptet')[1];
const body = pick(/<body>([\s\S]*?)<\/body>/, '<body>')[1].trim();
if (styles.length < 2) throw new Error('Forventet oppstartsstil og app-stil');

// The bundle contains HTML documents as strings (e-mail templates, the demo inbox). Escape their
// document-level tags so the host never mistakes them for page structure. Inside JS string, template
// and regex literals these escapes produce exactly the same runtime text.
const safeScript = script
  .replace(/<!doctype/gi, (m) => `<\\u0021${m.slice(2)}`)
  .replace(/<(\/?)(html|head|body)\b/gi, (_m, slash, tag) => `<${slash ? '\\/' : ''}\\u00${tag.charCodeAt(0).toString(16)}${tag.slice(1)}`);

const out = [
  '<title>TIKIT</title>',
  '<meta name="description" content="TIKIT – billetter til russetreff, fester, busslanseringer og revyer. Live demo.">',
  ...styles.map((css) => `<style>${css}</style>`),
  body,
  `<script type="module">${safeScript}</script>`,
  '',
].join('\n');

writeFileSync('dist-demo/tikit.html', out);
console.log(`dist-demo/tikit.html (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
