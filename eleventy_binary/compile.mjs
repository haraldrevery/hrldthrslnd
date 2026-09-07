/**
 * Compile build.mjs into a standalone binary for Linux and Windows.
 *
 * Uses the Bun.build API rather than `bun build --compile` on the command line
 * because one dependency needs patching at bundle time:
 *
 *   Eleventy reads its own package.json at runtime via a path derived from
 *   import.meta.url. Inside a compiled binary that resolves to "/package.json",
 *   which does not exist, and Eleventy throws before it does anything. The
 *   plugin below replaces that one function with the values baked in at compile
 *   time. It is the only patch required — everything else, including the WASM
 *   image codecs, bundles as-is.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const eleventyPkg = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules/@11ty/eleventy/package.json"), "utf8"),
);

const shimEleventyPackageJson = {
  name: "shim-eleventy-package-json",
  setup(build) {
    build.onLoad(
      { filter: /@11ty[\\/]eleventy[\\/]src[\\/]Util[\\/]ImportJsonSync\.js$/ },
      (args) => {
        const source = fs.readFileSync(args.path, "utf8");
        const baked = JSON.stringify({
          name: eleventyPkg.name,
          version: eleventyPkg.version,
        });

        const patched = source.replace(
          /function getEleventyPackageJson\(\)\s*\{[\s\S]*?\n\}/,
          `function getEleventyPackageJson() { return ${baked}; }`,
        );

        if (patched === source) {
          throw new Error(
            "compile.mjs: could not patch getEleventyPackageJson() — Eleventy's " +
              "ImportJsonSync.js has changed shape. Update the shim in " +
              "eleventy_binary/compile.mjs before shipping a binary.",
          );
        }
        return { contents: patched, loader: "js" };
      },
    );
  },
};

const TARGETS = [
  { target: "bun-linux-x64", outfile: path.join(root, "site_generate") },
  { target: "bun-windows-x64", outfile: path.join(root, "site_generate.exe") },
];

const only = process.argv[2];
let failed = false;

for (const spec of TARGETS) {
  if (only && !spec.target.includes(only)) continue;

  process.stdout.write(`→ ${spec.target} … `);
  const result = await Bun.build({
    entrypoints: [path.join(root, "eleventy_binary/build.mjs")],
    target: "bun",
    plugins: [shimEleventyPackageJson],
    compile: { outfile: spec.outfile, target: spec.target },
  });

  if (!result.success) {
    console.log("FAILED");
    for (const message of result.logs) console.error("   ", String(message.message ?? message));
    failed = true;
    continue;
  }

  const size = fs.statSync(spec.outfile).size;
  console.log(`${path.basename(spec.outfile)} (${Math.round(size / 1024 / 1024)} MB)`);
}

process.exit(failed ? 1 : 0);
