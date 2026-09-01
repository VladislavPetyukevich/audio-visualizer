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

    const { exitCode, reason, outputVideoFiles } = await renderAudioVisualizer(config);
    expect(exitCode).equal(EXIT_CODE);
    expect(reason).equal(undefined);
    expect(outputVideoFiles).deep.equal([path.resolve('outVideoPath')]);
  });

  it('does not render a visualizer when neither spectrum nor polar is specified', async function () {
    const polarSpy = sandbox.spy(image, 'createPolarVisualizerFrameGenerator');
    const spectrumSpy = sandbox.spy(image, 'createSpectrumVisualizerFrameGenerator');
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

    const { exitCode } = await renderAudioVisualizer(config);
    expect(exitCode).equal(EXIT_CODE);
    expect(polarSpy.called).equal(false);
    expect(spectrumSpy.called).equal(false);
  });

  it('renders a polar visualizer when polar is specified', async function () {
    const polarSpy = sandbox.spy(image, 'createPolarVisualizerFrameGenerator');
    const spectrumSpy = sandbox.spy(image, 'createSpectrumVisualizerFrameGenerator');
    const config: Config = {
      audio: {
        path: 'audioPath'
      },
      image: {
        path: 'example/media/horses.png'
      },
      outVideo: {
        path: 'outVideoPath',
        fps: 1,
        polar: {}
      }
    };

    const { exitCode } = await renderAudioVisualizer(config);
    expect(exitCode).equal(EXIT_CODE);
    expect(polarSpy.calledOnce).equal(true);
    expect(spectrumSpy.called).equal(false);
  });

  it('renders a spectrum visualizer when spectrum is specified', async function () {
    const polarSpy = sandbox.spy(image, 'createPolarVisualizerFrameGenerator');
    const spectrumSpy = sandbox.spy(image, 'createSpectrumVisualizerFrameGenerator');
    const config: Config = {
      audio: {
        path: 'audioPath'
      },
      image: {
        path: 'example/media/horses.png'
      },
      outVideo: {
        path: 'outVideoPath',
        fps: 1,
        spectrum: {}
      }
    };

    const { exitCode } = await renderAudioVisualizer(config);
    expect(exitCode).equal(EXIT_CODE);
    expect(spectrumSpy.calledOnce).equal(true);
    expect(polarSpy.called).equal(false);
  });

  it('resolves and does not report 100 when process completion times out', async function () {
    (this as any).setMockWriter(false);
    sandbox.stub(video, 'waitForProcessExit').callsFake(
      () => Promise.resolve({ exitCode: 1 })
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
});
