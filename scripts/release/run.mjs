import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const targetsPath = resolve(__dirname, "./targets.json");
const packagesDir = resolve(rootDir, "packages");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "null"}`));
    });

    child.on("error", rejectPromise);
  });
}

async function getTargetPackages() {
  const config = await readJson(targetsPath);
  const names = config.packages ?? [];
  const manifests = await Promise.all(
    names.map(async (name) => {
      const dirName = name.replace("@effector-kit/", "");
      const manifestPath = resolve(packagesDir, dirName, "package.json");
      const manifest = await readJson(manifestPath);

      return {
        dirName,
        manifest,
        manifestPath,
        name,
      };
    }),
  );

  return manifests;
}

async function listTargets() {
  const manifests = await getTargetPackages();

  for (const item of manifests) {
    console.log(item.name);
  }
}

async function runPackageScript(scriptName) {
  const manifests = await getTargetPackages();

  for (const item of manifests) {
    const scripts = item.manifest.scripts ?? {};

    if (!(scriptName in scripts)) {
      throw new Error(
        `Package ${item.name} is missing the "${scriptName}" script required by the release flow`,
      );
    }

    await run("pnpm", ["--filter", item.name, "run", scriptName]);
  }
}

async function main() {
  const command = process.argv[2];

  if (!command) {
    throw new Error("Usage: node ./scripts/release/run.mjs <list|build|test|verify>");
  }

  if (command === "list") {
    await listTargets();
    return;
  }

  if (command === "verify") {
    await runPackageScript("build");
    await runPackageScript("test");
    return;
  }

  if (command === "build" || command === "test") {
    await runPackageScript(command);
    return;
  }

  throw new Error(`Unknown release command: ${command}`);
}

await main();
