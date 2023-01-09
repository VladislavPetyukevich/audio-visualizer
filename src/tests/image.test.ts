import { expect } from 'chai';
import path from 'path';
import fs from 'fs';
import {
  drawRect,
  Color,
  createVisualizerFrame,
  parseImage,
  convertToBmp,
  mixValues,
  mixColors,
} from '../image';
import { createBpmEncoder } from '../bpmEncoder';

import frameSnapshotSpectrumDown from './snapshots/frameSnapshotSpectrumDown.json';
import frameSnapshotSpectrumUp from './snapshots/frameSnapshotSpectrumUp.json';
import frameSnapshotSpectrumUpOpacity50 from './snapshots/frameSnapshotSpectrumUpOpacity50.json';

describe('image', function () {
  it('mixValues', function () {
    expect(mixValues(420, 0.69, 96)).equal(320);
    expect(mixValues(420, 1, 96)).equal(420);
    expect(mixValues(420, 0, 96)).equal(96);
  });

  it('mixColors', function () {
    const result1 = mixColors({
      color: { red: 123, green: 69, blue: 96 },
      colorOpacity: 0.24,
      backgroundColor: { red: 69, green: 123, blue: 42 },
    });
    expect(result1).deep.equal({ red: 82, green: 110, blue: 55 });

    const result2 = mixColors({
      color: { red: 123, green: 69, blue: 96 },
      colorOpacity: 0,
      backgroundColor: { red: 69, green: 123, blue: 42 },
    });
    expect(result2).deep.equal({ red: 69, green: 123, blue: 42 });

    const result3 = mixColors({
      color: { red: 123, green: 69, blue: 96 },
      colorOpacity: 1,
      backgroundColor: { red: 69, green: 123, blue: 42 },
    });
    expect(result3).deep.equal({ red: 123, green: 69, blue: 96 });
  });

  it('drawRect', function () {
    const imageWidth = 10;
    const imageHeight = 10;
    const extraBytes = imageWidth % 4;
    const rowBytes = 3 * imageWidth + extraBytes;
    const imageDstBuffer = {
      shiftPos: 54,
      rowBytes,
      width: imageWidth,
      data: Array.from({ length: imageWidth * imageHeight * 4 }).fill(0)
    };
    const rectX = 4;
    const rectY = 3;
    const rectWidth = 4;
    const rectHeight = 3;
    const rectColor: Color = { red: 111, green: 112, blue: 123 };

    const expectedImageData = Array.from({ length: imageWidth * imageWidth * 4 }).fill(0);
    const imagePixelIndices = [162, 165, 168, 171, 194, 197, 200, 203, 226, 229, 232, 235];
    imagePixelIndices.forEach((pixelIndex) => {
      expectedImageData[pixelIndex] = rectColor.blue;
      expectedImageData[pixelIndex + 1] = rectColor.green;
      expectedImageData[pixelIndex + 2] = rectColor.red;
    });

    drawRect({
      imageDstBuffer: imageDstBuffer as any,
      position: { x: rectX, y: rectY },
      size: { width: rectWidth, height: rectHeight },
      color: rectColor,
      opacity: 1
    });
    expect(imageDstBuffer.data).deep.equal(expectedImageData);
  });

  it('createVisualizerFrame', async function () {
    const backgroundImagePath = path.resolve('example/media/background.png');
    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const bpmEncoder = createBpmEncoder({ width: backgroundImage.width, height: backgroundImage.height });
    const backgroundImageBuffer = bpmEncoder(backgroundImage.data);
    const frameSpectrumDown = createVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.5, 0, 1],
      size: { width: 15, height: 20 },
      position: { x: 15, y: 0 },
      rotation: 'down',
      margin: 4,
      color: { red: 1, green: 1, blue: 1 },
      opacity: 1,
    });
    const resultSpectrumDown = frameSpectrumDown.data.toJSON().data;
    expect(resultSpectrumDown).deep.equal(frameSnapshotSpectrumDown);

    const frameSpectrumUp = createVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.1, 1, 0],
      size: { width: 25, height: 23 },
      position: { x: 10, y: 5 },
      rotation: 'up',
      margin: 4,
      color: { red: 0, green: 123, blue: 69 },
      opacity: 1,
    });
    const resultSpectrumUp = frameSpectrumUp.data.toJSON().data;
    expect(resultSpectrumUp).deep.equal(frameSnapshotSpectrumUp);

    const frameSpectrumUpOpacity50 = createVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.1, 1, 0],
      size: { width: 25, height: 23 },
      position: { x: 10, y: 5 },
      rotation: 'up',
      margin: 4,
      color: { red: 0, green: 123, blue: 69 },
      opacity: 0.5,
    });
    const resultSpectrumUpOpacity50 = frameSpectrumUpOpacity50.data.toJSON().data;
    expect(resultSpectrumUpOpacity50).deep.equal(frameSnapshotSpectrumUpOpacity50);
  });
});
