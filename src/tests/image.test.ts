import { expect } from 'chai';
import path from 'path';
import { drawRect, Color, createVisualizerFrame, parseImage, convertToBmp } from '../image';

import frameSnapshotSpectrumDown from './snapshots/frameSnapshotSpectrumDown.json';
import frameSnapshotSpectrumUp from './snapshots/frameSnapshotSpectrumUp.json';

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
      expectedImageData[pixelIndex + 1] = rectColor.blue;
      expectedImageData[pixelIndex + 2] = rectColor.green;
      expectedImageData[pixelIndex + 3] = rectColor.red;
    });

    drawRect(imageDstBuffer as any, { x: rectX, y: rectY }, { width: rectWidth, height: rectHeight }, rectColor);
    expect(imageDstBuffer.data).deep.equal(expectedImageData);
  });

  it('createVisualizerFrame', async function () {
    const backgroundImagePath = path.resolve('example/media/background.png');
    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const frameSpectrumDown = createVisualizerFrame(
      backgroundImage,
      [0.5, 0, 1],
      { width: 15, height: 20 },
      { x: 15, y: 0 },
      'down',
      { red: 1, green: 1, blue: 1 }
    );
    const resultSpectrumDown = frameSpectrumDown.data.toJSON().data;
    expect(resultSpectrumDown).deep.equal(frameSnapshotSpectrumDown);

    const frameSpectrumUp = createVisualizerFrame(
      backgroundImage,
      [0.1, 1, 0],
      { width: 25, height: 23 },
      { x: 10, y: 5 },
      'up',
      { red: 0, green: 123, blue: 69 }
    );
    const resultSpectrumUp = frameSpectrumUp.data.toJSON().data;
    expect(resultSpectrumUp).deep.equal(frameSnapshotSpectrumUp);
  });
});
