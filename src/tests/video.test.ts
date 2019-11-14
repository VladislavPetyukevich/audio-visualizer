import { expect } from 'chai';
import { Writable, Readable, Pipe } from 'stream';
import { spawnFfmpegVideoWriter } from '../video';
import { childProcessStream } from './childProcessSandbox';

describe('video', function () {
  it('spawnFfmpegVideoWriter read from stderr', function (done) {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { done(); };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    spawnFfmpegVideoWriter('test', 'test', 11);
  });

  it('spawnFfmpegVideoWriter returns truthy value', function () {
    const result = spawnFfmpegVideoWriter('test', 'test', 11);
    expect(!!result).equal(true);
  });
});
