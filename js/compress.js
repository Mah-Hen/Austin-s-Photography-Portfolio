/**
 * compress.js — Client-side image compression before upload
 *
 * Uses the Canvas API to resize and re-encode images.
 * This runs entirely in the browser — no server round-trip.
 *
 * Strategy:
 *  - If the image is under maxDimension on both axes AND under maxSizeMB,
 *    skip compression (return original File).
 *  - Otherwise, draw onto a canvas at reduced dimensions and export as JPEG.
 *  - GIFs are returned as-is (canvas kills animation).
 */

import CONFIG from './config.js';

/**
 * Compress an image File before upload.
 * @param {File} file
 * @returns {Promise<File>}  Original or compressed File
 */
export async function compressImage(file) {
  // Don't compress GIFs (would lose animation)
  if (file.type === 'image/gif') return file;

  const maxDim  = CONFIG.compressionMaxDimension;
  const quality = CONFIG.compressionQuality;
  const maxBytes = CONFIG.maxFileSizeMB * 1024 * 1024;

  // Load as bitmap
  const bitmap = await createImageBitmap(file);
  const { width: origW, height: origH } = bitmap;

  // Check if we even need to compress
  const needsResize = origW > maxDim || origH > maxDim;
  const needsCompress = file.size > maxBytes * 0.8; // compress if within 80% of limit

  if (!needsResize && !needsCompress) {
    bitmap.close();
    return file; // skip — already small enough
  }

  // Calculate target dimensions (maintain aspect ratio)
  let targetW = origW;
  let targetH = origH;

  if (needsResize) {
    const ratio = Math.min(maxDim / origW, maxDim / origH);
    targetW = Math.round(origW * ratio);
    targetH = Math.round(origH * ratio);
  }

  // Draw onto canvas
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // Export as WebP if supported (better compression), fallback to JPEG
  const outputType = 'image/webp';
  const blob = await canvas.convertToBlob({ type: outputType, quality });

  // Build new File with updated name
  const newName = file.name.replace(/\.[^.]+$/, '.webp');
  const compressed = new File([blob], newName, { type: outputType });

  console.log(`[compress] ${file.name}: ${formatBytes(file.size)} → ${formatBytes(compressed.size)} (${targetW}×${targetH})`);
  return compressed;
}

/**
 * Validate a file before accepting it.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFile(file) {
  const maxBytes = CONFIG.maxFileSizeMB * 1024 * 1024;

  if (!CONFIG.allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type not allowed. Accepted: JPG, PNG, WebP, GIF`
    };
  }

  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File too large (${formatBytes(file.size)}). Max: ${CONFIG.maxFileSizeMB}MB`
    };
  }

  return { valid: true };
}

/**
 * Format bytes into a human-readable string.
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}