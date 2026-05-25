import { RotationAliasName } from './index';
import { decode, BmpDecoder } from 'bmp-js';
import { EncodedBmp } from './bpmEncoder';
import Jimp from 'jimp';
import { SpectrumEffect } from './config';

export interface Color {
  red: number;
  green: number;
  blue: number;
}

interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface MixColorProps {
  color: Color;
  colorOpacity: number;
  backgroundColor: Color;
}

export const mixValues = (value1: number, value1Opacity: number, value2: number) =>
  Math.round(value2 * (1 - value1Opacity) + value1 * value1Opacity);

export const mixColors = ({
  color,
  colorOpacity,
  backgroundColor,
}: MixColorProps): Color => {
  return {
    red: mixValues(color.red, colorOpacity, backgroundColor.red),
    green: mixValues(color.green, colorOpacity, backgroundColor.green),
    blue: mixValues(color.blue, colorOpacity, backgroundColor.blue),
  };
};

const clampChannel = (value: number) =>
  value < 0 ? 0 : value > 255 ? 255 : value;

const filmNoiseHash = (x: number, y: number, frameIndex: number, channel: number) => {
  let h = (x * 374761393) ^ (y * 668265263) ^ (frameIndex * 1274126177) ^ (channel * 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0xffff) / 0xffff;
};

export const FILM_NOISE_FRAME_COUNT = 8;

export interface CreateFilmNoiseApplierProps {
  width: number;
  height: number;
  intensity: number;
}

export interface FilmNoiseApplier {
  apply: (imageDstBuffer: EncodedBmp, frameIndex: number) => void;
}

const computeFilmNoiseOffsets = (
  width: number,
  height: number,
  frameIndex: number,
  maxDeviation: number,
) => {
  const chromaScale = 0.3;
  const pixelCount = width * height;
  const offsets = new Int8Array(pixelCount * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offsetIndex = (y * width + x) * 3;
      const lumaNoise = (filmNoiseHash(x, y, frameIndex, 0) - 0.5) * 2 * maxDeviation;
      offsets[offsetIndex] = Math.round(
        lumaNoise + (filmNoiseHash(x, y, frameIndex, 1) - 0.5) * 2 * maxDeviation * chromaScale,
      );
      offsets[offsetIndex + 1] = Math.round(
        lumaNoise + (filmNoiseHash(x, y, frameIndex, 2) - 0.5) * 2 * maxDeviation * chromaScale,
      );
      offsets[offsetIndex + 2] = Math.round(
        lumaNoise + (filmNoiseHash(x, y, frameIndex, 3) - 0.5) * 2 * maxDeviation * chromaScale,
      );
    }
  }

  return offsets;
};

export const createFilmNoiseApplier = ({
  width,
  height,
  intensity,
}: CreateFilmNoiseApplierProps): FilmNoiseApplier => {
  if (intensity <= 0) {
    return { apply: () => {} };
  }

  const maxDeviation = 64 * intensity;
  const frames: Int8Array[] = [];
  for (let frameIndex = 0; frameIndex < FILM_NOISE_FRAME_COUNT; frameIndex++) {
    frames.push(computeFilmNoiseOffsets(width, height, frameIndex, maxDeviation));
  }

  return {
    apply(imageDstBuffer, frameIndex) {
      const offsets = frames[frameIndex % FILM_NOISE_FRAME_COUNT];
      const { shiftPos, rowBytes, data } = imageDstBuffer;

      for (let y = 0; y < height; y++) {
        const rowStart = shiftPos + y * rowBytes;
        const noiseRowStart = y * width * 3;
        for (let x = 0; x < width; x++) {
          const pixelIndex = rowStart + x * 3;
          const offsetIndex = noiseRowStart + x * 3;
          data[pixelIndex] = clampChannel(data[pixelIndex] + offsets[offsetIndex]);
          data[pixelIndex + 1] = clampChannel(data[pixelIndex + 1] + offsets[offsetIndex + 1]);
          data[pixelIndex + 2] = clampChannel(data[pixelIndex + 2] + offsets[offsetIndex + 2]);
        }
      }
    },
  };
};

const getRectPixelColor = (params: {
  imageDstBuffer: EncodedBmp;
  pixelIndex: number;
  color: Color;
  opacity: number;
}) => {
  const {
    imageDstBuffer,
    pixelIndex,
    color,
    opacity,
  } = params;
  if (opacity === 1) {
    return color;
  }

  const backgroundPixelColor: Color = {
    blue: imageDstBuffer.data[pixelIndex],
    green: imageDstBuffer.data[pixelIndex + 1],
    red: imageDstBuffer.data[pixelIndex + 2],
  };
  const resultColor = mixColors({
    color,
    colorOpacity: opacity,
    backgroundColor: backgroundPixelColor,
  });
  return resultColor;
};

interface DrawRectPorps {
  imageDstBuffer: EncodedBmp;
  position: Position;
  size: Size;
  color: Color;
  opacity: number;
}

export const drawRect = ({
  imageDstBuffer,
  position,
  size,
  color,
  opacity,
}: DrawRectPorps) => {
  for (let currY = position.y; currY < position.y + size.height; currY++) {
    for (let currX = position.x; currX < position.x + size.width; currX++) {
      const pixelIndex = imageDstBuffer.shiftPos + currY * imageDstBuffer.rowBytes + currX * 3;
      const pixelColor = getRectPixelColor({
        imageDstBuffer,
        pixelIndex,
        color,
        opacity,
      });
      imageDstBuffer.data[pixelIndex] = pixelColor.blue;
      imageDstBuffer.data[pixelIndex + 1] = pixelColor.green;
      imageDstBuffer.data[pixelIndex + 2] = pixelColor.red;
    }
  }
};

interface Edge {
  yMin: number;
  yMax: number;
  x: number;
  dx: number;
}

interface FillRectProps {
  imageDstBuffer: EncodedBmp;
  points: [Position, Position, Position, Position];
  color: Color;
  opacity: number;
}

const buildQuadEdgeTable = (points: [Position, Position, Position, Position]): Edge[] => {
  const edges: Edge[] = [];

  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];

    if (p1.y === p2.y) continue; // Skip horizontal edges

    const yMin = Math.min(p1.y, p2.y);
    const yMax = Math.max(p1.y, p2.y);
    const x = p1.y < p2.y ? p1.x : p2.x;
    const dx = (p2.x - p1.x) / (p2.y - p1.y);

    edges.push({ yMin, yMax, x, dx });
  }

  return edges.sort((a, b) => a.yMin - b.yMin);
};

/**
 * Fills a quadrilateral (4-sided polygon) using scan-line algorithm
 * Only the outer edges are anti-aliased
 */
export const fillRect = ({
  imageDstBuffer,
  points,
  color,
  opacity,
}: FillRectProps) => {
  // Build edge table from all 4 vertices
  const edgeTable = buildQuadEdgeTable(points);
  if (edgeTable.length === 0) return;

  // Find the bounding box
  const yMin = Math.min(...points.map(p => p.y));
  const yMax = Math.max(...points.map(p => p.y));

  // Active Edge Table for scan line algorithm
  const activeEdges: Edge[] = [];

  // Scan line algorithm: process each horizontal line
  for (let y = Math.floor(yMin); y <= Math.ceil(yMax); y++) {
    // Add edges that start at this scanline to AET
    for (const edge of edgeTable) {
      if (Math.floor(edge.yMin) === y) {
        activeEdges.push({ ...edge });
      }
    }

    // Remove edges that end at this scanline from AET
    for (let i = activeEdges.length - 1; i >= 0; i--) {
      if (Math.ceil(activeEdges[i].yMax) <= y) {
        activeEdges.splice(i, 1);
      }
    }

    // Sort active edges by x coordinate
    activeEdges.sort((a, b) => a.x - b.x);

    // Fill pixels between pairs of intersections
    for (let i = 0; i < activeEdges.length; i += 2) {
      if (i + 1 < activeEdges.length) {
        const xStart = activeEdges[i].x;
        const xEnd = activeEdges[i + 1].x;

        // Anti-aliased rendering with sub-pixel precision
        const xStartFloor = Math.floor(xStart);
        const xEndCeil = Math.ceil(xEnd);

        for (let x = xStartFloor; x < xEndCeil; x++) {
          const pixelIndex = imageDstBuffer.shiftPos + y * imageDstBuffer.rowBytes + x * 3;

          // Calculate coverage for anti-aliasing
          let coverage = 1.0;
          if (x === xStartFloor) {
            // Left edge pixel - calculate fractional coverage
            coverage = Math.min(1.0, 1.0 - (xStart - xStartFloor));
          } else if (x === xEndCeil - 1) {
            // Right edge pixel - calculate fractional coverage
            coverage = Math.min(1.0, xEnd - Math.floor(xEnd));
          }

          // Apply coverage to opacity for smooth edges
          const effectiveOpacity = opacity * coverage;

          const pixelColor = getRectPixelColor({
            imageDstBuffer,
            pixelIndex,
            color,
            opacity: effectiveOpacity,
          });
          imageDstBuffer.data[pixelIndex] = pixelColor.blue;
          imageDstBuffer.data[pixelIndex + 1] = pixelColor.green;
          imageDstBuffer.data[pixelIndex + 2] = pixelColor.red;
        }
      }
    }

    // Update x coordinates for next scanline (x' = x + dx)
    for (const edge of activeEdges) {
      edge.x += edge.dx;
    }
  }
};

interface DrawSpectrumProps {
  imageDstBuffer: EncodedBmp;
  spectrum: number[];
  size: Size;
  position: Position;
  rotation: RotationAliasName;
  margin: number;
  color: Color;
  opacity: number;
}

const getRectY = (rotation: RotationAliasName, top: number, height: number, rectHeight: number) => {
  switch (rotation) {
    case 'up':
      return top + height - rectHeight;
    case 'mirror':
      return top + Math.trunc((height - rectHeight) / 2);
    default:
      return top;
  }
};

const minRectHeight = 2;

const getRectHeight = (height: number, spectrumValue: number) => {
  const rectHeight = Math.trunc(height * spectrumValue);
  if (rectHeight < minRectHeight) {
    return minRectHeight;
  }
  return rectHeight;
};

const drawSpectrum = ({
  imageDstBuffer,
  spectrum,
  size,
  position,
  rotation,
  margin,
  color,
  opacity,
}: DrawSpectrumProps) => {
  const busWidth = Math.trunc(size.width / spectrum.length);
  const left = Math.trunc(position.x);
  const top = Math.trunc(position.y);
  const height = Math.trunc(size.height);

  for (let spectrumX = 0; spectrumX < spectrum.length; spectrumX++) {
    const spectrumValue = spectrum[spectrumX];
    if ((spectrumValue > 1) || (spectrumValue < 0)) {
      throw new Error('Spectrum values must be in range from 0 to 1');
    }

    const rectX = left + busWidth * spectrumX;
    const rectHeight = getRectHeight(height, spectrumValue);
    const rectY = getRectY(rotation, top, height, rectHeight);
    drawRect({
      imageDstBuffer,
      position: { x: rectX + margin, y: rectY },
      size: { width: busWidth - margin / 2, height: rectHeight },
      color,
      opacity,
    });
  }
};

const calcCirclePoint = (angleRadians: number, radius: number): Position => {
  const circleX = radius * Math.cos(angleRadians);
  const circleY = radius * Math.sin(angleRadians);
  return { x: circleX, y: circleY };
};

const lerp = (start: number, end: number, t: number) =>
  start + (end - start) * t;

interface DrawPolarSpectrumProps {
  imageDstBuffer: EncodedBmp;
  spectrum: number[];
  centerX: number;
  centerY: number;
  innerRadius: number;
  maxBarLength: number;
  barWidth: number;
  color: Color;
  opacity: number;
}

const drawPolarSpectrum = ({
  imageDstBuffer,
  spectrum,
  centerX,
  centerY,
  innerRadius,
  maxBarLength,
  barWidth,
  color,
  opacity,
}: DrawPolarSpectrumProps) => {
  const angleStep = (2 * Math.PI) / spectrum.length;
  const innerLength = innerRadius * 2 * Math.PI;
  const radiansPerPixel = 2 * Math.PI / innerLength;
  const barWidthInRadians = radiansPerPixel * barWidth;
  const spectrumAverage = spectrum.reduce((a, b) => a + b, 0) / spectrum.length;
  const scaleFactor = lerp(0.75, 1, spectrumAverage);
  const scaledMaxOuterRadius = (innerRadius + maxBarLength) * scaleFactor;
  const scaledInnerRadius = innerRadius * scaleFactor;
  for (let i = 0; i < spectrum.length; i++) {
    const currentSpectrumValue = spectrum[i] || 0;
    const busRadius = lerp(scaledInnerRadius, scaledMaxOuterRadius, currentSpectrumValue);
    const angle = i * angleStep;
    const angleRadiansStart = angle;
    const angleRadiansEnd = angle + barWidthInRadians;

    const point1 = calcCirclePoint(angleRadiansStart, scaledInnerRadius);
    const point2 = calcCirclePoint(angleRadiansStart, busRadius);

    const point3 = calcCirclePoint(angleRadiansEnd, scaledInnerRadius);
    const point4 = calcCirclePoint(angleRadiansEnd, busRadius);

    fillRect({
      imageDstBuffer,
      points: [
        { x: centerX + Math.round(point1.x), y: centerY + Math.round(point1.y) },
        { x: centerX + Math.round(point2.x), y: centerY + Math.round(point2.y) },
        { x: centerX + Math.round(point4.x), y: centerY + Math.round(point4.y) },
        { x: centerX + Math.round(point3.x), y: centerY + Math.round(point3.y) },
      ],
      color,
      opacity,
    });
  }
};

export interface CommonVisualizerFrameProps {
  backgroundImageBuffer: EncodedBmp;
  spectrum: number[];
}

export interface CreateVisualizerFrameProps {
  size: Size;
  position: Position;
  rotation: RotationAliasName;
  margin: number;
  color: Color | string;
  opacity: number;
  spectrumEffect?: SpectrumEffect;
}

export interface CreatePolarVisualizerFrameProps {
  centerX: number;
  centerY: number;
  innerRadius: number;
  maxBarLength: number;
  barWidth: number;
  color: Color | string;
  opacity: number;
  spectrumEffect?: SpectrumEffect;
}

export const createSpectrumVisualizerFrameGenerator = () => {
  let prevSpectrum: number[] | null = null;

  return ({
    backgroundImageBuffer,
    spectrum,
    size,
    position,
    rotation,
    margin,
    color,
    opacity,
    spectrumEffect,
  }: CommonVisualizerFrameProps & CreateVisualizerFrameProps) => {
    const imageDstBuffer = Object.assign({}, backgroundImageBuffer);
    imageDstBuffer.data = Buffer.from(backgroundImageBuffer.data);

    const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;
    if (spectrumEffect === 'volume') {
      drawSpectrum({
        imageDstBuffer,
        spectrum,
        size,
        position: { x: position.x + 2, y: position.y + 2 },
        rotation,
        margin,
        color: rgbSpectrumColor,
        opacity: opacity * 0.5,
      });
    }
    if (spectrumEffect === 'smooth' && prevSpectrum) {
      drawSpectrum({
        imageDstBuffer,
        spectrum: prevSpectrum,
        size,
        position,
        rotation,
        margin,
        color: rgbSpectrumColor,
        opacity: opacity * 0.3,
      });
    }
    drawSpectrum({
      imageDstBuffer,
      spectrum,
      size,
      position,
      rotation,
      margin,
      color: rgbSpectrumColor,
      opacity,
    });

    prevSpectrum = spectrum;

    return imageDstBuffer;
  };
};

export const createPolarVisualizerFrameGenerator = () => {
  let prevSpectrum: number[] | null = null;

  return ({
    backgroundImageBuffer,
    spectrum,
    centerX,
    centerY,
    innerRadius,
    maxBarLength,
    barWidth,
    color,
    opacity,
    spectrumEffect,
  }: CommonVisualizerFrameProps & CreatePolarVisualizerFrameProps) => {
    const imageDstBuffer = Object.assign({}, backgroundImageBuffer);
    imageDstBuffer.data = Buffer.from(backgroundImageBuffer.data);

    const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;

    if (spectrumEffect === 'volume') {
      drawPolarSpectrum({
        imageDstBuffer,
        spectrum,
        centerX: centerX + 2,
        centerY: centerY + 2,
        innerRadius,
        maxBarLength,
        barWidth,
        color: rgbSpectrumColor,
        opacity: opacity * 0.5,
      });
    }

    if (spectrumEffect === 'smooth' && prevSpectrum) {
      drawPolarSpectrum({
        imageDstBuffer,
        spectrum: prevSpectrum,
        centerX,
        centerY,
        innerRadius,
        maxBarLength,
        barWidth,
        color: rgbSpectrumColor,
        opacity: opacity * 0.3,
      });
    }

    drawPolarSpectrum({
      imageDstBuffer,
      spectrum,
      centerX,
      centerY,
      innerRadius,
      maxBarLength,
      barWidth,
      color: rgbSpectrumColor,
      opacity,
    });

    prevSpectrum = spectrum;

    return imageDstBuffer;
  };
};

export const convertToBmp = async (filePath: string, targetWidth?: number, targetHeight?: number) =>
  new Promise<Buffer>(async (resolve, reject) => {
    try {
      const image = await Jimp.read(filePath);
      if (targetWidth && targetHeight) {
        const sw = image.getWidth();
        const sh = image.getHeight();
        const isOrientationMismatch =
          (sw > sh && targetWidth < targetHeight) ||
          (sw < sh && targetWidth > targetHeight);

        if (isOrientationMismatch) {
          const targetAspect = targetWidth / targetHeight;
          let cropW: number, cropH: number, cropX: number, cropY: number;
          if (sw / sh > targetAspect) {
            cropW = Math.round(sh * targetAspect);
            cropH = sh;
            cropX = Math.round((sw - cropW) / 2);
            cropY = 0;
          } else {
            cropW = sw;
            cropH = Math.round(sw / targetAspect);
            cropX = 0;
            cropY = Math.round((sh - cropH) / 2);
          }
          image.crop(cropX, cropY, cropW, cropH);
        }

        image.resize(targetWidth, targetHeight);
      }
      image.getBuffer("image/bmp", (err, value) => {
        if (err) {
          reject(err);
        }
        resolve(value);
      });
    } catch {
      throw new Error(`Cannot procces image file from path: ${filePath}`);
    }
  });

export const parseImage = (buffer: Buffer) => decode(buffer);

export const getImageColor = (image: BmpDecoder): Color => {
  let blueSum = 0;
  let greenSum = 0;
  let redSum = 0;

  for (let currY = 0; currY < image.height; currY++) {
    for (let currX = 0; currX < image.width; currX++) {
      const idx = (image.width * currY + currX) << 2;

      blueSum += image.data[idx + 1];
      greenSum += image.data[idx + 2];
      redSum += image.data[idx + 3];
    }
  }

  const pixelsCount = image.width * image.height;
  return {
    red: ~~(redSum / pixelsCount),
    green: ~~(greenSum / pixelsCount),
    blue: ~~(blueSum / pixelsCount)
  };
};

export const getVideoFrameColor = (bgrBuffer: Buffer, width: number, height: number): Color => {
  let blueSum = 0;
  let greenSum = 0;
  let redSum = 0;
  const pixelsCount = width * height;

  for (let i = 0; i < bgrBuffer.length; i += 3) {
    blueSum += bgrBuffer[i];
    greenSum += bgrBuffer[i + 1];
    redSum += bgrBuffer[i + 2];
  }

  return {
    red: ~~(redSum / pixelsCount),
    green: ~~(greenSum / pixelsCount),
    blue: ~~(blueSum / pixelsCount),
  };
};

export const invertColor = (color: Color) =>
  ({ red: 255 - color.red, green: 255 - color.green, blue: 255 - color.blue });

const hexToRgb = (hex: String) => {
  const red = parseInt(hex.substring(1, 3), 16);
  const green = parseInt(hex.substring(3, 5), 16);
  const blue = parseInt(hex.substring(5, 7), 16);

  return { red, green, blue };
};
