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

export const drawRect = (imageDstBuffer: BmpDecoder, position: Position, size: Size, color: Color) => {
  for (var currY = position.y; currY < position.y + size.height; currY++) {
    for (var currX = position.x; currX < position.x + size.width; currX++) {
      var idx = (imageDstBuffer.width * currY + currX) << 2;

      imageDstBuffer.data[idx + 1] = color.blue;
      imageDstBuffer.data[idx + 2] = color.green;
      imageDstBuffer.data[idx + 3] = color.red;
    }
  }
};

const drawSpectrum = (imageDstBuffer: BmpDecoder, spectrum: number[], size: Size, color: Color) => {
  const paddingLeft = Math.trunc(imageDstBuffer.width / 2 - size.width / 2);
  const busWidth = size.width / spectrum.length;

  for (let spectrumX = 0; spectrumX < spectrum.length; spectrumX++) {
    const spectrumValue = spectrum[spectrumX];
    if ((spectrumValue > 1) || (spectrumValue < 0)) {
      throw new Error('Spectrum values must be in range from 0 to 1');
    }

    const rectX = paddingLeft + busWidth * spectrumX;
    const rectHeight = size.height * spectrumValue;
    drawRect(imageDstBuffer, { x: rectX, y: 0 }, { width: busWidth, height: rectHeight }, color);
  }
};

export const createVisualizerFrame = (backgroundImageBuffer: BmpDecoder, spectrum: number[], size: Size, color: Color | string) => {
  const image = Object.assign({}, backgroundImageBuffer);
  image.data = Buffer.from(image.data);
  const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;
  drawSpectrum(image, spectrum, size, rgbSpectrumColor);
  return image;
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
