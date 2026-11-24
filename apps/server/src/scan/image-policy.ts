import sharp from 'sharp';

/**
 * Only JPEG and WebP loaders may run (AGENTS §2.8 / 1b decision). Block every
 * libvips input loader first, then re-enable just the two we accept, so GIF,
 * TIFF, HEIF/HEIC, SVG, PDF, VIPS and raw loaders stay unavailable even if a
 * crafted file reaches sharp through another path.
 */
let applied = false;

export function applyImagePolicy(): void {
  if (applied) return;
  sharp.block({ operation: ['VipsForeignLoad'] });
  sharp.unblock({
    operation: [
      'VipsForeignLoadJpegFile',
      'VipsForeignLoadJpegBuffer',
      'VipsForeignLoadWebpFile',
      'VipsForeignLoadWebpBuffer',
    ],
  });
  applied = true;
}

applyImagePolicy();
