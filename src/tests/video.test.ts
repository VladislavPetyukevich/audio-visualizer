import { expect } from 'chai';
import { Writable, Readable, Pipe } from 'stream';
import { EventEmitter } from 'events';
import { spawnFfmpegVideoWriter, waitDrain, readVideoFrame, waitForProcessExit, buildBeatSyncedSegments, getCutFrameIndices, selectAutoEditCutFrames, snapBeatsToTempoGrid, projectBeatsOntoTempoGrid } from '../video';
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

  it('getCutFrameIndices skips the opening segment', function () {
    const segments = buildBeatSyncedSegments(
      [12, 24, 36],
      48,
      [
        { frameNumber: 0, pts: 0, ptsTime: 1 },
        { frameNumber: 1, pts: 0, ptsTime: 4 },
        { frameNumber: 2, pts: 0, ptsTime: 8 },
      ],
      12,
      30,
      { minCutIntervalSeconds: 0 },
    );
    expect(getCutFrameIndices(segments)).deep.equal([12, 24, 36]);
  });

  it('getCutFrameIndices is empty when auto-edit has no scene changes', function () {
    const segments = buildBeatSyncedSegments([10, 20], 30, [], 8, 30);
    expect(segments).deep.equal([
      { outputStartFrame: 0, videoSeekSeconds: 0, frameCount: 30 },
    ]);
    expect(getCutFrameIndices(segments)).deep.equal([]);
  });

  it('selectAutoEditCutFrames keeps at least 2 seconds between cuts', function () {
    const fps = 30;
    const beats = [15, 30, 45, 60, 75, 90, 105, 120].map(frameIndex => ({ frameIndex }));
    expect(selectAutoEditCutFrames(beats, fps, 150)).deep.equal([60, 120]);
  });

  it('selectAutoEditCutFrames prefers the strongest beat in the allowed window', function () {
    const fps = 30;
    const beats = [
      { frameIndex: 60, intensity: 0.2 },
      { frameIndex: 90, intensity: 0.9 },
      { frameIndex: 100, intensity: 0.4 },
    ];
    expect(selectAutoEditCutFrames(beats, fps, 180)).deep.equal([90]);
  });

  it('buildBeatSyncedSegments spaces auto-edit cuts instead of cutting every beat', function () {
    const segments = buildBeatSyncedSegments(
      [15, 30, 45, 60, 75, 90, 105, 120],
      150,
      [
        { frameNumber: 0, pts: 0, ptsTime: 1 },
        { frameNumber: 1, pts: 0, ptsTime: 4 },
      ],
      12,
      30,
    );
    expect(getCutFrameIndices(segments)).deep.equal([60, 120]);
  });

  it('snapBeatsToTempoGrid snaps onsets within a quarter-beat to the grid', function () {
    const snapped = snapBeatsToTempoGrid(
      [
        { frameIndex: 29, intensity: 0.8 },
        { frameIndex: 50, intensity: 0.4 },
      ],
      { periodFrames: 14, phaseFrame: 0 },
      200,
    );
    expect(snapped.map(beat => beat.frameIndex)).deep.equal([28, 50]);
    expect(snapped[0].intensity).equal(0.8);
  });

  it('projectBeatsOntoTempoGrid fills the grid and copies nearby onset intensity', function () {
    const projected = projectBeatsOntoTempoGrid(
      [
        { frameIndex: 29, intensity: 0.8 },
        { frameIndex: 50, intensity: 0.4 },
      ],
      { periodFrames: 14, phaseFrame: 0 },
      50,
    );
    expect(projected.map(beat => beat.frameIndex)).deep.equal([14, 28, 42]);
    expect(projected.map(beat => beat.intensity)).deep.equal([0, 0.8, 0]);
  });

  it('buildBeatSyncedSegments uses 2-4 beat spacing when tempo is set', function () {
    const fps = 30;
    const bpm = 90;
    const periodFrames = fps * 60 / bpm;
    const segments = buildBeatSyncedSegments(
      [20, 40, 60, 80, 100, 120, 140, 160],
      200,
      [
        { frameNumber: 0, pts: 0, ptsTime: 1 },
        { frameNumber: 1, pts: 0, ptsTime: 4 },
      ],
      12,
      fps,
      { tempo: { bpm, periodFrames, phaseFrame: 0 } },
    );
    expect(getCutFrameIndices(segments)).deep.equal([40, 80, 120, 160]);
  });

  it('buildBeatSyncedSegments places scene cuts on the BPM grid', function () {
    const fps = 30;
    const bpm = 128;
    const periodFrames = 14;
    const totalFrames = 180;
    const segments = buildBeatSyncedSegments(
      [57, 113],
      totalFrames,
      [
        { frameNumber: 0, pts: 0, ptsTime: 1 },
        { frameNumber: 1, pts: 0, ptsTime: 4 },
      ],
      12,
      fps,
      { tempo: { bpm, periodFrames, phaseFrame: 0 } },
    );
    const cuts = getCutFrameIndices(segments);
    expect(cuts.length).greaterThan(0);
    for (const cut of cuts) {
      expect(cut % periodFrames).equal(0);
    }
  });

  it('buildBeatSyncedSegments cuts on the BPM grid even without detected onsets', function () {
    const fps = 30;
    const bpm = 90;
    const periodFrames = fps * 60 / bpm;
    const segments = buildBeatSyncedSegments(
      [],
      200,
      [
        { frameNumber: 0, pts: 0, ptsTime: 1 },
        { frameNumber: 1, pts: 0, ptsTime: 4 },
      ],
      12,
      fps,
      { tempo: { bpm, periodFrames, phaseFrame: 0 } },
    );
    expect(getCutFrameIndices(segments)).deep.equal([40, 80, 120, 160]);
  });

  it('buildBeatSyncedSegments prefers the strongest on-grid beat in the cut window', function () {
    const fps = 30;
    const bpm = 90;
    const periodFrames = fps * 60 / bpm;
    const beats = [20, 40, 60, 80, 100, 120, 140, 160];
    const intensities = [0.1, 0.1, 0.9, 0.1, 0.1, 0.8, 0.1, 0.1];
    const segments = buildBeatSyncedSegments(
      beats,
      160,
      [
        { frameNumber: 0, pts: 0, ptsTime: 1 },
        { frameNumber: 1, pts: 0, ptsTime: 4 },
      ],
      12,
      fps,
      {
        beatIntensities: intensities,
        tempo: { bpm, periodFrames, phaseFrame: 0 },
      },
    );
    expect(getCutFrameIndices(segments)).deep.equal([60, 120]);
  });
});
