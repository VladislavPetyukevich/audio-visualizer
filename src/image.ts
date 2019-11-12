/// <reference path="./vendor-typings/colorthief.d.ts"/>
import { Writable } from 'stream';
import path from 'path';
import { PNG } from 'pngjs';
import ColorThief from 'colorthief';
import { FrequencyBuses } from './audio';

export interface Color {
  red: number;
  green: number;
  blue: number;
}

export const drawRect = (imageDstBuffer: PNG, x: number, y: number, width: number, height: number, color: Color) => {
  for (var currY = y; currY < y + height; currY++) {
    for (var currX = x; currX < x + width; currX++) {
      var idx = (imageDstBuffer.width * currY + currX) << 2;

      imageDstBuffer.data[idx] = color.red;
      imageDstBuffer.data[idx + 1] = color.green;
      imageDstBuffer.data[idx + 2] = color.blue;
      imageDstBuffer.data[idx + 3] = 255; // alpha
    }
  }
};

const drawFrequencyBuses = (imageDstBuffer: PNG, frequencyBuses: FrequencyBuses, width: number, height: number, color: Color) => {
  const busesCount = Object.keys(frequencyBuses).length;
  const paddingLeft = Math.trunc(imageDstBuffer.width / 2 - width / 2);
  const busWidth = width / busesCount;
  const margin = busWidth * 0.3;
  Object.entries(frequencyBuses).forEach(([bus, value], index) => {
    const rectX = paddingLeft + busWidth * index + (margin / 2);
    const rectY = 0;
    const rectWidth = busWidth - margin;
    const rectHeight = height * value;
    drawRect(imageDstBuffer, rectX, rectY, rectWidth, rectHeight, color);
  });
};

export const createVisualizerFrame = async (backgroundImageBuffer: Buffer, frequencyBuses: FrequencyBuses, busesWidth: number, busesHeight: number, busesColor: Color | string) => {
  const image = await parseImage(backgroundImageBuffer);
  const rgbBusesColor = (typeof busesColor === 'string') ? hexToRgb(busesColor) : busesColor;
  drawFrequencyBuses(image, frequencyBuses, busesWidth, busesHeight, rgbBusesColor);
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
