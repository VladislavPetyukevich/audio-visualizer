import path from 'path';
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
  getAudioAutoHighlight,
  getAudioAutoHighlightCount,
} from './config';
import { createAudioBuffer, bufferToUInt8, createSpectrumsProcessor } from './audio';
import { parseImage, getImageColor, getVideoFrameColor, invertColor, Color, convertToBmp, createSpectrumVisualizerFrameGenerator, createPolarVisualizerFrameGenerator, CreatePolarVisualizerFrameProps, CreateVisualizerFrameProps, CommonVisualizerFrameProps } from './image';
import { spawnFfmpegVideoWriter, getProgress, waitDrain, getVideoInfo, spawnVideoFrameReader, readVideoFrame, detectSceneChanges, buildBeatSyncedSegments, writeConcatFile, spawnConcatVideoFrameReader, cleanupConcatFile } from './video';
import { createBpmEncoder, createBgrFrameEncoder, EncodedBmp } from './bpmEncoder';
import { createBeatDetector } from './beats';
export { BeatInfo, BeatDetectorOptions } from './beats';
import { computeHighlightSlice, HIGHLIGHT_DURATION_SEC } from './highlight';
import { waitForEventLoop } from './waitForEventLoop';
export { computeHighlightSlice, HIGHLIGHT_DURATION_SEC, BeatFrameEvent, HighlightAudioSegment, HighlightRun } from './highlight';

export const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;
const PROCESSING_BUFFER_SIZE = Math.pow(2, 12);

export interface Config {
  audio: {
    path: string;
    autoHighlight?: boolean;
    /** When `autoHighlight` is true, number of non-overlapping 15s windows to stitch (default 1). */
    autoHighlightCount?: number;
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
  beatEvents: { frameIndex: number; intensity: number }[];
}

const PREPROCESS_YIELD_EVERY = 1;

const preProcessAudio = async (
  audioBuffer: Buffer,
  sampleRate: number,
  fps: number,
  framesCount: number,
): Promise<PreProcessedAudio> => {
  const audioDataStep = Math.trunc(audioBuffer.length / framesCount);
  const processingBuffer = new Float32Array(PROCESSING_BUFFER_SIZE).fill(0);
  const skipFramesCount = fps < 45 ? 1 : 2;
  const processSpectrum = createSpectrumsProcessor(sampleRate, skipFramesCount);
  const detectBeat = createBeatDetector(fps);

  const spectrums: number[][] = [];
  const beatFrameIndices: number[] = [];
  const beatEvents: { frameIndex: number; intensity: number }[] = [];

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
      beatEvents.push({ frameIndex: i, intensity: beat.intensity });
    }

    await waitForEventLoop();
  }

  return { spectrums, beatFrameIndices, beatEvents };
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

export interface RenderAudioVisualizerResult {
  exitCode: number;
  /** Absolute paths of video files written successfully (exit code 0, full pass, no early stop). */
  outputVideoFiles: string[];
}

export const renderAudioVisualizer = (config: Config, onProgress?: (progress: number) => any, shouldStop?: () => boolean) =>
  new Promise<RenderAudioVisualizerResult>(async (resolve) => {
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

    if (onProgress) {
      onProgress(0);
    }
    const preprocessed = await preProcessAudio(audioBuffer, sampleRate, FPS, framesCount);

    const autoHighlight = getAudioAutoHighlight(config);
    let spectrumsForRender = preprocessed.spectrums;
    let beatIndicesForRender = preprocessed.beatFrameIndices;
    let framesCountForRender = framesCount;
    type HighlightSliceResult = ReturnType<typeof computeHighlightSlice> extends Promise<
      infer R
    >
      ? R
      : never;
    let highlightSlice: HighlightSliceResult | undefined;

    if (autoHighlight) {
      highlightSlice = await computeHighlightSlice(
        FPS,
        framesCount,
        preprocessed.spectrums,
        preprocessed.beatEvents,
        getAudioAutoHighlightCount(config),
      );
      spectrumsForRender = highlightSlice.spectrums;
      beatIndicesForRender = highlightSlice.beatFrameIndices;
      framesCountForRender = highlightSlice.highlightFrames;
    }

    const separateHighlightFiles =
      autoHighlight &&
      highlightSlice &&
      highlightSlice.runs.length > 1;

    type VideoRenderPass = {
      outPath: string;
      spectrums: number[][];
      beatIndices: number[];
      frameCount: number;
      audioSegments: import('./highlight').HighlightAudioSegment[] | undefined;
    };

    const passes: VideoRenderPass[] =
      separateHighlightFiles && highlightSlice
      ? highlightSlice.runs.map((run, i) => {
          const dir = path.dirname(outVideoPath);
          const ext = path.extname(outVideoPath);
          const base = path.basename(outVideoPath, ext);
          const numberedPath = path.resolve(dir, `${base}-${i + 1}${ext}`);
          return {
            outPath: numberedPath,
            spectrums: run.spectrums,
            beatIndices: run.beatFrameIndices,
            frameCount: run.highlightFrames,
            audioSegments: [run.audioSegment],
          };
        })
      : [
          {
            outPath: outVideoPath,
            spectrums: spectrumsForRender,
            beatIndices: beatIndicesForRender,
            frameCount: framesCountForRender,
            audioSegments:
              autoHighlight &&
              highlightSlice &&
              highlightSlice.audioSegments.length > 0
                ? highlightSlice.audioSegments
                : undefined,
          },
        ];

    const progressDenominator =
      passes.reduce((s, p) => s + p.frameCount, 0) + passes.length;
    let progressFrameBase = 0;
    let lastExitCode = 0;
    const outputVideoFiles: string[] = [];

    passLoop: for (const pass of passes) {
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
        beatFrameIndices: pass.beatIndices,
        framesCount: pass.frameCount,
        outputResolution,
        fps: FPS,
        autoEditVideo: getAutoEditVideo(config),
      });

      const createVisualizerFrame = createVisualizerFrameGenerator(
        config, backgroundWidth, backgroundHeight, defaultColor, spectrumBusMargin
      );

      const ffmpegVideoWriter = spawnFfmpegVideoWriter({
        audioFilename: audioFilePath,
        videoFileName: pass.outPath,
        fps: FPS,
        ...(pass.audioSegments &&
          pass.audioSegments.length > 0 && { audioSegments: pass.audioSegments }),
        ...(!!onProgress && {
          onStderr: getProgress((currentFrame: number) => {
            const g = progressFrameBase + currentFrame;
            onProgress(
              +(Math.min(100, (g / progressDenominator) * 100)).toFixed(2),
            );
          }),
        }),
        ...(ffmpeg_cfr && { crf: ffmpeg_cfr }),
        ...(ffmpeg_preset && { preset: ffmpeg_preset }),
      });

      const exitPromise = new Promise<number>(res => {
        let settled = false;
        ffmpegVideoWriter.on('exit', (code: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          res(code ?? 0);
        });
      });

      let stoppedEarly = false;
      for (let i = 0; i < pass.frameCount; i++) {
        const spectrum = pass.spectrums[i];

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
          stoppedEarly = true;
          break;
        }
        if (frame_processing_delay) {
          await sleep(frame_processing_delay);
        }
        await waitForEventLoop();
      }

      if (videoFrameReader) {
        videoFrameReader.kill();
      }
      if (concatFilePath) {
        cleanupConcatFile(concatFilePath);
      }
      ffmpegVideoWriter.stdin.end();

      lastExitCode = await exitPromise;
      progressFrameBase += pass.frameCount + 1;

      if (lastExitCode === 0 && !stoppedEarly) {
        outputVideoFiles.push(pass.outPath);
      }

      if (stoppedEarly || lastExitCode !== 0) {
        break passLoop;
      }
    }

    resolve({ exitCode: lastExitCode, outputVideoFiles });
  });
