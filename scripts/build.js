// Packages src/ into build/map-services-enhanced-<version>.zip for the Chrome Web Store.
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { ZipArchive } from "archiver";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));

if (pkg.version !== manifest.version) {
  console.error(`Version mismatch: package.json is ${pkg.version}, src/manifest.json is ${manifest.version}`);
  process.exit(1);
}

mkdirSync("build", { recursive: true });
const outFile = `build/map-services-enhanced-${pkg.version}.zip`;
const output = createWriteStream(outFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on("close", () => console.log(`Wrote ${outFile} (${archive.pointer()} bytes)`));
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.glob("**", { cwd: "src", ignore: ["**/.DS_Store"] });
archive.finalize();
