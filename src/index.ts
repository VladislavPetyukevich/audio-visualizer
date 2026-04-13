import {
  getAudioFilePath,
  getBackgroundImagePath,
  getBackgroundVideoPath,
  getOutVideoPath,
  getFPS,
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
  getOutputResolution,
  rotationAliasValues,
  getSpectrumRotation,
  getSpectrumEffect,
  SpectrumEffect,
  getPolarXAbsolute,
  getPolarYAbsolute,
  getPolarInnerRadius,
  getPolarMaxBarLength,
  getPolarBarWidth,
  getPolarEffect,
  getPolarColor,
  getPolarOpacityParsed,
  getAutoEditVideo,
} from './config';
import { createAudioBuffer, bufferToUInt8, createSpectrumsProcessor } from './audio';
import { parseImage, getImageColor, getVideoFrameColor, invertColor, Color, convertToBmp, createSpectrumVisualizerFrameGenerator, createPolarVisualizerFrameGenerator, CreatePolarVisualizerFrameProps, CreateVisualizerFrameProps, CommonVisualizerFrameProps } from './image';
import { spawnFfmpegVideoWriter, getProgress, calculateProgress, waitDrain, getVideoInfo, spawnVideoFrameReader, readVideoFrame, detectSceneChanges, buildBeatSyncedSegments, writeConcatFile, spawnConcatVideoFrameReader, cleanupConcatFile } from './video';
import { createBpmEncoder, createBgrFrameEncoder, EncodedBmp } from './bpmEncoder';
import { BmpDecoder } from 'bmp-js';
import { createBeatDetector, BeatInfo } from './beats';
export { BeatInfo, BeatDetectorOptions } from './beats';

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
  image?: {
    path: string;
  };
  video?: {
    path: string;
    autoEdit?: boolean;
  };
  outVideo: {
    path: string;
    fps?: number;
    resolution?: {
      width: number;
      height: number;
    };
    spectrum?: {
      width?: SpectrumSizeValue;
      height?: SpectrumSizeValue;
      x?: number | PositionAliasName;
      y?: number | PositionAliasName;
      rotation?: RotationAliasName;
      effect?: SpectrumEffect;
      color?: Color | string;
      opacity?: string;
    };
    polar?: {
      x?: number | PositionAliasName;
      y?: number | PositionAliasName;
      innerRadius?: number;
      maxBarLength?: number;
      barWidth?: number;
      effect?: SpectrumEffect;
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

const createVisualizerFrameGenerator = (
  config: Config,
  backgroundWidth: number,
  backgroundHeight: number,
  defaultColor: Color,
  spectrumBusMargin: number
): (params: CommonVisualizerFrameProps) => EncodedBmp => {
  if (!config.outVideo.spectrum) {
    const createPolarVisualizerFrame = createPolarVisualizerFrameGenerator();
    const polarX = getPolarXAbsolute(config, backgroundWidth);
    const polarY = getPolarYAbsolute(config, backgroundHeight);
    const polarInnerRadius = getPolarInnerRadius(config);
    const polarMaxBarLength = getPolarMaxBarLength(config);
    const polarBarWidth = getPolarBarWidth(config);
    const polarColor = getPolarColor(config) || invertColor(defaultColor);
    const polarEffect = getPolarEffect(config);
    const polarOpacity = getPolarOpacityParsed(config);

    return (params: CommonVisualizerFrameProps) => {
      return createPolarVisualizerFrame({
        ...params,
        centerX: polarX,
        centerY: polarY,
        innerRadius: polarInnerRadius,
        maxBarLength: polarMaxBarLength,
        barWidth: polarBarWidth,
        color: polarColor,
        opacity: polarOpacity,
        spectrumEffect: polarEffect,
      });
    };
  }
  const createSpectrumVisualizerFrame = createSpectrumVisualizerFrameGenerator();
  const spectrumWidth = getSpectrumWidthAbsolute(config, backgroundWidth);
  const spectrumHeight = getSpectrumHeightAbsolute(config, backgroundHeight);
  const spectrumX = getSpectrumXAbsolute(config, spectrumWidth, backgroundWidth);
  const spectrumY = getSpectrumYAbsolute(config, spectrumHeight, backgroundHeight);
  const spectrumRotation = getSpectrumRotation(config);
  const spectrumColor = getSpectrumColor(config) || invertColor(defaultColor);
  const spectrumEffect = getSpectrumEffect(config);
  const spectrumOpacity = getSpectrumOpacityParsed(config);

  return (params: CommonVisualizerFrameProps) => {
    return createSpectrumVisualizerFrame({
      ...params,
      size: { width: spectrumWidth, height: spectrumHeight },
      position: { x: spectrumX, y: spectrumY },
      rotation: spectrumRotation,
      margin: spectrumBusMargin,
      color: spectrumColor,
      opacity: spectrumOpacity,
      spectrumEffect,
    });
  };
};

interface PreProcessedAudio {
  spectrums: number[][];
  beatFrameIndices: number[];
}

const preProcessAudio = (
  audioBuffer: Buffer,
  sampleRate: number,
  fps: number,
  framesCount: number,
): PreProcessedAudio => {
  const audioDataStep = Math.trunc(audioBuffer.length / framesCount);
  const processingBuffer = new Float32Array(PROCESSING_BUFFER_SIZE).fill(0);
  const skipFramesCount = fps < 45 ? 1 : 2;
  const processSpectrum = createSpectrumsProcessor(sampleRate, skipFramesCount);
  const detectBeat = createBeatDetector(fps);

  const spectrums: number[][] = [];
  const beatFrameIndices: number[] = [];

  for (let i = 0; i < framesCount; i++) {
    const currentFrameData = PCM_FORMAT.parseFunction(audioBuffer, i * audioDataStep, i * audioDataStep + audioDataStep);
    processingBuffer.copyWithin(0, currentFrameData.length);
    processingBuffer.set(currentFrameData, PROCESSING_BUFFER_SIZE - currentFrameData.length);

    const audioDataParser = () => Array.from(processingBuffer);
    const spectrum = processSpectrum(audioDataParser);
    const beat = detectBeat(spectrum);

    spectrums.push(spectrum);
    if (beat.isBeat) {
      beatFrameIndices.push(i);
    }
  }

  return { spectrums, beatFrameIndices };
};

async function prepareBackgroundForRender(params: {
  useVideoBackground: boolean;
  backgroundVideoPath: string | undefined;
  backgroundImagePath: string | undefined;
  beatFrameIndices: number[];
  framesCount: number;
  outputResolution: ReturnType<typeof getOutputResolution>;
  fps: number;
  autoEditVideo: boolean;
}): Promise<{
  backgroundWidth: number;
  backgroundHeight: number;
  defaultColor: Color;
  staticBackgroundBuffer: EncodedBmp;
  videoFrameReader?: ReturnType<typeof spawnVideoFrameReader>;
  videoFrameSize: number;
  encodeVideoFrame?: (bgrBuffer: Buffer) => EncodedBmp;
  concatFilePath?: string;
}> {
  const {
    useVideoBackground,
    backgroundVideoPath,
    backgroundImagePath,
    beatFrameIndices,
    framesCount,
    outputResolution,
    fps,
    autoEditVideo,
  } = params;

  if (useVideoBackground && backgroundVideoPath) {
    const videoInfo = await getVideoInfo(backgroundVideoPath);
    const sceneChanges = autoEditVideo
      ? await detectSceneChanges(backgroundVideoPath)
      : [];
    const backgroundWidth = outputResolution?.width ?? videoInfo.width;
    const backgroundHeight = outputResolution?.height ?? videoInfo.height;

    const videoFrameSize = backgroundWidth * backgroundHeight * 3;
    const encodeVideoFrame = createBgrFrameEncoder({ width: backgroundWidth, height: backgroundHeight });

    const segments = buildBeatSyncedSegments(
      beatFrameIndices,
      framesCount,
      sceneChanges,
      videoInfo.duration,
    );

    const concatFilePath = writeConcatFile(segments, backgroundVideoPath, videoInfo.duration, fps);

    const videoFrameReader = spawnConcatVideoFrameReader({
      concatFilePath,
      fps,
      totalFrames: framesCount,
      ...(outputResolution && {
        width: backgroundWidth,
        height: backgroundHeight,
        sourceWidth: videoInfo.width,
        sourceHeight: videoInfo.height,
      }),
    });

    const firstFrame = await readVideoFrame(videoFrameReader.stdout, videoFrameSize);
    if (!firstFrame) {
      throw new Error(`Could not read frames from video: ${backgroundVideoPath}`);
    }
    const defaultColor = getVideoFrameColor(firstFrame, backgroundWidth, backgroundHeight);
    const staticBackgroundBuffer = encodeVideoFrame(firstFrame);
    return {
      backgroundWidth,
      backgroundHeight,
      defaultColor,
      staticBackgroundBuffer,
      videoFrameReader,
      videoFrameSize,
      encodeVideoFrame,
      concatFilePath,
    };
  }

  if (!backgroundImagePath) {
    throw new Error('Background image path is required when not using video background.');
  }
  const backgroundImageBmpBuffer = await convertToBmp(
    backgroundImagePath,
    outputResolution?.width,
    outputResolution?.height,
  );
  const backgroundImage = parseImage(backgroundImageBmpBuffer);
  const backgroundWidth = backgroundImage.width;
  const backgroundHeight = backgroundImage.height;
  const defaultColor = getImageColor(backgroundImage);

  const bpmEncoder = createBpmEncoder({ width: backgroundWidth, height: backgroundHeight });
  const staticBackgroundBuffer = bpmEncoder(backgroundImage.data);
  return {
    backgroundWidth,
    backgroundHeight,
    defaultColor,
    staticBackgroundBuffer,
    videoFrameSize: 0,
  };
}

async function resolveBackgroundFrameBuffer(params: {
  frameIndex: number;
  useVideoBackground: boolean;
  videoFrameReader?: ReturnType<typeof spawnVideoFrameReader>;
  videoFrameSize: number;
  encodeVideoFrame?: (bgrBuffer: Buffer) => EncodedBmp;
  staticBackgroundBuffer: EncodedBmp;
}): Promise<EncodedBmp> {
  const {
    frameIndex,
    useVideoBackground,
    videoFrameReader,
    videoFrameSize,
    encodeVideoFrame,
    staticBackgroundBuffer,
  } = params;

  if (useVideoBackground && videoFrameReader && encodeVideoFrame) {
    if (frameIndex === 0) {
      return staticBackgroundBuffer;
    }
    const videoFrame = await readVideoFrame(videoFrameReader.stdout, videoFrameSize);
    return videoFrame
      ? encodeVideoFrame(videoFrame)
      : staticBackgroundBuffer;
  }
  return staticBackgroundBuffer;
}

export const renderAudioVisualizer = (config: Config, onProgress?: (progress: number) => any, shouldStop?: () => boolean) =>
  new Promise<number>(async (resolve) => {
    if (config.outVideo.spectrum && config.outVideo.polar) {
      throw new Error('Cannot use both "spectrum" and "polar" options. Please specify only one visualizer type.');
    }
    if (!config.image && !config.video) {
      throw new Error('Either "image" or "video" must be specified as the background source.');
    }
    if (config.image && config.video) {
      throw new Error('Cannot use both "image" and "video" options. Please specify only one background source.');
    }

    const audioFilePath = getAudioFilePath(config);
    const outVideoPath = getOutVideoPath(config);
    const backgroundVideoPath = getBackgroundVideoPath(config);
    const backgroundImagePath = getBackgroundImagePath(config);
    const useVideoBackground = !!backgroundVideoPath;

    const audioReader = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
    const audioBuffer = audioReader.audioBuffer;
    const sampleRate = audioReader.sampleRate;
    if (!sampleRate) {
      throw new Error('ffmpeg didn\'t show audio sample rate');
    }

    const spectrumBusMargin = getSpectrumBusMargin();
    const FPS = getFPS(config);
    const ffmpeg_cfr = getFfmpeg_cfr(config);
    const ffmpeg_preset = getFfmpeg_preset(config);
    const frame_processing_delay = getFrame_processing_delay(config);

    const audioDuration = audioBuffer.length / sampleRate;
    const framesCount = Math.trunc(audioDuration * FPS);
    const outputResolution = getOutputResolution(config);

    const preprocessed = preProcessAudio(audioBuffer, sampleRate, FPS, framesCount);

    const {
      backgroundWidth,
      backgroundHeight,
      defaultColor,
      staticBackgroundBuffer,
      videoFrameReader,
      videoFrameSize,
      encodeVideoFrame,
      concatFilePath,
    } = await prepareBackgroundForRender({
      useVideoBackground,
      backgroundVideoPath,
      backgroundImagePath,
      beatFrameIndices: preprocessed.beatFrameIndices,
      framesCount,
      outputResolution,
      fps: FPS,
      autoEditVideo: getAutoEditVideo(config),
    });

    const createVisualizerFrame = createVisualizerFrameGenerator(
      config, backgroundWidth, backgroundHeight, defaultColor, spectrumBusMargin
    );

    const ffmpegVideoWriter = spawnFfmpegVideoWriter({
      audioFilename: audioFilePath,
      videoFileName: outVideoPath,
      fps: FPS,
      ...(!!onProgress && { onStderr: getProgress(calculateProgress(framesCount + 1, onProgress)) }),
      ...(ffmpeg_cfr && { crf: ffmpeg_cfr }),
      ...(ffmpeg_preset && { preset: ffmpeg_preset }),
    });
    ffmpegVideoWriter.on('exit', (code: number) => resolve(code));

    for (let i = 0; i < framesCount; i++) {
      const spectrum = preprocessed.spectrums[i];

      const backgroundImageBuffer = await resolveBackgroundFrameBuffer({
        frameIndex: i,
        useVideoBackground,
        videoFrameReader,
        videoFrameSize,
        encodeVideoFrame,
        staticBackgroundBuffer,
      });

      const commonVisualizerFrameProps: CommonVisualizerFrameProps = {
        backgroundImageBuffer,
        spectrum,
      };
      const frameImage = createVisualizerFrame(commonVisualizerFrameProps);
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

    if (videoFrameReader) {
      videoFrameReader.kill();
    }
    if (concatFilePath) {
      cleanupConcatFile(concatFilePath);
    }
    ffmpegVideoWriter.stdin.end();
  });
