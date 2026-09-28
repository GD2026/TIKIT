// The iOS app, from the command line (details: docs/ios.md).
//
//   npm run ios:configure   write domain, bundle ID, team and URL scheme from .env into the Xcode project
//   npm run ios:build       build the web app for iOS and copy it into ios/ (npx cap sync ios)
//   npm run ios             both of the above, then open Xcode
//
// Reads the same variables as the server (.env or the environment):
//   PUBLIC_URL        https://tikit.no – the server the app talks to and the universal-link domain
//                     (TIKIT_API_ORIGIN overrides it for the app only, e.g. a staging server)
//   APPLE_BUNDLE_IDS  no.tikit.app – the first one is the app's bundle ID
//   APPLE_TEAM_ID     your Apple Developer team (signing)
//   APP_URL_SCHEME    tikit (default)
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const cmd = process.argv[2] ?? 'build';

const origin = (env.TIKIT_API_ORIGIN || env.PUBLIC_URL || '').replace(/\/+$/, '');
const bundleId = (env.APPLE_BUNDLE_IDS || '').split(',')[0]?.trim() || 'no.tikit.app';
const team = env.APPLE_TEAM_ID?.trim() || '';
const scheme = env.APP_URL_SCHEME?.trim() || 'tikit';

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function run(command, extraEnv = {}) {
  console.log(`\n▸ ${command}`);
  execSync(command, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

function configure() {
  if (!existsSync('ios/App/App.xcodeproj')) fail('Fant ikke ios/App. Kjør npx cap add ios først.');
  let host = null;
  try {
    host = new URL(origin).hostname;
  } catch {
    /* no domain yet */
  }

  // Universal links: applinks:<domain> in the entitlements.
  const entFile = 'ios/App/App/App.entitlements';
  let ent = readFileSync(entFile, 'utf8');
  if (host && host !== 'localhost') ent = ent.replace(/<string>applinks:[^<]*<\/string>/, `<string>applinks:${host}</string>`);
  writeFileSync(entFile, ent);

  // Bundle ID and team in the Xcode project (both Debug and Release of the App target).
  const pbxFile = 'ios/App/App.xcodeproj/project.pbxproj';
  let pbx = readFileSync(pbxFile, 'utf8');
  pbx = pbx.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`);
  if (team) {
    pbx = pbx.replace(/\t*DEVELOPMENT_TEAM = [^;]+;\n/g, '');
    pbx = pbx.replace(/(\t+)CODE_SIGN_STYLE = Automatic;/g, `$1CODE_SIGN_STYLE = Automatic;\n$1DEVELOPMENT_TEAM = ${team};`);
  }
  writeFileSync(pbxFile, pbx);

  // URL scheme in Info.plist.
  const plistFile = 'ios/App/App/Info.plist';
  let plist = readFileSync(plistFile, 'utf8');
  plist = plist.replace(/(<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>)[^<]*(<\/string>)/, `$1${scheme}$2`);
  writeFileSync(plistFile, plist);

  // capacitor.config.ts appId (used by the Capacitor CLI).
  const capFile = 'capacitor.config.ts';
  writeFileSync(capFile, readFileSync(capFile, 'utf8').replace(/appId: '[^']*'/, `appId: '${bundleId}'`));

  console.log(`✓ Bundle ID ${bundleId}${team ? ` · team ${team}` : ' · team ikke satt (APPLE_TEAM_ID) – velg team i Xcode'} · skjema ${scheme}://`);
  console.log(host && host !== 'localhost' ? `✓ Universal links for ${host}` : '! PUBLIC_URL mangler eller er localhost – universal links er ikke satt opp');
}

function build() {
  if (!origin) fail('Serveradressen mangler. Sett PUBLIC_URL i .env, eller TIKIT_API_ORIGIN=https://tikit.no for bare appen.');
  run('npx vite build --mode native', { VITE_API_ORIGIN: origin, VITE_APP_URL_SCHEME: scheme });
  run('npx cap sync ios');
  console.log(`\n✓ iOS-appen er bygget mot ${origin}.`);
}

if (cmd === 'configure') configure();
else if (cmd === 'build') build();
else if (cmd === 'open') {
  configure();
  build();
  run('npx cap open ios');
} else fail(`Ukjent kommando: ${cmd}`);
