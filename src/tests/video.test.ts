import { createSandbox } from 'sinon';
import { expect } from 'chai';
import { Writable, Readable, Pipe } from 'stream';
import child_process, { ChildProcessWithoutNullStreams } from 'child_process';
import { spawnFfmpegVideoWriter } from '../video';

describe('video', function () {
  const childProcessReadableStream = new Readable();
  const childProcessWritableStream = new Writable();
  (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

  const childProcessStream = {
    stdin: childProcessWritableStream,
    stderr: childProcessReadableStream,
  };

  const videoSandbox = createSandbox();
  videoSandbox.stub(child_process, 'spawn').returns(childProcessStream as ChildProcessWithoutNullStreams);

  it('spawnFfmpegVideoWriter read from stderr', function (done) {
    childProcessReadableStream._read = () => { done(); };

    spawnFfmpegVideoWriter('test', 'test', 11);
  });

  it('spawnFfmpegVideoWriter returns truthy value', function () {
    const result = spawnFfmpegVideoWriter('test', 'test', 11);
    expect(!!result).equal(true);
  });
});
