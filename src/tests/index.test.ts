import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { renderAudioVisualizer, Config } from '../index';
import path from 'path';
import fs from 'fs';
import { Writable, Readable } from 'stream';
import { ChildProcessWithoutNullStreams } from 'child_process';
import * as image from '../image';
import * as audio from '../audio';
import * as video from '../video';

const EXIT_CODE = 0;
const sandbox = createSandbox();

describe('index', function () {

  this.beforeAll(function () {
    sandbox.stub(fs, 'readFileSync').returns(Buffer.from([1, 1]));
    sandbox.stub(audio, 'createAudioBuffer').returns(
      new Promise(resolve => resolve({ audioBuffer: Buffer.from([1, 1]), sampleRate: 2 }))
    );
    sandbox.stub(image, 'getImageColor').returns({ red: 0, green: 0, blue: 0 });

    let exitCallback: Function = () => { };
    const stdin = new Writable({
      write(_chunk: Buffer, _enc: string, cb: (error?: Error | null) => void) {
        exitCallback(EXIT_CODE);
        cb();
      },
    });
    let childProcessStream: unknown = {
      stdin,
      stderr: new Readable(),
      on: function (_: string, callback: Function) {
        exitCallback = callback;
      },
    };
    sandbox.stub(video, 'spawnFfmpegVideoWriter').returns(childProcessStream as ChildProcessWithoutNullStreams);
  });

  this.afterAll(function () {
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
});
