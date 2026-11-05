import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildSite } from '../scripts/build.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('buildSite creates a complete static bundle for both hosting platforms', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'simimd-'));
  const outputDirectory = path.join(temporaryRoot, 'dist');

  t.after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  const copiedFiles = await buildSite({
    projectRoot,
    outputDirectory,
  });

  assert.deepEqual(copiedFiles, [
    '.nojekyll',
    '_headers',
    '_redirects',
    'css',
    'imgage',
    'index.html',
    'js',
  ]);

  const requiredFiles = [
    'index.html',
    'css/style.css',
    'imgage/icon.ico',
    'js/markdown-compat.js',
    'js/diagram-renderer.js',
    'js/diagram-worker.js',
    'js/image-cdn.js',
    'js/app.js',
    '_headers',
    '_redirects',
    '.nojekyll',
  ];

  await Promise.all(requiredFiles.map((file) => stat(path.join(outputDirectory, file))));

  const indexHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
  assert.match(indexHtml, /href="css\/style\.css"/);
  assert.match(indexHtml, /src="js\/app\.js\?v=/);
  assert.doesNotMatch(indexHtml, /href=""/);

  const nojekyll = await readFile(path.join(outputDirectory, '.nojekyll'), 'utf8');
  assert.equal(nojekyll.trim(), '');

  await assert.rejects(stat(path.join(outputDirectory, 'md.html')), {
    code: 'ENOENT',
  });
});

test('Cloudflare deployment configuration and documentation stay aligned', async () => {
  const [packageJsonText, readme, wranglerJsonText] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    readFile(path.join(projectRoot, 'README.md'), 'utf8'),
    readFile(path.join(projectRoot, 'wrangler.jsonc'), 'utf8'),
  ]);

  const packageJson = JSON.parse(packageJsonText);
  const wranglerConfig = JSON.parse(wranglerJsonText);

  assert.equal(packageJson.scripts.build, 'node scripts/build.mjs');
  assert.equal(packageJson.scripts.deploy, 'npm run build && wrangler deploy');
  assert.equal(
    packageJson.scripts['deploy:pages'],
    'npm run build && wrangler pages deploy dist --project-name simimd --branch main',
  );
  assert.equal(wranglerConfig.name, 'simimd');
  assert.equal(wranglerConfig.assets.directory, './dist');
  assert.equal(wranglerConfig.assets.html_handling, 'auto-trailing-slash');
  assert.equal('pages_build_output_dir' in wranglerConfig, false);
  assert.match(readme, /Production branch \| `main`/);
  assert.match(readme, /Build command \| `npm run build`/);
  assert.match(readme, /Build output directory \| `dist`/);
  assert.match(readme, /Pages → Import an existing Git repository/);
  assert.match(readme, /Settings → Pages → Build and deployment → Source/);
  assert.match(readme, /GitHub Pages 不执行 `_headers` 和 `_redirects`/);
  assert.doesNotMatch(readme, /SimiTalk|PC_SimiTlakTools|cfpage/);
});

test('GitHub Pages workflow builds and deploys the same dist artifact', async () => {
  const workflow = await readFile(
    path.join(projectRoot, '.github/workflows/deploy-pages.yml'),
    'utf8',
  );

  assert.match(workflow, /push:\s+branches:\s+- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version-file: \.nvmrc/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /path: dist/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /name: github-pages/);
});

test('Node version settings satisfy the locked Cloudflare deployment tools', async () => {
  const [packageText, lockText, nvmrc, readme] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'),
    readFile(path.join(projectRoot, '.nvmrc'), 'utf8'),
    readFile(path.join(projectRoot, 'README.md'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);
  const lock = JSON.parse(lockText);

  assert.equal(nvmrc.trim(), '22');
  assert.equal(packageJson.engines.node, '>=22');
  assert.equal(lock.packages[''].engines.node, packageJson.engines.node);
  assert.equal(lock.packages['node_modules/wrangler'].version, packageJson.devDependencies.wrangler);
  assert.equal(lock.packages['node_modules/wrangler'].engines.node, '>=22.0.0');
  assert.match(readme, /Node\.js 22/);
});

test('all local entry assets resolve under root and GitHub Pages project paths', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'simimd-paths-'));
  const outputDirectory = path.join(temporaryRoot, 'dist');
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  await buildSite({ projectRoot, outputDirectory });
  const indexHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
  const localAssets = [...indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((asset) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(asset));

  assert.deepEqual(localAssets.map((asset) => asset.split('?')[0]), [
    'imgage/icon.ico',
    'css/style.css',
    'js/markdown-compat.js',
    'js/diagram-renderer.js',
    'js/image-cdn.js',
    'js/app.js',
  ]);

  for (const basePath of ['/', '/mdpage/', '/renamed-repo/']) {
    const base = new URL(basePath, 'https://example.test');
    for (const asset of localAssets) {
      const url = new URL(asset, base);
      assert.equal(url.origin, base.origin);
      assert.ok(url.pathname.startsWith(basePath), `${asset} escaped ${basePath}`);
      const file = path.join(outputDirectory, url.pathname.slice(basePath.length));
      assert.ok((await stat(file)).isFile(), `${asset} is missing from the bundle`);
    }
  }
});

test('repository ignores generated and local deployment files', async () => {
  const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8');

  assert.match(gitignore, /^node_modules\/$/m);
  assert.match(gitignore, /^dist\/$/m);
  assert.match(gitignore, /^\.wrangler\/$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
});

test('build rejects destructive or linked output paths without removing markers', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'simimd-safe-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = path.join(temporaryRoot, 'project');
  await buildSite({ projectRoot, outputDirectory: fixture });
  await mkdir(path.join(fixture, '.git'));
  await writeFile(path.join(fixture, '.git', 'marker'), 'keep');
  await mkdir(path.join(fixture, 'tests'));
  await writeFile(path.join(fixture, 'tests', 'marker'), 'keep');
  for (const outputDirectory of [temporaryRoot, fixture, path.join(fixture, '.git'), path.join(fixture, 'tests'), path.join(fixture, 'js')]) {
    await assert.rejects(buildSite({ projectRoot: fixture, outputDirectory }));
    assert.equal(await readFile(path.join(fixture, '.git', 'marker'), 'utf8'), 'keep');
  }
  const external = path.join(temporaryRoot, 'private');
  await mkdir(external);
  await writeFile(path.join(external, 'secret'), 'fictional');
  await symlink(external, path.join(fixture, 'js', 'linked'));
  await assert.rejects(buildSite({ projectRoot: fixture, outputDirectory: path.join(temporaryRoot, 'output') }), /links/);
});

test('browser Markdown libraries and deterministic tests use matching pinned versions', async () => {
  const [indexHtml, packageText] = await Promise.all([
    readFile(path.join(projectRoot, 'index.html'), 'utf8'),
    readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  ]);
  const { devDependencies } = JSON.parse(packageText);
  const pinned = [...indexHtml.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/((?:markdown-it[^@/]*)|dompurify)@([^/]+)\//g)];
  const expected = Object.keys(devDependencies).filter((name) => name.startsWith('markdown-it') || name === 'dompurify');
  assert.deepEqual(pinned.map((match) => match[1]).sort(), expected.sort());
  for (const [, name, version] of pinned) assert.equal(version, devDependencies[name], name);
  assert.ok(indexHtml.indexOf('js/markdown-compat.js') < indexHtml.indexOf('js/app.js'));
});

test('lazy diagram libraries use tested versions and worker stays inside project paths', async () => {
  const [source, worker, packageText] = await Promise.all([
    readFile(path.join(projectRoot, 'js/diagram-renderer.js'), 'utf8'),
    readFile(path.join(projectRoot, 'js/diagram-worker.js'), 'utf8'),
    readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  ]);
  const { devDependencies } = JSON.parse(packageText);
  const entries = [...(source + worker).matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/(@viz-js\/viz|echarts|json5|pako)@([^/]+)\//g)];
  assert.deepEqual(entries.map((match) => match[1]).sort(), ['@viz-js/viz', 'echarts', 'json5', 'pako']);
  for (const [, name, version] of entries) assert.equal(version, devDependencies[name], name);
  for (const base of ['https://example.test/', 'https://example.test/mdpage/']) {
    const script = new URL('js/diagram-renderer.js', base);
    const worker = new URL('diagram-worker.js', script);
    assert.equal(worker.href, base + 'js/diagram-worker.js');
  }
});
