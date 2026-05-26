import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { renderAudioVisualizer, Config } from '../index';
import path from 'path';
import fs from 'fs';
import { Writable, Readable } from 'stream';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import * as image from '../image';
import * as audio from '../audio';
import * as video from '../video';
import * as bpmEncoder from '../bpmEncoder';

const EXIT_CODE = 0;
const sandbox = createSandbox();

describe('index', function () {
  const createMockWriter = (emitExitOnWrite: boolean): ChildProcessWithoutNullStreams => {
    const eventBus = new EventEmitter();
    const writable = new Writable({
      write(_chunk: Buffer, _enc: string, cb: (error?: Error | null) => void) {
        if (emitExitOnWrite) {
          eventBus.emit('exit', EXIT_CODE);
        }
        cb();
      },
    });
    const stderr = new Readable();
    stderr._read = () => {};
    return {
      stdin: writable,
      stderr,
      on: eventBus.on.bind(eventBus),
      once: eventBus.once.bind(eventBus),
      removeListener: eventBus.removeListener.bind(eventBus),
      emit: eventBus.emit.bind(eventBus),
    } as unknown as ChildProcessWithoutNullStreams;
  };

  this.beforeEach(function () {
    sandbox.stub(fs, 'readFileSync').returns(Buffer.from([1, 1]));
    sandbox.stub(audio, 'createAudioBuffer').returns(
      Promise.resolve({ audioBuffer: Buffer.from([1, 1]), sampleRate: 2 })
    );
    sandbox.stub(image, 'getImageColor').returns({ red: 0, green: 0, blue: 0 });

    let childProcessStream = createMockWriter(true);
    sandbox.stub(video, 'spawnFfmpegVideoWriter').callsFake(
      () => childProcessStream
    );
    (this as any).setMockWriter = (emitExitOnWrite: boolean) => {
      childProcessStream = createMockWriter(emitExitOnWrite);
    };
  });

  this.afterEach(function () {
    sandbox.restore();
  });

  it('renderAudioVisualizer', async function () {
    const config: Config = {
      audio: {
        path: 'audioPath'
      },
      image: {
        path: 'example/media/horses.png'
      },
      outVideo: {
        path: 'outVideoPath',
        fps: 1
      }
    };

    const { exitCode, outputVideoFiles } = await renderAudioVisualizer(config);
    expect(exitCode).equal(EXIT_CODE);
    expect(outputVideoFiles).deep.equal([path.resolve('outVideoPath')]);
  });

  it('resolves and does not report 100 when process completion times out', async function () {
    (this as any).setMockWriter(false);
    sandbox.stub(video, 'waitForProcessExit').callsFake(
      () => Promise.resolve(1)
    );
    const progressValues: number[] = [];
    const config: Config = {
      audio: {
        path: 'audioPath'
      },
      image: {
        path: 'example/media/horses.png'
      },
      outVideo: {
        path: 'outVideoPath',
        fps: 1
      }
    };

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('renderAudioVisualizer hung')), 200);
    });

    const { exitCode, outputVideoFiles } = await Promise.race([
      renderAudioVisualizer(config, (progress) => progressValues.push(progress)),
      timeoutPromise,
    ]);

    expect(exitCode).equal(1);
    expect(outputVideoFiles).deep.equal([]);
    expect(progressValues.some(progress => progress === 100)).equal(false);
  });

  it('aborts render when video frame reads fail repeatedly', async function () {
    const videoFrameReaderOutput = new Readable();
    videoFrameReaderOutput._read = () => {};
    sandbox.stub(video, 'getVideoInfo').resolves({
      width: 1,
      height: 1,
      duration: 1,
    });
    sandbox.stub(video, 'writeConcatFile').returns('fake-concat-path.txt');
    sandbox.stub(video, 'spawnConcatVideoFrameReader').returns({
      stdout: videoFrameReaderOutput,
      kill: () => {},
    } as any);
    sandbox.stub(image, 'getVideoFrameColor').returns({ red: 0, green: 0, blue: 0 });
    sandbox.stub(bpmEncoder, 'createBgrFrameEncoder').returns(
      () => ({ shiftPos: 0, rowBytes: 0, data: Buffer.from([1, 2, 3]) }),
    );
    let frameReadCount = 0;
    sandbox.stub(video, 'readVideoFrame').callsFake(async () => {
      frameReadCount += 1;
      if (frameReadCount === 1) {
        return Buffer.from([1, 2, 3]);
      }
      return null;
    });

    const config: Config = {
      audio: {
        path: 'audioPath'
      },
      video: {
        path: 'example/media/test-blur.mp4',
      },
      outVideo: {
        path: 'outVideoPath',
        fps: 10,
      }
    };

    const { exitCode, outputVideoFiles } = await renderAudioVisualizer(config);
    expect(exitCode).equal(1);
    expect(outputVideoFiles).deep.equal([]);
    expect(frameReadCount).greaterThan(1);
  });
});
