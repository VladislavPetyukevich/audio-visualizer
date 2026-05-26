import path from 'path';
import { readFileSync } from 'fs';
import {
  getAudioFilePath,
  getBackgroundImagePath,
  getBackgroundVideoPath,
  getOutVideoPath,
  getSubtitleRenderSpec,
  subtitleAlignmentToAss,
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
import { normalizeInlineSubtitlesToSrt, lrcToSrt } from './subtitleConvert';
import { spawnFfmpegVideoWriter, waitDrain, waitForProcessExit, getVideoInfo, spawnVideoFrameReader, readVideoFrame, detectSceneChanges, buildBeatSyncedSegments, writeConcatFile, writeSubtitlesFile, spawnConcatVideoFrameReader, cleanupConcatFile, cleanupTempFile } from './video';
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
const MAX_CONSECUTIVE_VIDEO_FRAME_READ_FAILURES = 5;

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
    subtitles?:
      | string
      | {
          path?: string;
          rawContent?: string;
          alignment?: 'top' | 'middle' | 'bottom';
        };
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

const PRE_PROCESS_PROGRESS_SHARE = 60;
const POST_AUDIO_PROGRESS_SHARE = 10;
const RENDER_PROGRESS_SHARE = 30;

const preProcessAudio = async (
  audioBuffer: Buffer,
  sampleRate: number,
  fps: number,
  framesCount: number,
  onPreProcessProgress?: (totalPercent: number) => void,
): Promise<PreProcessedAudio> => {
  if (framesCount === 0) {
    for (let t = 1; t <= PRE_PROCESS_PROGRESS_SHARE; t += 1) {
      onPreProcessProgress?.(t);
    }
    return { spectrums: [], beatFrameIndices: [], beatEvents: [] };
  }
  const audioDataStep = Math.trunc(audioBuffer.length / framesCount);
  const processingBuffer = new Float32Array(PROCESSING_BUFFER_SIZE).fill(0);
  const skipFramesCount = fps < 45 ? 1 : 2;
  const processSpectrum = createSpectrumsProcessor(sampleRate, skipFramesCount);
  const detectBeat = createBeatDetector(fps);

  const spectrums: number[][] = [];
  const beatFrameIndices: number[] = [];
  const beatEvents: { frameIndex: number; intensity: number }[] = [];
  let nextPreProcessMilestone = 1;

  for (let i = 0; i < framesCount; i++) {
    const currentFrameData = PCM_FORMAT.parseFunction(audioBuffer, i * audioDataStep, i * audioDataStep + audioDataStep);
    const frameDataLength = Math.min(currentFrameData.length, PROCESSING_BUFFER_SIZE);
    const frameDataTailStart = currentFrameData.length - frameDataLength;
    const frameDataToProcess = currentFrameData.slice(frameDataTailStart);

    processingBuffer.copyWithin(0, frameDataLength);
    processingBuffer.set(frameDataToProcess, PROCESSING_BUFFER_SIZE - frameDataLength);

    const audioDataParser = () => Array.from(processingBuffer);
    const spectrum = processSpectrum(audioDataParser);
    const beat = detectBeat(spectrum);

    spectrums.push(spectrum);
    if (beat.isBeat) {
      beatFrameIndices.push(i);
      beatEvents.push({ frameIndex: i, intensity: beat.intensity });
    }

    const p =
      PRE_PROCESS_PROGRESS_SHARE * (i + 1) / framesCount;
    while (
      nextPreProcessMilestone <= PRE_PROCESS_PROGRESS_SHARE
      && p >= nextPreProcessMilestone
    ) {
      onPreProcessProgress?.(nextPreProcessMilestone);
      nextPreProcessMilestone += 1;
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
}): Promise<{ frameBuffer: EncodedBmp; frameReadFailed: boolean }> {
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
      return { frameBuffer: staticBackgroundBuffer, frameReadFailed: false };
    }
    const videoFrame = await readVideoFrame(videoFrameReader.stdout, videoFrameSize);
    if (videoFrame) {
      return { frameBuffer: encodeVideoFrame(videoFrame), frameReadFailed: false };
    }
    return { frameBuffer: staticBackgroundBuffer, frameReadFailed: true };
  }
  return { frameBuffer: staticBackgroundBuffer, frameReadFailed: false };
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
    const subtitleSpec = getSubtitleRenderSpec(config);
    let subtitleFilePath: string | undefined;
    let subtitleFileIsTemporary = false;
    let subtitleAlignmentAss = 2;
    if (subtitleSpec) {
      subtitleAlignmentAss = subtitleAlignmentToAss(subtitleSpec.alignment);
      if (subtitleSpec.source.kind === 'file') {
        const absPath = subtitleSpec.source.path;
        const ext = path.extname(absPath).toLowerCase();
        if (ext === '.lrc') {
          const raw = readFileSync(absPath, 'utf-8');
          subtitleFilePath = writeSubtitlesFile(lrcToSrt(raw));
          subtitleFileIsTemporary = true;
        } else {
          subtitleFilePath = absPath;
        }
      } else {
        subtitleFilePath = writeSubtitlesFile(
          normalizeInlineSubtitlesToSrt(subtitleSpec.source.text),
        );
        subtitleFileIsTemporary = true;
      }
    }
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

    let maxProgressReported = -1;
    const reportProgress = (progress: number) => {
      if (!onProgress) {
        return;
      }
      const normalized = +Math.min(100, Math.max(0, progress)).toFixed(2);
      if (normalized <= maxProgressReported) {
        return;
      }
      maxProgressReported = normalized;
      onProgress(normalized);
    };
    reportProgress(0);

    const preprocessed = await preProcessAudio(
      audioBuffer,
      sampleRate,
      FPS,
      framesCount,
      (progress: number) => {
        reportProgress(progress);
      },
    );
    reportProgress(PRE_PROCESS_PROGRESS_SHARE);

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
      reportProgress(PRE_PROCESS_PROGRESS_SHARE + 1);
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
      reportProgress(PRE_PROCESS_PROGRESS_SHARE + POST_AUDIO_PROGRESS_SHARE);
    } else {
      reportProgress(PRE_PROCESS_PROGRESS_SHARE + POST_AUDIO_PROGRESS_SHARE);
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
      audioSegment: import('./highlight').HighlightAudioSegment | undefined;
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
            audioSegment: run.audioSegment,
          };
        })
      : [
          {
            outPath: outVideoPath,
            spectrums: spectrumsForRender,
            beatIndices: beatIndicesForRender,
            frameCount: framesCountForRender,
            audioSegment:
              autoHighlight &&
              highlightSlice &&
              highlightSlice.audioSegments.length > 0
                ? highlightSlice.audioSegments[0]
                : undefined,
          },
        ];

    const totalPassFrames =
      passes.reduce((sum, pass) => sum + pass.frameCount, 0);
    const totalRenderMilestones = totalPassFrames + (passes.length * 2);
    let renderMilestonesCompleted = 0;
    const reportRenderProgress = (milestoneIncrement = 1) => {
      renderMilestonesCompleted += milestoneIncrement;
      reportProgress(
        PRE_PROCESS_PROGRESS_SHARE
          + POST_AUDIO_PROGRESS_SHARE
          + (RENDER_PROGRESS_SHARE * renderMilestonesCompleted / Math.max(1, totalRenderMilestones)),
      );
    };
    let lastExitCode = 0;
    let renderAbortReason: string | undefined;
    const outputVideoFiles: string[] = [];
    try {
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
        reportRenderProgress();

        const createVisualizerFrame = createVisualizerFrameGenerator(
          config, backgroundWidth, backgroundHeight, defaultColor, spectrumBusMargin
        );

        const ffmpegVideoWriter = spawnFfmpegVideoWriter({
          audioFilename: audioFilePath,
          videoFileName: pass.outPath,
          ...(subtitleFilePath && {
            subtitleFilename: subtitleFilePath,
            subtitleAlignmentAss,
          }),
          fps: FPS,
          ...(pass.audioSegment && { audioSegment: pass.audioSegment }),
          ...(ffmpeg_cfr && { crf: ffmpeg_cfr }),
          ...(ffmpeg_preset && { preset: ffmpeg_preset }),
        });
        const exitPromise = waitForProcessExit(ffmpegVideoWriter);

        let stoppedEarly = false;
        let consecutiveVideoFrameReadFailures = 0;
        for (let i = 0; i < pass.frameCount; i++) {
          const spectrum = pass.spectrums[i];
          const { frameBuffer: backgroundImageBuffer, frameReadFailed } = await resolveBackgroundFrameBuffer({
            frameIndex: i,
            useVideoBackground,
            videoFrameReader,
            videoFrameSize,
            encodeVideoFrame,
            staticBackgroundBuffer,
          });
          if (frameReadFailed) {
            consecutiveVideoFrameReadFailures += 1;
            if (consecutiveVideoFrameReadFailures >= MAX_CONSECUTIVE_VIDEO_FRAME_READ_FAILURES) {
              renderAbortReason = [
                'Background video frame reads failed repeatedly.',
                `Failed ${consecutiveVideoFrameReadFailures} times in a row`,
                `while rendering pass output "${pass.outPath}".`,
              ].join(' ');
              stoppedEarly = true;
              break;
            }
          } else {
            consecutiveVideoFrameReadFailures = 0;
          }

          const commonVisualizerFrameProps: CommonVisualizerFrameProps = {
            backgroundImageBuffer,
            spectrum,
          };
          const frameImage = createVisualizerFrame(commonVisualizerFrameProps);
          const isFrameProcessed = ffmpegVideoWriter.stdin.write(frameImage.data);
          if (!isFrameProcessed) {
            const isDrained = await waitDrain(ffmpegVideoWriter.stdin, ffmpegVideoWriter);
            if (!isDrained) {
              stoppedEarly = true;
              break;
            }
          }
          if (shouldStop && shouldStop()) {
            stoppedEarly = true;
            break;
          }
          if (frame_processing_delay) {
            await sleep(frame_processing_delay);
          }
          await waitForEventLoop();
          reportRenderProgress();
        }

        if (videoFrameReader) {
          videoFrameReader.kill();
        }
        if (concatFilePath) {
          cleanupConcatFile(concatFilePath);
        }
        ffmpegVideoWriter.stdin.end();

        lastExitCode = await exitPromise;
        if (lastExitCode === 0 && !stoppedEarly) {
          reportRenderProgress();
        }

        if (lastExitCode === 0 && !stoppedEarly) {
          outputVideoFiles.push(pass.outPath);
        }

        if (stoppedEarly || lastExitCode !== 0) {
          if (renderAbortReason && lastExitCode === 0) {
            lastExitCode = 1;
          }
          break passLoop;
        }
      }

      if (lastExitCode === 0 && outputVideoFiles.length === passes.length) {
        reportProgress(100);
      }
      if (renderAbortReason) {
        console.error(renderAbortReason);
      }

      resolve({ exitCode: lastExitCode, outputVideoFiles });
    } finally {
      if (subtitleFilePath && subtitleFileIsTemporary) {
        cleanupTempFile(subtitleFilePath);
      }
    }
  });
