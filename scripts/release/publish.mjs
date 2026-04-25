import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const targetsPath = resolve(__dirname, './targets.json');
const packagesDir = resolve(rootDir, 'packages');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', code => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(' ')} failed with code ${code ?? 'null'}`,
        ),
      );
    });

    child.on('error', rejectPromise);
  });
}

async function getTargetPackages() {
  const config = await readJson(targetsPath);
  const names = config.packages ?? [];

  return Promise.all(
    names.map(async name => {
      const dirName = name.replace('@effector-kit/', '');
      const manifestPath = resolve(packagesDir, dirName, 'package.json');
      const manifest = await readJson(manifestPath);

      return { manifest, name };
    }),
  );
}

async function main() {
  const extraArgs = process.argv.slice(2);
  const targets = await getTargetPackages();

  for (const item of targets) {
    const access = item.manifest.publishConfig?.access;
    const args = ['--filter', item.name, 'publish', '--no-git-checks'];

    if (typeof access === 'string' && access.length > 0) {
      args.push('--access', access);
    }

    args.push(...extraArgs);

    await run('pnpm', args);
  }
}

await main();
