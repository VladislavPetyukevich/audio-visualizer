import { expect } from 'chai';
import { Readable, Writable, Pipe } from 'stream';
import child_process, { ChildProcessWithoutNullStreams } from 'child_process';
import {
  bufferToUInt8,
  normalizeAudioData,
  spawnFfmpegAudioReader,
  skipEvery,
  getPeaks,
  correctPeaks,
  smoothValues,
  createSpectrumsProcessor,
} from '../audio';
import { createSandbox } from 'sinon';

let childProcessStream = {
  stdin: new Writable(),
  stderr: new Readable(),
};

const videoSandbox = createSandbox();

describe('audio', function () {

  this.beforeAll(function () {
    videoSandbox.stub(child_process, 'spawn').returns(childProcessStream as ChildProcessWithoutNullStreams);
  });

  this.afterAll(function () {
    videoSandbox.restore();
  });

  it('bufferToUInt8', function () {
    const expected = [1, 2, 3, 4, 5];
    const buffer = Buffer.from(new Uint8Array(expected));
    const result = bufferToUInt8(buffer, 0, 5);
    expect(result).deep.equal(expected);
  });

  it('normalizeAudioData', function () {
    const result = normalizeAudioData([4, 5, 23, 78, 2]);
    const expected = [-0.96875, -0.9609375, -0.8203125, -0.390625, -0.984375];
    expect(result).deep.equal(expected);
  });

  it('spawnFfmpegAudioReader', function (done) {
    const childProcessReadableStream = new Readable();
    const childProcessWritableStream = new Writable();
    childProcessReadableStream._read = () => { done(); };
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    const ffmpegProcess = spawnFfmpegAudioReader('filename', 'format');
    ffmpegProcess.stderr.on('data', (data) => {
      expect(data).equal('some data');
    });

    childProcessStream.stderr.emit('data', 'some data');
  });

  it('skipEvery', () => {
    const sampleData = [1, 2, 3, 4];
    const result = sampleData.filter(skipEvery(2));
    const expected = [1, 3];
    expect(result).deep.equal(expected);
  });

  it('getPeaks', () => {
    const sampleData = [1, 2, 3, 4];
    const prevPeaks = [2, 2, 2, 5];
    const resultNoPrevPeaks = getPeaks(sampleData);
    expect(resultNoPrevPeaks).deep.equal(sampleData);
    const resultWithPrevPeaks = getPeaks(sampleData, prevPeaks);
    const expectedWithPrevPeaks = [2, 2, 3, 5];
    expect(resultWithPrevPeaks).deep.equal(expectedWithPrevPeaks);
  });

  it('correctPeaks', () => {
    const spectrums = [1, 2, 3, 4];
    const peaks = [2, 2, 3, 5];
    const result = correctPeaks(spectrums, peaks);
    const expected = [0.5, 1, 1, 0.8];
    expect(result).deep.equal(expected);
  });

  it('smoothValues', () => {
    const spectrums = [1, 2, 3, 4];
    const prevSpectrums = [2, 4, 6, 3];
    const result = smoothValues(spectrums, prevSpectrums);
    const expected = [1.5, 3, 4.5, 3.5];
    expect(result).deep.equal(expected);
  });

  it('createSpectrumsProcessor', () => {
    const busesCount = 2;
    const spectrumsProcessor = createSpectrumsProcessor(busesCount);
    
    const frame0 = spectrumsProcessor(0, () => ([1, 2, 3, 4]));
    expect(frame0).to.have.length(2);
    const frame1 = spectrumsProcessor(1, () => ([2, 2, 6, 2]));
    expect(frame1).to.have.length(2);
  });
});
