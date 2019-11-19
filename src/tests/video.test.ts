import { expect } from 'chai';
import { Writable, Readable, Pipe } from 'stream';
import { spawnFfmpegVideoWriter } from '../video';
import { createSandbox } from 'sinon';
import child_process, { ChildProcessWithoutNullStreams } from 'child_process';

let childProcessStream = {
  stdin: new Writable(),
  stderr: new Readable(),
};

const videoSandbox = createSandbox();

describe('video', function () {

  this.beforeAll(function () {
    videoSandbox.stub(child_process, 'spawn').returns(childProcessStream as ChildProcessWithoutNullStreams);
  });

  this.afterAll(function () {
    videoSandbox.restore();
  });

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
