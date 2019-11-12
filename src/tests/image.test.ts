import { createSandbox, spy } from 'sinon';
import { expect } from 'chai';
import { PNG } from 'pngjs';
import { drawRect, Color, createVisualizerFrame, createImageBuffer } from '../image';
import { FrequencyBuses } from '../audio';
import { frameImageData } from './data';

describe('image', function () {
  it('drawRect', function () {
    const imageWidth = 10;
    const imageHeight = 10;
    const imageDstBuffer = {
      width: imageWidth,
      data: Array.from({ length: imageWidth * imageHeight * 4 }).fill(0)
    };
    const rectX = 4;
    const rectY = 3;
    const rectWidth = 4;
    const rectHeight = 3;
    const rectColor: Color = { red: 111, green: 112, blue: 123 };

    const expectedImageData = Array.from({ length: imageWidth * imageWidth * 4 }).fill(0);
    const imagePixelIndices = [136, 140, 144, 148, 176, 180, 184, 188, 216, 220, 224, 228];
    imagePixelIndices.forEach((pixelIndex) => {
      expectedImageData[pixelIndex] = rectColor.red;
      expectedImageData[pixelIndex + 1] = rectColor.green;
      expectedImageData[pixelIndex + 2] = rectColor.blue;
      expectedImageData[pixelIndex + 3] = 255; // alpha
    });

    drawRect(imageDstBuffer as any, rectX, rectY, rectWidth, rectHeight, rectColor);
    expect(imageDstBuffer.data).deep.equal(expectedImageData);
  });

  it('createVisualizerFrame', async function () {
    const image = new PNG({ width: 100, height: 50 });
    const imageBuffer = await createImageBuffer(image);
    const frame = await createVisualizerFrame(
      imageBuffer,
      { 0: 0.3, 50: 0.5 },
      15,
      20,
      { red: 1, green: 1, blue: 1 }
    );
    expect(frame.data.toJSON().data).deep.equal(frameImageData);
  });
});
