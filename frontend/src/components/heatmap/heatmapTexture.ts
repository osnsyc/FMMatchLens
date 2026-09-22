import {
  BufferImageSource,
  Filter,
  GlProgram,
  Texture,
  UniformGroup,
} from "pixi.js"

export type HeatmapToneMapping = {
  colorGamma: number
  alphaGamma: number
  thresholds: readonly [number, number, number, number, number]
}

export const DEFAULT_HEATMAP_TONE_MAPPING: HeatmapToneMapping = {
  colorGamma: 1.2,
  alphaGamma: 0.7,
  thresholds: [0, 0.2, 0.4, 0.6, 0.8],
}

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
uniform float uColorGamma;
uniform float uAlphaGamma;
uniform float uThreshold0;
uniform float uThreshold1;
uniform float uThreshold2;
uniform float uThreshold3;
uniform float uThreshold4;
uniform vec3 uStop0;
uniform vec3 uStop1;
uniform vec3 uStop2;
uniform vec3 uStop3;
uniform vec3 uStop4;
uniform vec3 uStop5;

vec3 heatColor(float value) {
  if (value <= uThreshold0) return uStop0;
  if (value <= uThreshold1) return mix(uStop0, uStop1, (value - uThreshold0) / (uThreshold1 - uThreshold0));
  if (value <= uThreshold2) return mix(uStop1, uStop2, (value - uThreshold1) / (uThreshold2 - uThreshold1));
  if (value <= uThreshold3) return mix(uStop2, uStop3, (value - uThreshold2) / (uThreshold3 - uThreshold2));
  if (value <= uThreshold4) return mix(uStop3, uStop4, (value - uThreshold3) / (uThreshold4 - uThreshold3));
  return mix(uStop4, uStop5, (value - uThreshold4) / (1.0 - uThreshold4));
}

void main(void) {
  float density = clamp(texture(uTexture, vTextureCoord).r * uScale, 0.0, 1.0);
  if (density < 0.003) {
    finalColor = vec4(0.0);
    return;
  }
  float colorValue = pow(density, uColorGamma);
  float alphaValue = pow(density, uAlphaGamma);
  float alpha = 0.08 + alphaValue * 0.74;
  finalColor = vec4(heatColor(colorValue) * alpha, alpha);
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
    scaleMode: "linear",
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
    const toneMapping = DEFAULT_HEATMAP_TONE_MAPPING
    const heatmapUniforms = new UniformGroup({
      uScale: { value: 1, type: "f32" },
      uColorGamma: { value: toneMapping.colorGamma, type: "f32" },
      uAlphaGamma: { value: toneMapping.alphaGamma, type: "f32" },
      uThreshold0: { value: toneMapping.thresholds[0], type: "f32" },
      uThreshold1: { value: toneMapping.thresholds[1], type: "f32" },
      uThreshold2: { value: toneMapping.thresholds[2], type: "f32" },
      uThreshold3: { value: toneMapping.thresholds[3], type: "f32" },
      uThreshold4: { value: toneMapping.thresholds[4], type: "f32" },
      uStop0: { value: [0.1412, 0.3412, 1], type: "vec3<f32>" },
      uStop1: { value: [0.0863, 0.7843, 1], type: "vec3<f32>" },
      uStop2: { value: [0.2078, 0.902, 0.4353], type: "vec3<f32>" },
      uStop3: { value: [1, 0.8824, 0.2902], type: "vec3<f32>" },
      uStop4: { value: [1, 0.5412, 0.1647], type: "vec3<f32>" },
      uStop5: { value: [1, 0.1843, 0.2706], type: "vec3<f32>" },
    })
    super({
      glProgram: GlProgram.from({
        vertex: filterVertex,
        fragment: lutFragment,
        name: "heatmap-lut-filter",
      }),
      resources: { heatmapUniforms },
      resolution: 1,
      antialias: "off",
    })
    this.heatmapUniforms = heatmapUniforms
  }

  set scale(value: number) {
    this.heatmapUniforms.uniforms.uScale = value
  }

  setStops(stops: readonly number[][]) {
    stops.forEach((stop, index) => {
      this.heatmapUniforms.uniforms[`uStop${index}`] = stop
    })
    this.heatmapUniforms.update()
  }

  setToneMapping(toneMapping: Partial<HeatmapToneMapping>) {
    if (toneMapping.colorGamma != null) {
      this.heatmapUniforms.uniforms.uColorGamma = validGamma(
        toneMapping.colorGamma,
        "colorGamma"
      )
    }
    if (toneMapping.alphaGamma != null) {
      this.heatmapUniforms.uniforms.uAlphaGamma = validGamma(
        toneMapping.alphaGamma,
        "alphaGamma"
      )
    }
    if (toneMapping.thresholds) {
      assertValidThresholds(toneMapping.thresholds)
      toneMapping.thresholds.forEach((threshold, index) => {
        this.heatmapUniforms.uniforms[`uThreshold${index}`] = threshold
      })
    }
    this.heatmapUniforms.update()
  }
}

export function createHeatmapLutFilter() {
  return new HeatmapLutFilter()
}

function assertValidThresholds(
  thresholds: HeatmapToneMapping["thresholds"]
): void {
  let previous = -1
  for (const threshold of thresholds) {
    if (
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold <= previous ||
      threshold >= 1
    ) {
      throw new Error(
        "Heatmap LUT thresholds must be finite, strictly increasing values from 0 up to 1"
      )
    }
    previous = threshold
  }
}

function validGamma(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Heatmap ${name} must be a finite number greater than 0`)
  }
  return value
}
