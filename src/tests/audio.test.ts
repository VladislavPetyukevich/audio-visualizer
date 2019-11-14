import { expect } from 'chai';
import { Readable, Writable, Pipe } from 'stream';
import {
  getSmoothBusesSequences,
  ffftDataToBusesSequences,
  bufferToUInt8,
  normalizeAudioData,
  spawnFfmpegAudioReader
} from '../audio';
import { childProcessStream } from './childProcessSandbox';

describe('audio', function () {
  it('getSmoothBusesSequences', function () {
    const result = getSmoothBusesSequences(
      [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5],
      1,
      [0, 0.3, 1],
      1
    );
    expect(result).property('0');
    expect(result).property('0.3');
    expect(result[0]).an('array');
    expect(result[0.3]).an('array');
  });

  it('ffftDataToBusesSequences', function () {
    const result = ffftDataToBusesSequences(
      [
        { frequency: 0.2, magnitude: 0.3 },
        { frequency: 0.3, magnitude: 0.2 }
      ],
      [0, 0.3, 1]
    );
    const expected = { 0: 0.3, 0.3: 0.2 };
    expect(result).deep.equal(expected);
  });

  it('bufferToUInt8', function () {
    const expected = [1, 2, 3, 4, 5];
    const buffer = Buffer.from(new Uint8Array(expected));
    const result = bufferToUInt8(buffer);
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
});
