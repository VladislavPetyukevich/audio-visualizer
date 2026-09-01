import { expect } from 'chai';
import path from 'path';
import {
  drawRect,
  Color,
  createSpectrumVisualizerFrameGenerator,
  createPolarVisualizerFrameGenerator,
  parseImage,
  convertToBmp,
  mixValues,
  mixColors,
  applyCameraShake,
  getCutShakeOffset,
} from '../image';
import { createBpmEncoder } from '../bpmEncoder';

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

  it('getCutShakeOffset peaks on the cut and decays on the next frames', function () {
    const cutFrames = new Set([10, 20]);
    const magnitude = (offset: { x: number; y: number }) => Math.hypot(offset.x, offset.y);
    expect(getCutShakeOffset(9, cutFrames)).deep.equal({ x: 0, y: 0 });
    expect(magnitude(getCutShakeOffset(10, cutFrames))).greaterThan(magnitude(getCutShakeOffset(11, cutFrames)));
    expect(magnitude(getCutShakeOffset(11, cutFrames))).greaterThan(magnitude(getCutShakeOffset(12, cutFrames)));
    expect(magnitude(getCutShakeOffset(12, cutFrames))).greaterThan(magnitude(getCutShakeOffset(13, cutFrames)));
    expect(getCutShakeOffset(15, cutFrames)).deep.equal({ x: 0, y: 0 });
    expect(magnitude(getCutShakeOffset(20, cutFrames))).greaterThan(0);
  });

  it('getCutShakeOffset uses the closer overlapping cut', function () {
    const cutFrames = new Set([10, 11]);
    expect(getCutShakeOffset(11, cutFrames)).deep.equal(getCutShakeOffset(11, new Set([11])));
  });

  it('applyCameraShake shifts pixels and clamps edges', function () {
    const width = 3;
    const height = 2;
    const extraBytes = width % 4;
    const rowBytes = 3 * width + extraBytes;
    const shiftPos = 4;
    const data = Buffer.alloc(shiftPos + height * rowBytes, 0);
    data[0] = 9;
    data[1] = 8;
    data[2] = 7;
    data[3] = 6;
    let value = 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = shiftPos + y * rowBytes + x * 3;
        data[pixelIndex] = value;
        data[pixelIndex + 1] = value + 1;
        data[pixelIndex + 2] = value + 2;
        value += 3;
      }
    }

    applyCameraShake({ shiftPos, rowBytes, data }, width, height, 1, 0);

    expect(data[0]).equal(9);
    expect(data[1]).equal(8);
    expect(data[2]).equal(7);
    expect(data[3]).equal(6);
    const pixelAt = (x: number, y: number) => {
      const pixelIndex = shiftPos + y * rowBytes + x * 3;
      return [data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]];
    };
    expect(pixelAt(0, 0)).deep.equal([1, 2, 3]);
    expect(pixelAt(1, 0)).deep.equal([1, 2, 3]);
    expect(pixelAt(2, 0)).deep.equal([4, 5, 6]);
    expect(pixelAt(0, 1)).deep.equal([10, 11, 12]);
    expect(pixelAt(1, 1)).deep.equal([10, 11, 12]);
    expect(pixelAt(2, 1)).deep.equal([13, 14, 15]);
  });

  it('applyCameraShake is a no-op at zero offset', function () {
    const data = Buffer.from([1, 2, 3, 10, 20, 30]);
    applyCameraShake({ shiftPos: 3, rowBytes: 3, data }, 1, 1, 0, 0);
    expect(Array.from(data)).deep.equal([1, 2, 3, 10, 20, 30]);
  });

  it('createSpectrumVisualizerFrameGenerator', async function () {
    const expectedImageLength = 6220854;
    const backgroundImagePath = path.resolve('example/media/horses.png');
    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const bpmEncoder = createBpmEncoder({ width: backgroundImage.width, height: backgroundImage.height });
    const backgroundImageBuffer = bpmEncoder(backgroundImage.data);
    const createVisualizerFrame = createSpectrumVisualizerFrameGenerator();
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
    expect(resultSpectrumDown).to.have.length(expectedImageLength);

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
    expect(resultSpectrumUp).to.have.length(expectedImageLength);

    const frameSpectrumMirror = createVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.1, 1, 0],
      size: { width: 25, height: 23 },
      position: { x: 10, y: 5 },
      rotation: 'mirror',
      margin: 4,
      color: { red: 0, green: 123, blue: 69 },
      opacity: 1,
    });
    const resultSpectrumMirror = frameSpectrumMirror.data.toJSON().data;
    expect(resultSpectrumMirror).to.have.length(expectedImageLength);

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
    expect(resultSpectrumUpOpacity50).to.have.length(expectedImageLength);
  });

  it('createPolarVisualizerFrameGenerator', async function () {
    const expectedImageLength = 6220854;
    const backgroundImagePath = path.resolve('example/media/horses.png');
    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const bpmEncoder = createBpmEncoder({ width: backgroundImage.width, height: backgroundImage.height });
    const backgroundImageBuffer = bpmEncoder(backgroundImage.data);
    const createPolarVisualizerFrame = createPolarVisualizerFrameGenerator();

    const framePolarBasic = createPolarVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.5, 0.8, 0.3, 0.9, 0.6, 0.4, 0.7, 0.2],
      centerX: 500,
      centerY: 400,
      innerRadius: 100,
      maxBarLength: 150,
      barWidth: 5,
      color: { red: 255, green: 100, blue: 50 },
      opacity: 1,
    });
    const resultPolarBasic = framePolarBasic.data.toJSON().data;
    expect(resultPolarBasic).to.have.length(expectedImageLength);

    const framePolarVolume = createPolarVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.2, 0.5, 0.8, 0.3, 0.6, 0.9, 0.4, 0.7],
      centerX: 500,
      centerY: 400,
      innerRadius: 80,
      maxBarLength: 120,
      barWidth: 4,
      color: { red: 100, green: 200, blue: 255 },
      opacity: 1,
      spectrumEffect: 'volume',
    });
    const resultPolarVolume = framePolarVolume.data.toJSON().data;
    expect(resultPolarVolume).to.have.length(expectedImageLength);

    const framePolarSmooth = createPolarVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.7, 0.4, 0.9, 0.2, 0.5, 0.8, 0.3, 0.6],
      centerX: 500,
      centerY: 400,
      innerRadius: 90,
      maxBarLength: 130,
      barWidth: 6,
      color: { red: 255, green: 255, blue: 0 },
      opacity: 1,
      spectrumEffect: 'smooth',
    });
    const resultPolarSmooth = framePolarSmooth.data.toJSON().data;
    expect(resultPolarSmooth).to.have.length(expectedImageLength);

    const framePolarOpacity50 = createPolarVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.6, 0.3, 0.8, 0.5, 0.4, 0.7, 0.2, 0.9],
      centerX: 500,
      centerY: 400,
      innerRadius: 100,
      maxBarLength: 140,
      barWidth: 5,
      color: { red: 0, green: 255, blue: 128 },
      opacity: 0.5,
    });
    const resultPolarOpacity50 = framePolarOpacity50.data.toJSON().data;
    expect(resultPolarOpacity50).to.have.length(expectedImageLength);

    const framePolarHexColor = createPolarVisualizerFrame({
      backgroundImageBuffer,
      spectrum: [0.5, 0.6, 0.7, 0.8, 0.9, 0.4, 0.3, 0.2],
      centerX: 500,
      centerY: 400,
      innerRadius: 110,
      maxBarLength: 160,
      barWidth: 7,
      color: '#FF5733',
      opacity: 1,
    });
    const resultPolarHexColor = framePolarHexColor.data.toJSON().data;
    expect(resultPolarHexColor).to.have.length(expectedImageLength);
  });
});
