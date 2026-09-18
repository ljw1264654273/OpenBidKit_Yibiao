const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ILLUSTRATION_ASSET_PREFIX = 'technical-plan/illustrations/';

function decodeAssetPath(url) {
  const assetUrl = new URL(String(url || ''));
  return {
    hostname: assetUrl.hostname,
    relativePath: decodeURIComponent(assetUrl.pathname.replace(/^\/+/, '')),
  };
}

function resolveWithinRoot(rootDir, relativePath) {
  if (!rootDir || !relativePath) return null;
  const baseDir = path.resolve(rootDir);
  const resolvedPath = path.resolve(baseDir, relativePath);
  if (resolvedPath !== baseDir && !resolvedPath.startsWith(`${baseDir}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

function resolveExistingCandidate(candidates, fileSystem) {
  for (const candidate of candidates) {
    const resolvedPath = resolveWithinRoot(candidate.rootDir, candidate.relativePath);
    if (resolvedPath && fileSystem.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }
  return null;
}

function resolveYibiaoAssetPath(url, {
  generatedImagesDir,
  importedImagesDir,
  projectTechnicalPlanDir,
  projectTechnicalPlanDirs = [],
  fileSystem = fs,
} = {}) {
  let parsed;
  try {
    parsed = decodeAssetPath(url);
  } catch {
    return null;
  }

  if (!parsed.relativePath) return null;
  if (parsed.hostname === 'imported-images') {
    return resolveExistingCandidate([{
      rootDir: importedImagesDir,
      relativePath: parsed.relativePath,
    }], fileSystem);
  }
  if (parsed.hostname !== 'generated-images') return null;

  const candidates = [];
  if (projectTechnicalPlanDir && parsed.relativePath.startsWith(PROJECT_ILLUSTRATION_ASSET_PREFIX)) {
    candidates.push({
      rootDir: path.join(projectTechnicalPlanDir, 'generated-illustrations'),
      relativePath: parsed.relativePath.slice(PROJECT_ILLUSTRATION_ASSET_PREFIX.length),
    });
  }
  candidates.push({
    rootDir: generatedImagesDir,
    relativePath: parsed.relativePath,
  });
  if (parsed.relativePath.startsWith(PROJECT_ILLUSTRATION_ASSET_PREFIX)) {
    for (const technicalPlanDir of projectTechnicalPlanDirs) {
      candidates.push({
        rootDir: path.join(technicalPlanDir, 'generated-illustrations'),
        relativePath: parsed.relativePath.slice(PROJECT_ILLUSTRATION_ASSET_PREFIX.length),
      });
    }
  }
  return resolveExistingCandidate(candidates, fileSystem);
}

module.exports = {
  PROJECT_ILLUSTRATION_ASSET_PREFIX,
  resolveYibiaoAssetPath,
};
