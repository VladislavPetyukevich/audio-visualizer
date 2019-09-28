const Writable = require('stream').Writable;
const PNG = require('pngjs').PNG;

const createVisualizerFrame = (backgroundImageBuffer) =>
  new Promise((resolve, reject) => {
    new PNG({ filterType: 4 }).parse(backgroundImageBuffer, function (error, dstBuffer) {
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
