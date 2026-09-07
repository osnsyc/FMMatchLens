import {
  BufferImageSource,
  Filter,
  GlProgram,
  Texture,
  UniformGroup,
} from "pixi.js"

const filterVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`

const lutFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uScale;

vec3 heatColor(float value) {
  vec3 blue = vec3(0.1412, 0.3412, 1.0);
  vec3 cyan = vec3(0.0863, 0.7843, 1.0);
  vec3 green = vec3(0.2078, 0.9020, 0.4353);
  vec3 yellow = vec3(1.0, 0.8824, 0.2902);
  vec3 orange = vec3(1.0, 0.5412, 0.1647);
  vec3 red = vec3(1.0, 0.1843, 0.2706);
  if (value <= 0.15) return blue;
  if (value <= 0.35) return mix(blue, cyan, (value - 0.15) / 0.20);
  if (value <= 0.55) return mix(cyan, green, (value - 0.35) / 0.20);
  if (value <= 0.75) return mix(green, yellow, (value - 0.55) / 0.20);
  if (value <= 0.90) return mix(yellow, orange, (value - 0.75) / 0.15);
  return mix(orange, red, (value - 0.90) / 0.10);
}

void main(void) {
  float value = clamp(texture(uTexture, vTextureCoord).r * uScale, 0.0, 1.0);
  if (value < 0.003) {
    finalColor = vec4(0.0);
    return;
  }
  float alpha = 0.08 + value * 0.74;
  finalColor = vec4(heatColor(value) * alpha, alpha);
}`

export type DensityTexture = {
  data: Float32Array
  source: BufferImageSource
  texture: Texture<BufferImageSource>
}

export function createDensityTexture(
  width: number,
  height: number
): DensityTexture {
  const data = new Float32Array(width * height * 4)
  const source = new BufferImageSource({
    resource: data,
    width,
    height,
    format: "rgba32float",
    scaleMode: "nearest",
    autoGenerateMipmaps: false,
    autoGarbageCollect: false,
    label: "heatmap-density-f32",
  })
  return {
    data,
    source,
    texture: new Texture({ source, dynamic: true, label: "heatmap-density" }),
  }
}

export class HeatmapLutFilter extends Filter {
  private readonly heatmapUniforms: UniformGroup

  constructor() {
    const heatmapUniforms = new UniformGroup({
      uScale: { value: 1, type: "f32" },
    })
    super({
      glProgram: GlProgram.from({
        vertex: filterVertex,
        fragment: lutFragment,
        name: "heatmap-lut-filter",
      }),
      resources: { heatmapUniforms },
      resolution: 0.5,
      antialias: "off",
    })
    this.heatmapUniforms = heatmapUniforms
  }

  set scale(value: number) {
    this.heatmapUniforms.uniforms.uScale = value
  }
}

export function createHeatmapLutFilter() {
  return new HeatmapLutFilter()
}
