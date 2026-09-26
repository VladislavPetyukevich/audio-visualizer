import path from 'path';
import { readFileSync } from 'fs';
import {
  getAudioFilePath,
  getBackgroundImagePath,
  getBackgroundVideoPaths,
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
  getVideoTimeouts,
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
  getCameraShakeEnabled,
  getAudioAutoHighlight,
  getAudioAutoHighlightCount,
} from './config';
import { createAudioBuffer, bufferToUInt8, createSpectrumsProcessor, pcmU8ToFloatSamples } from './audio';
import { parseImage, getImageColor, getVideoFrameColor, invertColor, Color, convertToBmp, createSpectrumVisualizerFrameGenerator, createPolarVisualizerFrameGenerator, CreatePolarVisualizerFrameProps, CreateVisualizerFrameProps, CommonVisualizerFrameProps, applyCameraShake, getCutShakeOffset, buildCutShakeAmplitudes, CAMERA_SHAKE_DELAY_SECONDS, CAMERA_SHAKE_EVERY_BEATS } from './image';
import { normalizeInlineSubtitlesToSrt, lrcToSrt } from './subtitleConvert';
import { spawnFfmpegVideoWriter, waitDrain, waitForProcessExit, getVideoInfo, spawnVideoFrameReader, readVideoFrame, detectSceneChanges, buildBeatSyncedSegments, buildSequentialVideoSegments, buildShuffledVideoSegments, getCutFrameIndices, writeConcatFile, writeSubtitlesFile, spawnConcatVideoFrameReader, cleanupConcatFile, cleanupTempFile, VideoSegment } from './video';
import { createBpmEncoder, createBgrFrameEncoder, EncodedBmp } from './bpmEncoder';
import { createBeatDetector, estimateTempo, TempoEstimate, beatGridFrameIndices, tempoForWindow, MAX_TEMPO_ANALYSIS_SECONDS } from './beats';
export { BeatInfo, BeatDetectorOptions, TempoEstimate, estimateTempo, beatGridFrameIndices, shiftTempoPhase, tempoForWindow } from './beats';
import { computeHighlightSlice, HIGHLIGHT_DURATION_SEC } from './highlight';
import { waitForEventLoop } from './waitForEventLoop';
export { computeHighlightSlice, HIGHLIGHT_DURATION_SEC, MAX_BEAT_SNAP_SEC, BeatFrameEvent, HighlightAudioSegment, HighlightRun, HighlightBeatGrid } from './highlight';

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
    /** When `autoHighlight` is true, number of non-overlapping ~15s beat-aligned windows to stitch (default 1). */
    autoHighlightCount?: number;
  };
  image?: {
    path: string;
  };
  video?: {
    /**
     * A single video path, or an array of video paths.
     * With an array: when `autoEdit` is false, the videos play one after another (looping the
     * sequence as needed); when `autoEdit` is true, cuts switch (shuffle) between the given
     * videos instead of auto-detecting scene changes within a single video.
     */
    path: string | string[];
    autoEdit?: boolean;
    /** When `autoEdit` is true, disables the brief camera shake applied on cuts, or every 2 beats when there are no cuts (default true). */
    cameraShake?: boolean;
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
    timeouts?: {
      readVideoFrame?: number;
      waitDrain?: number;
      waitForProcessExit?: number;
    };
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
  if (config.outVideo.spectrum) {
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
  }

  if (config.outVideo.polar) {
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

  return (params: CommonVisualizerFrameProps) => params.backgroundImageBuffer;
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
  backgroundVideoPaths: string[] | undefined;
  backgroundImagePath: string | undefined;
  beatFrameIndices: number[];
  beatIntensities?: number[];
  framesCount: number;
  outputResolution: ReturnType<typeof getOutputResolution>;
  fps: number;
  autoEditVideo: boolean;
  readVideoFrameTimeout: number;
  tempo?: TempoEstimate | null;
  /** First video to play for `video.path` arrays without `autoEdit`. */
  startVideoIndex?: number;
}): Promise<{
  backgroundWidth: number;
  backgroundHeight: number;
  defaultColor: Color;
  staticBackgroundBuffer: EncodedBmp;
  videoFrameReader?: ReturnType<typeof spawnVideoFrameReader>;
  videoFrameSize: number;
  encodeVideoFrame?: (bgrBuffer: Buffer) => EncodedBmp;
  concatFilePath?: string;
  cutFrameIndices: number[];
}> {
  const {
    useVideoBackground,
    backgroundVideoPaths,
    backgroundImagePath,
    beatFrameIndices,
    beatIntensities,
    framesCount,
    outputResolution,
    fps,
    autoEditVideo,
    readVideoFrameTimeout,
    tempo,
    startVideoIndex = 0,
  } = params;

  if (useVideoBackground && backgroundVideoPaths && backgroundVideoPaths.length > 0) {
    const videoInfos = await Promise.all(backgroundVideoPaths.map(videoPath => getVideoInfo(videoPath)));
    const primaryVideoInfo = videoInfos[0];
    const backgroundWidth = outputResolution?.width ?? primaryVideoInfo.width;
    const backgroundHeight = outputResolution?.height ?? primaryVideoInfo.height;

    const videoFrameSize = backgroundWidth * backgroundHeight * 3;
    const encodeVideoFrame = createBgrFrameEncoder({ width: backgroundWidth, height: backgroundHeight });

    let segments: VideoSegment[];
    if (backgroundVideoPaths.length > 1) {
      segments = autoEditVideo
        ? buildShuffledVideoSegments(
            beatFrameIndices,
            framesCount,
            backgroundVideoPaths.length,
            fps,
            {
              beatIntensities,
              ...(tempo ? { tempo } : {}),
            },
          )
        : buildSequentialVideoSegments(
            framesCount,
            videoInfos.map(info => info.duration),
            fps,
            startVideoIndex % backgroundVideoPaths.length,
          );
    } else {
      const sceneChanges = autoEditVideo
        ? await detectSceneChanges(backgroundVideoPaths[0])
        : [];
      segments = buildBeatSyncedSegments(
        beatFrameIndices,
        framesCount,
        sceneChanges,
        primaryVideoInfo.duration,
        fps,
        {
          beatIntensities,
          ...(autoEditVideo && tempo ? { tempo } : {}),
        },
      );
    }

    const videoSources = videoInfos.map((info, i) => ({ path: backgroundVideoPaths[i], duration: info.duration }));
    const concatFilePath = writeConcatFile(segments, videoSources, fps);
    const cutFrameIndices = autoEditVideo ? getCutFrameIndices(segments) : [];

    const videoFrameReader = spawnConcatVideoFrameReader({
      concatFilePath,
      fps,
      totalFrames: framesCount,
      ...(outputResolution && {
        width: backgroundWidth,
        height: backgroundHeight,
        sourceWidth: primaryVideoInfo.width,
        sourceHeight: primaryVideoInfo.height,
      }),
    });

    const firstFrame = await readVideoFrame(
      videoFrameReader.stdout,
      videoFrameSize,
      readVideoFrameTimeout,
    );
    if (!firstFrame) {
      throw new Error(`Could not read frames from video: ${backgroundVideoPaths.join(', ')}`);
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
      cutFrameIndices,
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
    cutFrameIndices: [],
  };
}

async function resolveBackgroundFrameBuffer(params: {
  frameIndex: number;
  useVideoBackground: boolean;
  videoFrameReader?: ReturnType<typeof spawnVideoFrameReader>;
  videoFrameSize: number;
  encodeVideoFrame?: (bgrBuffer: Buffer) => EncodedBmp;
  staticBackgroundBuffer: EncodedBmp;
  readVideoFrameTimeout: number;
}): Promise<{ frameBuffer: EncodedBmp; frameReadFailed: boolean }> {
  const {
    frameIndex,
    useVideoBackground,
    videoFrameReader,
    videoFrameSize,
    encodeVideoFrame,
    staticBackgroundBuffer,
    readVideoFrameTimeout,
  } = params;

  if (useVideoBackground && videoFrameReader && encodeVideoFrame) {
    if (frameIndex === 0) {
      return { frameBuffer: staticBackgroundBuffer, frameReadFailed: false };
    }
    const videoFrame = await readVideoFrame(
      videoFrameReader.stdout,
      videoFrameSize,
      readVideoFrameTimeout,
    );
    if (videoFrame) {
      return { frameBuffer: encodeVideoFrame(videoFrame), frameReadFailed: false };
    }
    return { frameBuffer: staticBackgroundBuffer, frameReadFailed: false };
  }
  return { frameBuffer: staticBackgroundBuffer, frameReadFailed: false };
}

export interface RenderAudioVisualizerResult {
  exitCode: number;
  /** Human-readable failure reason; omitted on full success (exitCode 0). */
  reason?: string;
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
    const backgroundVideoPaths = getBackgroundVideoPaths(config);
    const backgroundImagePath = getBackgroundImagePath(config);
    const useVideoBackground = !!backgroundVideoPaths && backgroundVideoPaths.length > 0;

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
    const videoTimeouts = getVideoTimeouts(config);

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
    const autoEditVideo = getAutoEditVideo(config);
    // Beat grid for video cuts (autoEdit) and for snapping highlight boundaries to beats.
    let trackTempo: TempoEstimate | null = null;
    if (autoEditVideo || autoHighlight) {
      const sampleRateNum = Number(sampleRate);
      const maxSamples = Math.floor(sampleRateNum * MAX_TEMPO_ANALYSIS_SECONDS);
      const tempoBuffer = audioBuffer.length > maxSamples
        ? audioBuffer.slice(0, maxSamples)
        : audioBuffer;
      trackTempo = estimateTempo(pcmU8ToFloatSamples(tempoBuffer), sampleRateNum, FPS);
    }
    let spectrumsForRender = preprocessed.spectrums;
    let beatIndicesForRender = preprocessed.beatFrameIndices;
    let beatIntensitiesForRender = preprocessed.beatEvents.map(event => event.intensity);
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
        trackTempo,
      );
      spectrumsForRender = highlightSlice.spectrums;
      beatIndicesForRender = highlightSlice.beatFrameIndices;
      beatIntensitiesForRender = highlightSlice.beatIntensities;
      framesCountForRender = highlightSlice.highlightFrames;
      reportProgress(PRE_PROCESS_PROGRESS_SHARE + POST_AUDIO_PROGRESS_SHARE);
    } else {
      reportProgress(PRE_PROCESS_PROGRESS_SHARE + POST_AUDIO_PROGRESS_SHARE);
    }

    const cameraShakeEnabled = getCameraShakeEnabled(config);
    const shakeDelayFrames = Math.round(FPS * CAMERA_SHAKE_DELAY_SECONDS);

    const separateHighlightFiles =
      autoHighlight &&
      highlightSlice &&
      highlightSlice.runs.length > 1;

    type VideoRenderPass = {
      outPath: string;
      spectrums: number[][];
      beatIndices: number[];
      beatIntensities: number[];
      frameCount: number;
      startFrame: number;
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
            beatIntensities: run.beatIntensities,
            frameCount: run.highlightFrames,
            startFrame: run.startFrame,
            audioSegment: run.audioSegment,
          };
        })
      : [
          {
            outPath: outVideoPath,
            spectrums: spectrumsForRender,
            beatIndices: beatIndicesForRender,
            beatIntensities: beatIntensitiesForRender,
            frameCount: framesCountForRender,
            startFrame: highlightSlice?.startFrame ?? 0,
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
    let exitReason: string | undefined;
    const outputVideoFiles: string[] = [];
    try {
      passLoop: for (let passIndex = 0; passIndex < passes.length; passIndex++) {
        const pass = passes[passIndex];
        const tempo = autoEditVideo && trackTempo
          ? tempoForWindow(trackTempo, pass.startFrame, FPS, pass.frameCount, pass.beatIndices)
          : null;
        const shakeAmplitudes = tempo
          ? buildCutShakeAmplitudes(tempo.periodFrames)
          : undefined;
        const {
          backgroundWidth,
          backgroundHeight,
          defaultColor,
          staticBackgroundBuffer,
          videoFrameReader,
          videoFrameSize,
          encodeVideoFrame,
          concatFilePath,
          cutFrameIndices,
        } = await prepareBackgroundForRender({
          useVideoBackground,
          backgroundVideoPaths,
          backgroundImagePath,
          beatFrameIndices: pass.beatIndices,
          beatIntensities: pass.beatIntensities,
          framesCount: pass.frameCount,
          outputResolution,
          fps: FPS,
          autoEditVideo,
          readVideoFrameTimeout: videoTimeouts.readVideoFrame,
          ...(tempo ? { tempo } : {}),
          // Each separate highlight output opens with a different video from the array.
          startVideoIndex: passIndex,
        });
        reportRenderProgress();

        const beatShakeFrames = () => (tempo
          ? beatGridFrameIndices(tempo, pass.frameCount, CAMERA_SHAKE_EVERY_BEATS)
          : pass.beatIndices.filter(frameIndex => frameIndex > 0).filter((_, i) => i % CAMERA_SHAKE_EVERY_BEATS === 0));
        const shakeFrames = new Set(
          autoEditVideo && cameraShakeEnabled
            ? (cutFrameIndices.length > 0 ? cutFrameIndices : beatShakeFrames())
            : [],
        );
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
        const exitPromise = waitForProcessExit(
          ffmpegVideoWriter,
          videoTimeouts.waitForProcessExit,
        );

        let stoppedEarly = false;
        for (let i = 0; i < pass.frameCount; i++) {
          const spectrum = pass.spectrums[i];
          const { frameBuffer: backgroundImageBuffer, frameReadFailed } = await resolveBackgroundFrameBuffer({
            frameIndex: i,
            useVideoBackground,
            videoFrameReader,
            videoFrameSize,
            encodeVideoFrame,
            staticBackgroundBuffer,
            readVideoFrameTimeout: videoTimeouts.readVideoFrame,
          });

          const commonVisualizerFrameProps: CommonVisualizerFrameProps = {
            backgroundImageBuffer,
            spectrum,
          };
          const frameImage = createVisualizerFrame(commonVisualizerFrameProps);
          const shakeOffset = getCutShakeOffset(i, shakeFrames, shakeAmplitudes, shakeDelayFrames);
          if (shakeOffset.x !== 0 || shakeOffset.y !== 0) {
            applyCameraShake(frameImage, backgroundWidth, backgroundHeight, shakeOffset.x, shakeOffset.y);
          }
          const isFrameProcessed = ffmpegVideoWriter.stdin.write(frameImage.data);
          if (!isFrameProcessed) {
            const isDrained = await waitDrain(
              ffmpegVideoWriter.stdin,
              ffmpegVideoWriter,
              videoTimeouts.waitDrain,
            );
            if (!isDrained) {
              stoppedEarly = true;
              exitReason = 'ffmpeg stdin drain failed';
              break;
            }
          }
          if (shouldStop && shouldStop()) {
            stoppedEarly = true;
            exitReason = 'render stopped by shouldStop callback';
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

        const { exitCode, reason: ffmpegExitReason } = await exitPromise;
        lastExitCode = exitCode;
        if (!exitReason && ffmpegExitReason) {
          exitReason = ffmpegExitReason;
        }
        if (lastExitCode === 0 && !stoppedEarly) {
          reportRenderProgress();
        }

        if (lastExitCode === 0 && !stoppedEarly) {
          outputVideoFiles.push(pass.outPath);
        }

        if (stoppedEarly || lastExitCode !== 0) {
          if (exitReason && lastExitCode === 0) {
            lastExitCode = 1;
          }
          break passLoop;
        }
      }

      if (lastExitCode === 0 && outputVideoFiles.length === passes.length) {
        reportProgress(100);
      }
      if (exitReason) {
        console.error(exitReason);
      }

      resolve({ exitCode: lastExitCode, reason: exitReason, outputVideoFiles });
    } finally {
      if (subtitleFilePath && subtitleFileIsTemporary) {
        cleanupTempFile(subtitleFilePath);
      }
    }
  });
