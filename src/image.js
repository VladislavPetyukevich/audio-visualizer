const Writable = require('stream').Writable;
const PNG = require('pngjs').PNG;

const drawRect = (imageDstBuffer, x, y, width, height) => {
  for (var currY = y; currY < y + height; currY++) {
    for (var currX = x; currX < x + width; currX++) {
      var idx = (imageDstBuffer.width * currY + currX) << 2;

      imageDstBuffer.data[idx] = 255;     // red
      imageDstBuffer.data[idx + 1] = 0;   // green
      imageDstBuffer.data[idx + 2] = 0;   // blue
      imageDstBuffer.data[idx + 3] = 255; // alpha
    }
  }
};

const drawFrequencyBuses = (imageDstBuffer, frequencyBuses, height) => {
  const busesCount = Object.keys(frequencyBuses).length;
  const margin = 10;
  const busWidth = imageDstBuffer.width / busesCount;
  Object.entries(frequencyBuses).forEach(([bus, value], index) => {
    const rectX = busWidth * index + (margin / 2);
    const rectY = 0;
    const rectWidth = busWidth - margin;
    const rectHeight = height * value;
    drawRect(imageDstBuffer, rectX, rectY, rectWidth, rectHeight);
  });
};

const createVisualizerFrame = (backgroundImageBuffer, frequencyBuses, busesHeight) =>
  new Promise((resolve, reject) => {
    new PNG({ filterType: 4 }).parse(backgroundImageBuffer, function (error, dstBuffer) {
      drawFrequencyBuses(dstBuffer, frequencyBuses, busesHeight);
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

module.exports = {
  createVisualizerFrame,
  createImageBuffer
};
