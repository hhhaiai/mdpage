import { access, cp, mkdir, rm, lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, '..');

const siteEntries = [
  '.nojekyll',
  '_headers',
  '_redirects',
  'css',
  'imgage',
  'index.html',
  'js',
];

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

async function canonicalPath(target) {
  try { return await realpath(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(await canonicalPath(path.dirname(target)), path.basename(target));
  }
}

async function validateInputTree(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Build inputs must be ordinary files or directories, never links.');
  if (info.isDirectory()) {
    for (const entry of await readdir(target)) {
      if (entry.startsWith('.')) throw new Error('Hidden files are not allowed inside public asset folders.');
      await validateInputTree(path.join(target, entry));
    }
  }
}

export async function buildSite({
  projectRoot = defaultProjectRoot,
  outputDirectory = path.join(projectRoot, 'dist'),
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedOutputDirectory = path.resolve(outputDirectory);

  const source = await realpath(resolvedProjectRoot);
  const output = await canonicalPath(resolvedOutputDirectory);
  if (inside(output, source) && output !== path.join(source, 'dist')) throw new Error('Inside the project, only dist may be used as build output.');
  if (!inside(output, source)) {
    try {
      const items = await readdir(output);
      if (items.length) throw new Error('External build output must be an empty or new directory.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (inside(source, output)) throw new Error('Build output must not be the source root or one of its ancestors.');
  for (const entry of siteEntries) {
    const input = path.join(source, entry);
    if (inside(input, output) || inside(output, input)) throw new Error('Build output must not overlap a source input.');
    await validateInputTree(input);
  }

  await Promise.all(
    siteEntries.map((entry) => access(path.join(resolvedProjectRoot, entry))),
  );

  await rm(resolvedOutputDirectory, { recursive: true, force: true });
  await mkdir(resolvedOutputDirectory, { recursive: true });

  await Promise.all(
    siteEntries.map((entry) => cp(
      path.join(resolvedProjectRoot, entry),
      path.join(resolvedOutputDirectory, entry),
      { recursive: true },
    )),
  );

  return [...siteEntries];
}

const isCommandLineRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCommandLineRun) {
  const copiedFiles = await buildSite();
  console.log(`Static site bundle created in dist/ (${copiedFiles.join(', ')})`);
}
