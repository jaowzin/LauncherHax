const fs = require('fs');
const path = require('path');
const archiverModule = require('archiver');
const archiver = archiverModule.default || archiverModule;

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist', 'LauncherHax-win32-x64');
const outDir = path.join(root, 'release');
const outputPath = path.join(outDir, 'LauncherHax-win-x64.zip');

fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(source)) {
  console.error('Build folder not found. Run npm run package:win first.');
  process.exit(1);
}

const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => console.log(`Created ${outputPath} (${archive.pointer()} bytes)`));
archive.on('error', err => { throw err; });
archive.pipe(output);
archive.directory(source, 'LauncherHax');
archive.finalize();
