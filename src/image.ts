import { RotationAliasName } from './index';
import { decode, encode, BmpDecoder } from 'bmp-js';
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

interface DrawRectPorps {
  imageDstBuffer: BmpDecoder;
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
  for (var currY = position.y; currY < position.y + size.height; currY++) {
    for (var currX = position.x; currX < position.x + size.width; currX++) {
      var idx = (imageDstBuffer.width * currY + currX) << 2;
      if (opacity === 1) {
        imageDstBuffer.data[idx + 1] = color.blue;
        imageDstBuffer.data[idx + 2] = color.green;
        imageDstBuffer.data[idx + 3] = color.red;
        continue;
      }

      const backgroundPixelColor: Color = {
        red: imageDstBuffer.data[idx + 3],
        green: imageDstBuffer.data[idx + 2],
        blue: imageDstBuffer.data[idx + 1],
      };
      const resultColor = mixColors({
        color,
        colorOpacity: opacity,
        backgroundColor: backgroundPixelColor,
      });
      imageDstBuffer.data[idx + 1] = resultColor.blue;
      imageDstBuffer.data[idx + 2] = resultColor.green;
      imageDstBuffer.data[idx + 3] = resultColor.red;
    }
  }
};

interface DrawSpectrumProps {
  imageDstBuffer: BmpDecoder;
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
  backgroundImageBuffer: BmpDecoder;
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
  imageDstBuffer.data = Buffer.from(imageDstBuffer.data);
  const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;
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
  return imageDstBuffer;
};

export const convertToBmp = async (filePath: string) =>
  new Promise<Buffer>(async resolve => {
    const image = await Jimp.read(filePath);
    image.getBuffer("image/bmp", (err, value) => {
      resolve(value);
    });
  });

export const parseImage = (buffer: Buffer) => decode(buffer);

export const createImageBuffer = (image: BmpDecoder) => encode(image).data;

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
