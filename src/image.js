const Writable = require('stream').Writable;
const path = require('path');
const PNG = require('pngjs').PNG;
const ColorThief = require('colorthief');

const drawRect = (imageDstBuffer, x, y, width, height, color = { red: 0, green: 0, blue: 0 }) => {
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

const drawFrequencyBuses = (imageDstBuffer, frequencyBuses, width, height, color) => {
  const busesCount = Object.keys(frequencyBuses).length;
  const margin = 10;
  const paddingLeft = Math.trunc(imageDstBuffer.width / 2 - width / 2);
  const busWidth = width / busesCount;
  Object.entries(frequencyBuses).forEach(([bus, value], index) => {
    const rectX = paddingLeft + busWidth * index + (margin / 2);
    const rectY = 0;
    const rectWidth = busWidth - margin;
    const rectHeight = height * value;
    drawRect(imageDstBuffer, rectX, rectY, rectWidth, rectHeight, color);
  });
};

const createVisualizerFrame = (backgroundImageBuffer, frequencyBuses, busesWidth, busesHeight, busesColor) =>
  new Promise((resolve, reject) => {
    new PNG({ filterType: 4 }).parse(backgroundImageBuffer, function (error, dstBuffer) {
      drawFrequencyBuses(dstBuffer, frequencyBuses, busesWidth, busesHeight, busesColor);
      resolve(dstBuffer);
    });
  });

const createImageBuffer = (image) =>
  new Promise((resolve, reject) => {
    const imageBuffers = [];
    const imageStream = new Writable();
    imageStream.write = function (chunkBuffer) {
      imageBuffers.push(chunkBuffer);
    }
    imageStream.end = function () {
      const resultBuffer = Buffer.concat(imageBuffers);
      resolve(resultBuffer);
    }

    image.pack().pipe(imageStream);
  });

const getImageColor = async (imagePath) => {
  const color = await ColorThief.getColor(path.resolve(imagePath));
  return { red: color[0], green: color[1], blue: color[2] };
};

const invertColor = (color) =>
  ({ red: 255 - color.red, green: 255 - color.green, blue: 255 - color.blue });

module.exports = {
  createVisualizerFrame,
  createImageBuffer,
  getImageColor,
  invertColor
};
