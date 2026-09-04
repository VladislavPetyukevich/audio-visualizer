import { expect } from 'chai';
import { Writable, Readable, Pipe } from 'stream';
import { EventEmitter } from 'events';
import { spawnFfmpegVideoWriter, waitDrain, readVideoFrame, waitForProcessExit, spawnConcatVideoFrameReader } from '../video';
import { createSandbox, SinonStub } from 'sinon';
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

  it('spawnFfmpegVideoWriter returns truthy value', function () {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    const result = spawnFfmpegVideoWriter({ audioFilename: 'test', videoFileName: 'test', fps: 11 });
    expect(!!result).equal(true);
  });

  it('spawnFfmpegVideoWriter uses -ss and -t for single audioSegment', function () {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    let spawnArgs: string[] = [];
    const spawnStub = child_process.spawn as SinonStub;
    spawnStub.callsFake((_cmd: string, args: string[]) => {
      spawnArgs = args;
      return childProcessStream as ChildProcessWithoutNullStreams;
    });

    spawnFfmpegVideoWriter({
      audioFilename: 'audio.mp3',
      videoFileName: 'out.mp4',
      fps: 25,
      audioSegment: { seekSeconds: 12, durationSeconds: 15 },
    });

    spawnStub.resetBehavior();
    spawnStub.returns(childProcessStream as ChildProcessWithoutNullStreams);

    expect(spawnArgs).to.not.include('-filter_complex');
    const ssIdx = spawnArgs.indexOf('-ss');
    expect(ssIdx).greaterThan(-1);
    expect(spawnArgs[ssIdx + 1]).to.equal('12');
    const tIdx = spawnArgs.indexOf('-t');
    expect(tIdx).greaterThan(-1);
    expect(spawnArgs[tIdx + 1]).to.equal('15');
  });

  it('spawnFfmpegVideoWriter adds subtitles filter when subtitle file is provided', function () {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    let spawnArgs: string[] = [];
    const spawnStub = child_process.spawn as SinonStub;
    spawnStub.callsFake((_cmd: string, args: string[]) => {
      spawnArgs = args;
      return childProcessStream as ChildProcessWithoutNullStreams;
    });

    spawnFfmpegVideoWriter({
      audioFilename: 'audio.mp3',
      subtitleFilename: '/tmp/subtitles.srt',
      videoFileName: 'out.mp4',
      fps: 25,
    });

    spawnStub.resetBehavior();
    spawnStub.returns(childProcessStream as ChildProcessWithoutNullStreams);

    const vfIdx = spawnArgs.indexOf('-vf');
    expect(vfIdx).greaterThan(-1);
    expect(spawnArgs[vfIdx + 1]).to.equal(
      "subtitles='/tmp/subtitles.srt':force_style='Alignment=2'",
    );
  });

  it('spawnFfmpegVideoWriter passes subtitle Alignment from subtitleAlignmentAss', function () {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    let spawnArgs: string[] = [];
    const spawnStub = child_process.spawn as SinonStub;
    spawnStub.callsFake((_cmd: string, args: string[]) => {
      spawnArgs = args;
      return childProcessStream as ChildProcessWithoutNullStreams;
    });

    spawnFfmpegVideoWriter({
      audioFilename: 'audio.mp3',
      subtitleFilename: '/tmp/subtitles.srt',
      subtitleAlignmentAss: 8,
      videoFileName: 'out.mp4',
      fps: 25,
    });

    spawnStub.resetBehavior();
    spawnStub.returns(childProcessStream as ChildProcessWithoutNullStreams);

    const vfIdx = spawnArgs.indexOf('-vf');
    expect(vfIdx).greaterThan(-1);
    expect(spawnArgs[vfIdx + 1]).to.equal(
      "subtitles='/tmp/subtitles.srt':force_style='Alignment=8'",
    );
  });

  it('spawnFfmpegVideoWriter configures image pipe input before output file', function () {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    let spawnArgs: string[] = [];
    const spawnStub = child_process.spawn as SinonStub;
    spawnStub.callsFake((_cmd: string, args: string[]) => {
      spawnArgs = args;
      return childProcessStream as ChildProcessWithoutNullStreams;
    });

    spawnFfmpegVideoWriter({
      audioFilename: 'audio.mp3',
      videoFileName: 'out.mp4',
      fps: 23.976,
    });

    spawnStub.resetBehavior();
    spawnStub.returns(childProcessStream as ChildProcessWithoutNullStreams);

    const audioInputIndex = spawnArgs.indexOf('-i');
    expect(audioInputIndex).greaterThan(-1);
    expect(spawnArgs[audioInputIndex + 1]).to.equal('audio.mp3');
    const imagePipeFlagIndex = spawnArgs.indexOf('image2pipe');
    expect(imagePipeFlagIndex).greaterThan(-1);
    expect(spawnArgs[imagePipeFlagIndex - 1]).to.equal('-f');
    const inputFpsIndex = spawnArgs.indexOf('-framerate');
    expect(inputFpsIndex).greaterThan(-1);
    expect(spawnArgs[inputFpsIndex + 1]).to.equal('23.976');
    const pipeInputIndex = spawnArgs.lastIndexOf('-i');
    expect(spawnArgs[pipeInputIndex + 1]).to.equal('-');
    expect(spawnArgs.includes('-shortest')).to.equal(true);
    expect(spawnArgs[spawnArgs.length - 1]).to.equal('out.mp4');
  });

  it('waitDrain resolves true on drain', async function () {
    const writable = new Writable();
    const waitPromise = waitDrain(writable, undefined, 50);
    setTimeout(() => writable.emit('drain'), 5);
    const isDrained = await waitPromise;
    expect(isDrained).equal(true);
  });

  it('waitDrain resolves false on timeout', async function () {
    const writable = new Writable();
    const isDrained = await waitDrain(writable, undefined, 5);
    expect(isDrained).equal(false);
  });

  it('readVideoFrame resolves null on timeout', async function () {
    const readable = new Readable();
    readable._read = () => {};
    const frame = await readVideoFrame(readable, 4, 5);
    expect(frame).equal(null);
  });

  it('readVideoFrame assembles a frame from multiple chunks', async function () {
    const readable = new Readable();
    readable._read = () => {};
    const framePromise = readVideoFrame(readable, 6, 200);
    await new Promise(resolve => setImmediate(resolve));
    readable.push(Buffer.from([1, 2]));
    await new Promise(resolve => setImmediate(resolve));
    readable.push(Buffer.from([3, 4]));
    await new Promise(resolve => setImmediate(resolve));
    readable.push(Buffer.from([5, 6]));
    const frame = await framePromise;
    expect(!!frame && frame.equals(Buffer.from([1, 2, 3, 4, 5, 6]))).equal(true);
  });

  it('readVideoFrame does not timeout after a successful chunked read', async function () {
    const errors: any[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => {
      errors.push(args);
    };
    const readable = new Readable();
    readable._read = () => {};
    try {
      const timeoutMs = 40;
      const framePromise = readVideoFrame(readable, 4, timeoutMs);
      await new Promise(resolve => setImmediate(resolve));
      readable.push(Buffer.from([1, 2]));
      await new Promise(resolve => setImmediate(resolve));
      readable.push(Buffer.from([3, 4]));
      const frame = await framePromise;
      expect(!!frame && frame.equals(Buffer.from([1, 2, 3, 4]))).equal(true);
      await new Promise(resolve => setTimeout(resolve, timeoutMs + 30));
      expect(errors).deep.equal([]);
    } finally {
      console.error = originalError;
    }
  });

  it('spawnConcatVideoFrameReader regenerates timestamps for auto-edit concat', function () {
    const childProcessReadableStream = new Readable();
    childProcessReadableStream._read = () => { };
    const childProcessWritableStream = new Writable();
    (<Pipe>childProcessWritableStream.pipe) = () => childProcessWritableStream;

    childProcessStream.stdin = childProcessWritableStream;
    childProcessStream.stderr = childProcessReadableStream;

    let spawnArgs: string[] = [];
    const spawnStub = child_process.spawn as SinonStub;
    spawnStub.callsFake((_cmd: string, args: string[]) => {
      spawnArgs = args;
      return childProcessStream as ChildProcessWithoutNullStreams;
    });

    spawnConcatVideoFrameReader({
      concatFilePath: '/tmp/av-concat.txt',
      fps: 30,
      totalFrames: 90,
    });

    spawnStub.resetBehavior();
    spawnStub.returns(childProcessStream as ChildProcessWithoutNullStreams);

    expect(spawnArgs.indexOf('-fflags')).greaterThan(-1);
    expect(spawnArgs[spawnArgs.indexOf('-fflags') + 1]).equal('+genpts');
    expect(spawnArgs.indexOf('-an')).greaterThan(-1);
    expect(spawnArgs[spawnArgs.indexOf('-avoid_negative_ts') + 1]).equal('make_zero');
  });

  it('waitForProcessExit resolves exit code', async function () {
    const processEmitter = new EventEmitter();
    const waitPromise = waitForProcessExit(processEmitter, 50);
    setTimeout(() => processEmitter.emit('exit', 0), 5);
    const { exitCode, reason } = await waitPromise;
    expect(exitCode).equal(0);
    expect(reason).equal(undefined);
  });

  it('waitForProcessExit resolves non-zero on timeout', async function () {
    const processEmitter = new EventEmitter();
    const { exitCode, reason } = await waitForProcessExit(processEmitter, 5);
    expect(exitCode).equal(1);
    expect(reason).equal('waitForProcessExit timeout (5ms)');
  });
});
