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

interface FillRectProps {
  imageDstBuffer: EncodedBmp;
  points: [Position, Position, Position, Position];
  color: Color;
  opacity: number;
}

interface FillPolygonProps {
  imageDstBuffer: EncodedBmp;
  points: [Position, Position, Position];
  color: Color;
  opacity: number;
}

interface Edge {
  yMin: number;
  yMax: number;
  x: number;
  dx: number;
}

const buildEdgeTable = (points: [Position, Position, Position, Position]): Edge[] => {
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

const buildPolygonEdgeTable = (points: [Position, Position, Position]): Edge[] => {
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

export const fillRect = ({
  imageDstBuffer,
  points,
  color,
  opacity,
}: FillRectProps) => {
  const edgeTable = buildEdgeTable(points);
  if (edgeTable.length === 0) return;

  const yMin = Math.min(...points.map(p => p.y));
  const yMax = Math.max(...points.map(p => p.y));

  const activeEdges: Edge[] = [];

  for (let y = Math.floor(yMin); y <= Math.ceil(yMax); y++) {
    // Add edges that start at this scanline
    for (const edge of edgeTable) {
      if (Math.floor(edge.yMin) === y) {
        activeEdges.push({ ...edge });
      }
    }

    // Remove edges that end at this scanline
    for (let i = activeEdges.length - 1; i >= 0; i--) {
      if (Math.ceil(activeEdges[i].yMax) <= y) {
        activeEdges.splice(i, 1);
      }
    }

    // Sort active edges by x coordinate
    activeEdges.sort((a, b) => a.x - b.x);

    // Fill between pairs of intersections
    for (let i = 0; i < activeEdges.length; i += 2) {
      if (i + 1 < activeEdges.length) {
        const xStart = Math.floor(activeEdges[i].x);
        const xEnd = Math.ceil(activeEdges[i + 1].x);

        for (let x = xStart; x < xEnd; x++) {
          const pixelIndex = imageDstBuffer.shiftPos + y * imageDstBuffer.rowBytes + x * 3;
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
    }

    // Update x coordinates for next scanline
    for (const edge of activeEdges) {
      edge.x += edge.dx;
    }
  }
};

/**
 * Fills a triangle using the Scan Line Polygon Fill Algorithm
 * @param imageDstBuffer - The destination image buffer
 * @param points - Array of 3 triangle vertices
 * @param color - Fill color
 * @param opacity - Opacity value (0-1)
 */
export const fillPolygon = ({
  imageDstBuffer,
  points,
  color,
  opacity,
}: FillPolygonProps) => {
  // Build edge table from triangle vertices
  const edgeTable = buildPolygonEdgeTable(points);
  if (edgeTable.length === 0) return;

  // Find the bounding box of the polygon
  const yMin = Math.min(...points.map(p => p.y));
  const yMax = Math.max(...points.map(p => p.y));

  // Active Edge Table (AET) for scan line algorithm
  const activeEdges: Edge[] = [];

  // Scan line algorithm: process each horizontal line
  for (let y = Math.floor(yMin); y <= Math.ceil(yMax); y++) {
    // Step 1: Add edges that start at this scanline to AET
    for (const edge of edgeTable) {
      if (Math.floor(edge.yMin) === y) {
        activeEdges.push({ ...edge });
      }
    }

    // Step 2: Remove edges that end at this scanline from AET
    for (let i = activeEdges.length - 1; i >= 0; i--) {
      if (Math.ceil(activeEdges[i].yMax) <= y) {
        activeEdges.splice(i, 1);
      }
    }

    // Step 3: Sort active edges by x coordinate
    activeEdges.sort((a, b) => a.x - b.x);

    // Step 4: Fill pixels between pairs of intersections (parity fill rule)
    for (let i = 0; i < activeEdges.length; i += 2) {
      if (i + 1 < activeEdges.length) {
        const xStart = Math.floor(activeEdges[i].x);
        const xEnd = Math.ceil(activeEdges[i + 1].x);

        // Fill the span between the two intersection points
        for (let x = xStart; x < xEnd; x++) {
          const pixelIndex = imageDstBuffer.shiftPos + y * imageDstBuffer.rowBytes + x * 3;
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
    }

    // Step 5: Update x coordinates for next scanline (x' = x + dx)
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

const degreesToRadians = (degrees: number) =>
  degrees * (Math.PI / 180);

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
  startAngle?: number;
  endAngle?: number;
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
  // startAngle = 0,
  // endAngle = 2 * Math.PI,
}: DrawPolarSpectrumProps) => {
  const angleStep = Math.floor(360 / spectrum.length);
  const busWidth = 10;
  const margin = Math.floor(busWidth / 2);
  const busHeight = Math.trunc(innerRadius * 0.6);
  const spectrumAverage = spectrum.reduce((a, b) => a + b, 0) / spectrum.length;
  for (let i = 0; i < spectrum.length; i++) {
    const angle = i * angleStep;
    const angleRadiansStart = degreesToRadians(angle + margin / 2);
    const angleRadiansEnd = degreesToRadians(angle + busWidth - margin / 2);
    const currentSpectrumValue = spectrum[i] || 0;
    const radiusBottom = (innerRadius - busHeight) * (spectrumAverage * 0.3);
    const radiusTop = radiusBottom + busHeight * (currentSpectrumValue + spectrumAverage * 0.3);

    const point1 = calcCirclePoint(angleRadiansStart, radiusBottom);
    const point2 = calcCirclePoint(angleRadiansStart, radiusTop);

    const point3 = calcCirclePoint(angleRadiansEnd, radiusBottom);
    const point4 = calcCirclePoint(angleRadiansEnd, radiusTop);

    fillPolygon({
      imageDstBuffer,
      points: [
        { x: centerX + Math.round(point1.x), y: centerY + Math.round(point1.y) },
        { x: centerX + Math.round(point2.x), y: centerY + Math.round(point2.y) },
        { x: centerX + Math.round(point3.x), y: centerY + Math.round(point3.y) },
      ],
      color,
      opacity,
    });

    fillPolygon({
      imageDstBuffer,
      points: [
        { x: centerX + Math.round(point2.x), y: centerY + Math.round(point2.y) },
        { x: centerX + Math.round(point3.x), y: centerY + Math.round(point3.y) },
        { x: centerX + Math.round(point4.x), y: centerY + Math.round(point4.y) },
      ],
      color,
      opacity,
    });
  }
};

interface CreateVisualizerFrameProps {
  backgroundImageBuffer: EncodedBmp;
  spectrum: number[];
  size: Size;
  position: Position;
  rotation: RotationAliasName;
  margin: number;
  color: Color | string;
  opacity: number;
  spectrumEffect?: SpectrumEffect;
}

interface CreatePolarVisualizerFrameProps {
  backgroundImageBuffer: EncodedBmp;
  spectrum: number[];
  centerX: number;
  centerY: number;
  innerRadius: number;
  maxBarLength: number;
  barWidth: number;
  color: Color | string;
  opacity: number;
  startAngle?: number;
  endAngle?: number;
  spectrumEffect?: SpectrumEffect;
}

export const createVisualizerFrameGenerator = () => {
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
  }: CreateVisualizerFrameProps) => {
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
    startAngle = 0,
    endAngle = 2 * Math.PI,
    spectrumEffect,
  }: CreatePolarVisualizerFrameProps) => {
    const imageDstBuffer = Object.assign({}, backgroundImageBuffer);
    imageDstBuffer.data = Buffer.from(backgroundImageBuffer.data);

    const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;

    // Draw shadow/volume effect
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
        startAngle,
        endAngle,
      });
    }

    // Draw smooth/trail effect with previous frame
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
        startAngle,
        endAngle,
      });
    }

    // Draw main spectrum
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
      startAngle,
      endAngle,
    });

    prevSpectrum = spectrum;

    return imageDstBuffer;
  };
};

export const convertToBmp = async (filePath: string) =>
  new Promise<Buffer>(async (resolve, reject) => {
    try {
      const image = await Jimp.read(filePath);
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

export const invertColor = (color: Color) =>
  ({ red: 255 - color.red, green: 255 - color.green, blue: 255 - color.blue });

const hexToRgb = (hex: String) => {
  const red = parseInt(hex.substring(1, 3), 16);
  const green = parseInt(hex.substring(3, 5), 16);
  const blue = parseInt(hex.substring(5, 7), 16);

  return { red, green, blue };
};
