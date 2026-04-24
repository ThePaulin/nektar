import { describe, expect, it } from 'vitest';
import { createHaldLUTCanvas, parseCubeLUT } from '@/src/lib/lut';

const VALID_CUBE = `
TITLE "Warm LUT"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe('lut helpers', () => {
  it('parses valid .cube LUT data', () => {
    const lut = parseCubeLUT(VALID_CUBE);

    expect(lut.name).toBe('Warm LUT');
    expect(lut.size).toBe(2);
    expect(lut.data).toHaveLength(32);
    expect(Array.from(lut.data.slice(0, 4))).toEqual([0, 0, 0, 1]);
  });

  it('rejects invalid .cube data', () => {
    expect(() => parseCubeLUT('LUT_3D_SIZE 2\n0 0 0')).toThrow('Invalid .cube file');
  });

  it('creates a Hald LUT canvas with the expected dimensions', () => {
    const lut = parseCubeLUT(VALID_CUBE);
    const canvas = createHaldLUTCanvas(lut);

    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(2);
  });
});
