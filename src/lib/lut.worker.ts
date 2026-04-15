
import { parseCubeLUT } from './lut';

self.onmessage = async (e) => {
  const { type, cubeString, id } = e.data;
  
  if (type === 'PARSE_LUT') {
    try {
      const lutData = parseCubeLUT(cubeString);
      // Transfer the Float32Array to avoid copying
      self.postMessage({ 
        type: 'PARSE_LUT_SUCCESS', 
        id, 
        lutData: {
          name: lutData.name,
          size: lutData.size,
          data: lutData.data
        }
      }, [lutData.data.buffer] as any);
    } catch (error) {
      self.postMessage({ 
        type: 'PARSE_LUT_ERROR', 
        id, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
};
