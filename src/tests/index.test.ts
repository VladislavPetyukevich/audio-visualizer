import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { renderAudioVisualizer, Config, PCM_FORMAT } from '../index';
import fs from 'fs';
import { PNG } from 'pngjs';
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
    sandbox.stub(image, 'parseImage').returns(new Promise(resolve => resolve(new PNG({ width: 100, height: 50 }))));
    sandbox.stub(audio, 'createAudioBuffer').returns(
      new Promise(resolve => resolve({ audioBuffer: Buffer.from([1, 1]), sampleRate: 2 }))
    );
    sandbox.stub(image, 'getImageColor').returns(new Promise(resolve => resolve({ red: 0, green: 0, blue: 0 })));

    let exitCallback: Function = () => { };
    let childProcessStream: unknown = {
      stdin: new Writable(),
      stderr: new Readable(),
      on: function (event: string, callback: Function) {
        exitCallback = callback;
      }
    };
    (<ChildProcessWithoutNullStreams>childProcessStream).stdin._write = () => exitCallback(EXIT_CODE);
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
        path: 'imagePath'
      },
      outVideo: {
        path: 'outVideoPath',
        fps: 1
      }
    };

    const exitCode = await renderAudioVisualizer(config);
    expect(exitCode).equal(EXIT_CODE);
  });
});
