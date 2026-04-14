import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'public');
const OUT_DIR = path.join(ROOT, 'dist');

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rimraf(dir) {
  if (!(await pathExists(dir))) return;
  await fs.rm(dir, { recursive: true, force: true });
}

async function mkdirp(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(src, dest) {
  await mkdirp(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(p)));
    } else if (entry.isFile()) {
      out.push(p);
    }
  }
  return out;
}

async function minifyJsFile(filePath) {
  const code = await fs.readFile(filePath, 'utf8');
  const result = await transform(code, {
    loader: 'js',
    format: 'esm',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
  });
  await fs.writeFile(filePath, result.code, 'utf8');
}

async function main() {
  console.log('[build] cleaning dist/');
  await rimraf(OUT_DIR);

  console.log('[build] copying public/ -> dist/');
  await copyDir(SRC_DIR, OUT_DIR);

  const jsRoot = path.join(OUT_DIR, 'js');
  if (await pathExists(jsRoot)) {
    console.log('[build] minifying dist/js/**/*.js');
    const files = (await listFilesRecursive(jsRoot)).filter((p) => p.endsWith('.js'));
    for (const file of files) {
      await minifyJsFile(file);
    }
    console.log(`[build] minified ${files.length} JS files`);
  } else {
    console.log('[build] no dist/js directory found; skipping JS minify');
  }

  console.log('[build] done');
}

main().catch((err) => {
  console.error('[build] failed', err);
  process.exitCode = 1;
});
