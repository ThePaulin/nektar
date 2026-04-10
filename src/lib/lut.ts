
export interface LUTData {
  name: string;
  size: number;
  data: Float32Array;
}

export function parseCubeLUT(cubeString: string): LUTData {
  const lines = cubeString.split('\n');
  let size = 0;
  let name = 'Unknown LUT';
  const data: number[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('TITLE')) {
      name = line.split('"')[1] || line.split(' ')[1];
    } else if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(' ')[1]);
    } else {
      const parts = line.split(/\s+/).filter(p => p.length > 0);
      if (parts.length >= 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          data.push(r, g, b, 1.0); // RGBA
        }
      }
    }
  }

  if (size === 0 || data.length !== size * size * size * 4) {
    throw new Error('Invalid .cube file');
  }

  return {
    name,
    size,
    data: new Float32Array(data),
  };
}

/**
 * Converts a 3D LUT data to a 2D Hald LUT image (RGBA)
 * This is useful for Canvas 2D or WebGL 1.0 which might not support 3D textures easily.
 * For a size N LUT, the Hald image will be N x (N*N) or similar.
 */
export function createHaldLUTCanvas(lut: LUTData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const n = lut.size;
  canvas.width = n * n;
  canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  
  // lut.data is [R,G,B,A, R,G,B,A, ...] where R,G,B are 0-1
  // The order in .cube is usually R fastest, then G, then B
  for (let i = 0; i < lut.data.length; i++) {
    imageData.data[i] = Math.round(lut.data[i] * 255);
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
