import { access, cp, mkdir, rm } from 'node:fs/promises';
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

export async function buildSite({
  projectRoot = defaultProjectRoot,
  outputDirectory = path.join(projectRoot, 'dist'),
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedOutputDirectory = path.resolve(outputDirectory);

  if (resolvedOutputDirectory === resolvedProjectRoot) {
    throw new Error('The build output directory must not be the project root.');
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
