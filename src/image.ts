/// <reference path="./vendor-typings/colorthief.d.ts"/>
import { Writable } from 'stream';
import path from 'path';
import { PNG } from 'pngjs';
import ColorThief from 'colorthief';

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

export const drawRect = (imageDstBuffer: PNG, position: Position, size: Size, color: Color) => {
  for (var currY = position.y; currY < position.y + size.height; currY++) {
    for (var currX = position.x; currX < position.x + size.width; currX++) {
      var idx = (imageDstBuffer.width * currY + currX) << 2;

      imageDstBuffer.data[idx] = color.red;
      imageDstBuffer.data[idx + 1] = color.green;
      imageDstBuffer.data[idx + 2] = color.blue;
      imageDstBuffer.data[idx + 3] = 255; // alpha
    }
  }
};

const drawSpectrum = (imageDstBuffer: PNG, spectrum: number[], size: Size, color: Color) => {
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

export const createVisualizerFrame = async (backgroundImageBuffer: Buffer, spectrum: number[], size: Size, color: Color | string) => {
  const image = await parseImage(backgroundImageBuffer);
  const rgbSpectrumColor = (typeof color === 'string') ? hexToRgb(color) : color;
  drawSpectrum(image, spectrum, size, rgbSpectrumColor);
  return image;
}

export const parseImage = (buffer: Buffer) =>
  new Promise<PNG>((resolve, reject) => {
    new PNG({ filterType: 4 }).parse(buffer, function (error, dstBuffer) {
      resolve(dstBuffer);
    });
  });

export const createImageBuffer = (image: PNG) =>
  new Promise<Buffer>((resolve) => {
    const imageBuffers: Buffer[] = [];
    const imageStream = new Writable();
    imageStream.write = function (chunkBuffer: Buffer) {
      imageBuffers.push(chunkBuffer);
      return true;
    }
    imageStream.end = function () {
      const resultBuffer = Buffer.concat(imageBuffers);
      resolve(resultBuffer);
    }

    image.pack().pipe(imageStream);
  });

export const getImageColor = async (imagePath: string) => {
  const color = await ColorThief.getColor(path.resolve(imagePath));
  return { red: color[0], green: color[1], blue: color[2] };
};

export const invertColor = (color: Color) =>
  ({ red: 255 - color.red, green: 255 - color.green, blue: 255 - color.blue });

const hexToRgb = (hex: String) => {
  const red = parseInt(hex.substring(1, 3), 16);
  const green = parseInt(hex.substring(3, 5), 16);
  const blue = parseInt(hex.substring(5, 7), 16);

  return { red, green, blue };
};
