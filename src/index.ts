import {
  getAudioFilePath,
  getBackgroundImagePath,
  getOutVideoPath,
  getFPS,
  getSpectrumBusesCount,
  getSpectrumBusMargin,
  getSpectrumWidthAbsolute,
  getSpectrumHeightAbsolute,
  getSpectrumXAbsolute,
  getSpectrumYAbsolute,
  getSpectrumColor,
  getSpectrumOpacityParsed,
  getFfmpeg_cfr,
  getFfmpeg_preset,
  getFrame_processing_delay,
  rotationAliasValues,
  getSpectrumRotation
} from './config';
import { createAudioBuffer, bufferToUInt8, createSpectrumsProcessor } from './audio';
import { parseImage, createVisualizerFrame, getImageColor, invertColor, Color, convertToBmp } from './image';
import { spawnFfmpegVideoWriter, getProgress, calculateProgress, waitDrain } from './video';
import { createBpmEncoder } from './bpmEncoder';

export const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;
const PROCESSING_BUFFER_SIZE = Math.pow(2, 12);

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
      width?: SpectrumSizeValue;
      height?: SpectrumSizeValue;
      x?: number | PositionAliasName;
      y?: number | PositionAliasName;
      rotation?: RotationAliasName;
      color?: Color | string;
      opacity?: string;
    }
  };
  tweaks?: {
    ffmpeg_cfr?: string;
    ffmpeg_preset?: string;
    frame_processing_delay?: number;
  };
}

export type SpectrumSizeValue = number | string;

export type PositionAliasName =
  'left' |
  'center' |
  'right' |
  'top' |
  'middle' |
  'bottom';

export type RotationAliasName = typeof rotationAliasValues[number];

const sleep = (timeout: number) =>
  new Promise(resolve => setTimeout(resolve, timeout));

export const renderAudioVisualizer = (config: Config, onProgress?: (progress: number) => any, shouldStop?: () => boolean) =>
  new Promise<number>(async (resolve) => {
    const audioFilePath = getAudioFilePath(config);
    const backgroundImagePath = getBackgroundImagePath(config);
    const outVideoPath = getOutVideoPath(config);

    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const audioReader = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
    const audioBuffer = audioReader.audioBuffer;
    const sampleRate = audioReader.sampleRate;
    if (!sampleRate) {
      throw new Error('ffmpeg didn\'t show audio sample rate');
    }

    const spectrumBusesCount = getSpectrumBusesCount();
    const spectrumBusMargin = getSpectrumBusMargin();
    const FPS = getFPS(config);
    const spectrumWidth =
      getSpectrumWidthAbsolute(config, backgroundImage.width);
    const spectrumHeight =
      getSpectrumHeightAbsolute(config, backgroundImage.height);
    const spectrumX =
      getSpectrumXAbsolute(config, spectrumWidth, backgroundImage.width);
    const spectrumY =
      getSpectrumYAbsolute(config, spectrumHeight, backgroundImage.height);
    const spectrumRotation =
      getSpectrumRotation(config);
    const spectrumColor =
      getSpectrumColor(config) ||
      invertColor(getImageColor(backgroundImage));
    const spectrumOpacity = getSpectrumOpacityParsed(config);
    const ffmpeg_cfr = getFfmpeg_cfr(config);
    const ffmpeg_preset = getFfmpeg_preset(config);
    const frame_processing_delay = getFrame_processing_delay(config);

    const audioDuration = audioBuffer.length / sampleRate;
    const framesCount = Math.trunc(audioDuration * FPS);
    const audioDataStep = Math.trunc(audioBuffer.length / framesCount);
    const processingBuffer = new Float32Array(PROCESSING_BUFFER_SIZE).fill(0);

    const ffmpegVideoWriter = spawnFfmpegVideoWriter({
      audioFilename: audioFilePath,
      videoFileName: outVideoPath,
      fps: FPS,
      ...(!!onProgress && { onStderr: getProgress(calculateProgress(framesCount + 1, onProgress)) }),
      ...(ffmpeg_cfr && { crf: ffmpeg_cfr }),
      ...(ffmpeg_preset && { preset: ffmpeg_preset }),
    });
    ffmpegVideoWriter.on('exit', (code: number) => resolve(code));

    const bpmEncoder = createBpmEncoder({ width: backgroundImage.width, height: backgroundImage.height });
    const backgroundImageBuffer = bpmEncoder(backgroundImage.data);
    const skipFramesCount = FPS < 45 ? 1 : 2;
    const processSpectrum = createSpectrumsProcessor(sampleRate, skipFramesCount);
    for (let i = 0; i < framesCount; i++) {
      const currentFrameData = PCM_FORMAT.parseFunction(audioBuffer, i * audioDataStep, i * audioDataStep + audioDataStep);
      processingBuffer.copyWithin(0, currentFrameData.length);
      processingBuffer.set(currentFrameData, PROCESSING_BUFFER_SIZE - currentFrameData.length);

      const audioDataParser = () => Array.from(processingBuffer);
      const spectrum = processSpectrum(audioDataParser);
      const frameImage = createVisualizerFrame({
        backgroundImageBuffer,
        spectrum,
        size: { width: spectrumWidth, height: spectrumHeight },
        position: { x: spectrumX, y: spectrumY },
        rotation: spectrumRotation,
        margin: spectrumBusMargin,
        color: spectrumColor,
        opacity: spectrumOpacity,
      });
      const isFrameProcessed = ffmpegVideoWriter.stdin.write(frameImage.data);
      if (!isFrameProcessed) {
        await waitDrain(ffmpegVideoWriter.stdin);
      }
      if (shouldStop && shouldStop()) {
        break;
      }
      if (frame_processing_delay) {
        await sleep(frame_processing_delay);
      }
    }

    ffmpegVideoWriter.stdin.end();
  });
