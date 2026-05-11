import { expect } from 'chai';
import { Writable, Readable, Pipe } from 'stream';
import { spawnFfmpegVideoWriter } from '../video';
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
      "subtitles='/tmp/subtitles.srt':force_style='MarginV=50'",
    );
  });

  it('spawnFfmpegVideoWriter uses custom subtitle MarginV when provided', function () {
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
      subtitleMarginV: 72,
      videoFileName: 'out.mp4',
      fps: 25,
    });

    spawnStub.resetBehavior();
    spawnStub.returns(childProcessStream as ChildProcessWithoutNullStreams);

    const vfIdx = spawnArgs.indexOf('-vf');
    expect(vfIdx).greaterThan(-1);
    expect(spawnArgs[vfIdx + 1]).to.equal(
      "subtitles='/tmp/subtitles.srt':force_style='MarginV=72'",
    );
  });
});
