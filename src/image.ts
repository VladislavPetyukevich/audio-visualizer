import { RotationAliasName } from './index';
import { decode, BmpDecoder } from 'bmp-js';
import { EncodedBmp } from './bpmEncoder';
import Jimp from 'jimp';

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

export const mixValues =(value1: number, value1Opacity: number, value2: number) =>
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
    const rectHeight = Math.trunc(height * spectrumValue);
    const rectY = (rotation === 'up') ? top + height - rectHeight : top;
    drawRect({
      imageDstBuffer,
      position: { x: rectX + margin, y: rectY },
      size: { width: busWidth - margin / 2, height: rectHeight },
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
}

export const createVisualizerFrame = ({
  backgroundImageBuffer,
  spectrum,
  size,
  position,
  rotation,
  margin,
  color,
  opacity,
}: CreateVisualizerFrameProps) => {
  const imageDstBuffer = Object.assign({}, backgroundImageBuffer);
  imageDstBuffer.data = Buffer.from(backgroundImageBuffer.data);

  const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;
  if (rotation === 'mirror') {
    drawSpectrum({
      imageDstBuffer,
      spectrum,
      size: { width: size.width, height: Math.trunc(size.height / 2) },
      position: { x: position.x, y: position.y - Math.trunc(size.height / 4)},
      rotation: 'up',
      margin,
      color: rgbSpectrumColor,
      opacity,
    });
    drawSpectrum({
      imageDstBuffer,
      spectrum,
      size: { width: size.width, height: Math.trunc(size.height / 2) },
      position: { x: position.x, y: position.y + Math.trunc(size.height / 4) },
      rotation: 'down',
      margin,
      color: rgbSpectrumColor,
      opacity,
    });
  } else {
    drawSpectrum({
      imageDstBuffer,
      spectrum,
      size,
      position: { x: position.x + 4, y: position.y + 4 },
      rotation,
      margin,
      color: rgbSpectrumColor,
      opacity: opacity * 0.5,
    });
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
  }
  
  return imageDstBuffer;
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
