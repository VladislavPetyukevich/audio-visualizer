import path from 'path';
import { createAudioBuffer, bufferToUInt8, createSpectrumsProcessor } from './audio';
import { parseImage, createVisualizerFrame, createImageBuffer, getImageColor, invertColor, Color, convertToBmp } from './image';
import { spawnFfmpegVideoWriter, getProgress, calculateProgress, waitDrain } from './video';

export const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;

export interface Config {
  audio: {
    path: string
  };
  image: {
    path: string;
  };
  outVideo: {
    path: string;
    fps?: number;
    spectrum?: {
      width?: number;
      height?: number;
      color?: Color | string;
    }
  };
  tweaks?: {
    ffmpeg_cfr?: string;
    ffmpeg_preset?: string;
  };
}

export const renderAudioVisualizer = (config: Config, onProgress?: (progress: number) => any, shouldStop?: () => boolean) =>
  new Promise<number>(async (resolve) => {
    const audioFilePath = path.resolve(config.audio.path);
    const backgroundImagePath = path.resolve(config.image.path);
    const outVideoPath = path.resolve(config.outVideo.path);

    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const audioReader = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
    const audioBuffer = audioReader.audioBuffer;
    const sampleRate = audioReader.sampleRate;
    if (!sampleRate) {
      throw new Error('ffmpeg didn\'t show audio sample rate');
    }

    const FPS = config.outVideo.fps || 60;
    const spectrumWidth =
      (config.outVideo.spectrum && config.outVideo.spectrum.width) ||
      backgroundImage.width * 0.4;
    const spectrumHeight =
      (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
      backgroundImage.height * 0.1;
    const spectrumColor =
      (config.outVideo.spectrum && config.outVideo.spectrum.color) ||
      invertColor(getImageColor(backgroundImage));
    const ffmpeg_cfr =
      config.tweaks && config.tweaks.ffmpeg_cfr;
    const ffmpeg_preset =
      config.tweaks && config.tweaks.ffmpeg_preset;
    const spectrumBusesCount = 64;

    const audioDuration = audioBuffer.length / sampleRate;
    const framesCount = Math.trunc(audioDuration * FPS);
    const audioDataStep = Math.trunc(audioBuffer.length / framesCount);

    const ffmpegVideoWriter = spawnFfmpegVideoWriter({
      audioFilename: audioFilePath,
      videoFileName: outVideoPath,
      fps: FPS,
      ...(!!onProgress && { onStderr: getProgress(calculateProgress(framesCount + 1, onProgress)) }),
      ...(ffmpeg_cfr && { crf: ffmpeg_cfr }),
      ...(ffmpeg_preset && { preset: ffmpeg_preset }),
    });
    ffmpegVideoWriter.on('exit', (code: number) => resolve(code));

    const processSpectrum = createSpectrumsProcessor(spectrumBusesCount);
    for (let i = 0; i < framesCount; i++) {
      const audioDataParser = () =>
        PCM_FORMAT.parseFunction(audioBuffer, i * audioDataStep, i * audioDataStep + audioDataStep);
      const spectrum = processSpectrum(i, audioDataParser);
      const frameImage = createVisualizerFrame(
        backgroundImage,
        spectrum,
        { width: spectrumWidth, height: spectrumHeight },
        spectrumColor
      );
      const frameImageBuffer = createImageBuffer(frameImage);
      const isFrameProcessed = ffmpegVideoWriter.stdin.write(frameImageBuffer);
      if (!isFrameProcessed) {
        await waitDrain(ffmpegVideoWriter.stdin);
      }
      if (shouldStop && shouldStop()) {
        break;
      }
    }

    ffmpegVideoWriter.stdin.end();
  });
