const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const CACHE_ROOT = path.resolve(
  process.env.ELECTRON_BUILDER_CACHE?.trim() ||
    path.join(
      process.env.LOCALAPPDATA || path.join(os.tmpdir(), 'electron-builder-local'),
      'electron-builder',
      'Cache',
    ),
);
const APP_BUILDER = path.join(
  CLIENT_ROOT,
  'node_modules',
  'app-builder-bin',
  'win',
  'x64',
  'app-builder.exe',
);
const SEVEN_ZIP_DIR = path.join(CLIENT_ROOT, 'node_modules', '7zip-bin', 'win', 'x64');

const ARTIFACTS = [
  {
    parent: 'winCodeSign',
    name: 'winCodeSign-2.6.0',
    url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z',
    isReady: (dir) =>
      fs.existsSync(path.join(dir, 'rcedit-x64.exe')) &&
      fs.existsSync(path.join(dir, 'windows-10', 'x64', 'signtool.exe')),
  },
  {
    parent: 'nsis',
    name: 'nsis-3.0.4.1-nsis-3.0.4.1',
    url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z',
    checksum: 'VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q==',
    isReady: (dir) =>
      fs.existsSync(path.join(dir, 'makensis.exe')) ||
      fs.existsSync(path.join(dir, 'Bin', 'makensis.exe')),
  },
  {
    parent: 'nsis',
    name: 'nsis-resources-3.4.1-nsis-resources-3.4.1',
    url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z',
    checksum: 'Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0JTldxZu4NFoEmW4kJgZ3DlSWVON3+Q==',
    isReady: (dir) => fs.existsSync(path.join(dir, 'plugins', 'x86-unicode', 'UAC.dll')),
  },
];

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function listReadyTemporaryDirs(parentDir, isReady) {
  if (!fs.existsSync(parentDir)) return [];
  return fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => path.join(parentDir, entry.name))
    .filter((dir) => {
      try {
        return isReady(dir);
      } catch {
        return false;
      }
    })
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function promote(sourceDir, targetDir) {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      fs.renameSync(sourceDir, targetDir);
      return;
    } catch (error) {
      if (attempt === 20) throw error;
      sleep(500);
    }
  }
}

function runDownload(artifact) {
  const args = ['download-artifact', '--name', artifact.name, '--url', artifact.url];
  if (artifact.checksum) args.push('--sha512', artifact.checksum);

  const env = {
    ...process.env,
    PATH: `${SEVEN_ZIP_DIR}${path.delimiter}${process.env.PATH || ''}`,
    SZA_PATH: path.join(SEVEN_ZIP_DIR, '7za.exe'),
  };

  try {
    execFileSync(APP_BUILDER, args, {
      cwd: CLIENT_ROOT,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch (error) {
    // app-builder can leave a complete numeric directory and still report a
    // rename failure. The directory is promoted after the child exits.
    if (!error || error.status == null) throw error;
  }
}

function prepareArtifact(artifact) {
  const parentDir = path.join(CACHE_ROOT, artifact.parent);
  const targetDir = path.join(parentDir, artifact.name);
  fs.mkdirSync(parentDir, { recursive: true });

  if (fs.existsSync(targetDir) && artifact.isReady(targetDir)) {
    console.log(`electron-builder cache ready: ${targetDir}`);
    return;
  }

  const existingCandidate = listReadyTemporaryDirs(parentDir, artifact.isReady)[0];
  if (existingCandidate) {
    promote(existingCandidate, targetDir);
    console.log(`electron-builder cache repaired: ${targetDir}`);
    return;
  }

  console.log(`preparing electron-builder cache: ${artifact.name}`);
  runDownload(artifact);

  if (fs.existsSync(targetDir) && artifact.isReady(targetDir)) {
    console.log(`electron-builder cache ready: ${targetDir}`);
    return;
  }

  const downloadedCandidate = listReadyTemporaryDirs(parentDir, artifact.isReady)[0];
  if (!downloadedCandidate) {
    throw new Error(`electron-builder 缓存准备失败，未找到完整目录：${targetDir}`);
  }

  promote(downloadedCandidate, targetDir);
  if (!artifact.isReady(targetDir)) {
    throw new Error(`electron-builder 缓存校验失败：${targetDir}`);
  }
  console.log(`electron-builder cache repaired: ${targetDir}`);
}

function main() {
  if (process.platform !== 'win32') {
    console.log('skip electron-builder Windows cache preparation on non-Windows host');
    return;
  }
  if (!fs.existsSync(APP_BUILDER)) {
    throw new Error(`找不到 app-builder：${APP_BUILDER}`);
  }
  if (!fs.existsSync(path.join(SEVEN_ZIP_DIR, '7za.exe'))) {
    throw new Error(`找不到 7-Zip：${path.join(SEVEN_ZIP_DIR, '7za.exe')}`);
  }

  for (const artifact of ARTIFACTS) {
    prepareArtifact(artifact);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
