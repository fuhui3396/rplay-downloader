import { buildDownloadPath } from './naming.js';
import { resolveWritableDirectory, writeFileToDirectory } from './output-directory.js';
import { buildSidecarPlan } from './sidecars.js';

// Writes the finished video and its Emby sidecars straight into the user's
// chosen directory. Returns null when no directory is configured or authorized
// so the caller can fall back to the browser download flow.
export async function saveToCustomDirectory(task, extension, settings, file) {
  if (!settings?.useCustomDirectory) return null;
  const root = await resolveWritableDirectory();
  if (!root) return null;

  const target = buildDownloadPath(task, extension, settings);
  await writeFileToDirectory(root, target.path, file);

  const plan = buildSidecarPlan(task, settings, target);
  for (const sidecar of plan.files) {
    await writeFileToDirectory(root, sidecar.filename, new Blob([sidecar.content], {
      type: 'application/xml;charset=utf-8',
    })).catch(() => {});
  }
  for (const image of plan.images) {
    try {
      const response = await fetch(image.url, { credentials: 'include' });
      if (!response.ok) continue;
      await writeFileToDirectory(root, image.filename, await response.blob());
    } catch {
      // Images are best-effort; skip ones the page or network does not allow.
    }
  }
  return { path: target.path, size: file.size };
}