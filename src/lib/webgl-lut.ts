
export class WebGLLUT {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private lutTexture: WebGLTexture;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
    if (!gl) {
      throw new Error("WebGL 2 not supported");
    }
    this.gl = gl;

    const vs = `#version 300 es
      in vec2 position;
      out vec2 vTexCoord;
      uniform vec4 uCrop; // top, right, bottom, left in percentages (0-100)

      void main() {
        vec2 baseCoord = position * 0.5 + 0.5;
        
        float left = uCrop.w / 100.0;
        float right = uCrop.y / 100.0;
        float top = uCrop.x / 100.0;
        float bottom = uCrop.z / 100.0;
        
        vTexCoord.x = left + baseCoord.x * (1.0 - left - right);
        vTexCoord.y = top + (1.0 - baseCoord.y) * (1.0 - top - bottom);
        
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fs = `#version 300 es
      precision mediump float;
      precision mediump sampler3D;
      
      in vec2 vTexCoord;
      uniform sampler2D uTexture;
      uniform sampler3D uLut;
      uniform float uIntensity;
      uniform vec4 uOverlayRect; // x, y, w, h in normalized coords
      uniform bool uIsOverlay;
      
      out vec4 fragColor;

      void main() {
        vec4 color = texture(uTexture, vTexCoord);
        
        bool applyLut = true;
        if (uIsOverlay) {
          if (vTexCoord.x < uOverlayRect.x || vTexCoord.x > uOverlayRect.x + uOverlayRect.z ||
              vTexCoord.y < uOverlayRect.y || vTexCoord.y > uOverlayRect.y + uOverlayRect.w) {
            applyLut = false;
          }
        }

        if (applyLut) {
          float size = float(textureSize(uLut, 0).x);
          vec3 coords = color.rgb * ((size - 1.0) / size) + (0.5 / size);
          vec3 lutColor = texture(uLut, coords).rgb;
          fragColor = vec4(mix(color.rgb, lutColor, uIntensity), color.a);
        } else {
          fragColor = color;
        }
      }
    `;

    this.program = this.createProgram(vs, fs);
    this.texture = gl.createTexture()!;
    this.lutTexture = gl.createTexture()!;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(fs));
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }

  apply(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    lutData: { size: number, data: Float32Array },
    intensity: number,
    overlayRect?: { x: number; y: number; width: number; height: number },
    sourceWidth?: number,
    sourceHeight?: number,
    crop?: { top: number; right: number; bottom: number; left: number }
  ) {
    const gl = this.gl;
    const prog = this.program;

    gl.useProgram(prog);

    // Set crop uniform
    const cropLoc = gl.getUniformLocation(prog, 'uCrop');
    if (crop) {
      gl.uniform4f(cropLoc, crop.top, crop.right, crop.bottom, crop.left);
    } else {
      gl.uniform4f(cropLoc, 0, 0, 0, 0);
    }

    // Setup geometry
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Upload source texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTexture'), 0);

    // Upload 3D LUT texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    
    // Convert to RGBA8 if needed, or use RGBA32F if supported
    // For simplicity and compatibility, we'll use RGBA8
    const size = lutData.size;
    const lutUint8 = new Uint8Array(lutData.data.length);
    for (let i = 0; i < lutData.data.length; i++) {
      lutUint8[i] = Math.max(0, Math.min(255, Math.round(lutData.data[i] * 255)));
    }

    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      size,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lutUint8
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'uLut'), 1);

    gl.uniform1f(gl.getUniformLocation(prog, 'uIntensity'), intensity);

    if (overlayRect && sourceWidth && sourceHeight) {
      gl.uniform1i(gl.getUniformLocation(prog, 'uIsOverlay'), 1);
      gl.uniform4f(
        gl.getUniformLocation(prog, 'uOverlayRect'),
        overlayRect.x / sourceWidth,
        overlayRect.y / sourceHeight,
        overlayRect.width / sourceWidth,
        overlayRect.height / sourceHeight
      );
    } else {
      gl.uniform1i(gl.getUniformLocation(prog, 'uIsOverlay'), 0);
    }

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    gl.deleteBuffer(posBuffer);
  }
}
