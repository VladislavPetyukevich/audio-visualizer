import { Readable, Writable } from 'stream';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { resolve as resolvePath, join as joinPath } from 'path';
import { tmpdir } from 'os';
import ffmpegPath from 'ffmpeg-static';
import { defaults } from './config';
import { TempoEstimate } from './beats';

export interface AudioMuxSegment {
  seekSeconds: number;
  durationSeconds: number;
}

interface FfmpegVideoWriterConfig {
  audioFilename: string;
  subtitleFilename?: string;
  /** ASS `Alignment` in FFmpeg `subtitles` `force_style` (e.g. 2 bottom, 5 middle, 8 top). Default 2. */
  subtitleAlignmentAss?: number;
  videoFileName: string;
  fps: number;
  crf?: string;
  preset?: string;
  onStderr?: (data: any) => any;
  /** When set with `audioDurationSeconds`, passed to ffmpeg before `-i` for muxed highlight. */
  audioSeekSeconds?: number;
  audioDurationSeconds?: number;
  /** One contiguous trim of the same audio file (muxed highlight). */
  audioSegment?: AudioMuxSegment;
}

const escapeSubtitleFilterPath = (subtitlePath: string) =>
  subtitlePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

export const spawnFfmpegVideoWriter = (config: FfmpegVideoWriterConfig) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg path not found');
  }
  const crf = config.crf || '23';
  const preset = config.preset || 'medium';
  const args: string[] = ['-y'];
  const seek =
    config.audioSegment?.seekSeconds ?? config.audioSeekSeconds;
  const duration =
    config.audioSegment?.durationSeconds ?? config.audioDurationSeconds;
  if (seek !== undefined && duration !== undefined) {
    args.push('-ss', String(seek), '-t', String(duration));
  }
  args.push(
    '-i', config.audioFilename,
    '-f', 'image2pipe',
    '-vcodec', 'bmp',
    '-framerate', `${config.fps}`,
    '-i', '-',
    '-crf', crf,
    '-c:a', 'aac', '-b:a', '384k', '-profile:a', 'aac_low',
    '-c:v', 'libx264',
    '-r', `${config.fps}`,
    '-pix_fmt', 'yuv420p',
    '-preset', preset,
    '-shortest',
  );
  if (config.subtitleFilename) {
    const subPath = escapeSubtitleFilterPath(config.subtitleFilename);
    const alignment = config.subtitleAlignmentAss ?? 2;
    args.push(
      '-vf',
      `subtitles='${subPath}':force_style='Alignment=${alignment}'`,
    );
  }
  args.push(config.videoFileName);
  const ffmpeg = spawn(ffmpegPath, args);
  if (config.onStderr) {
    ffmpeg.stderr.on('data', config.onStderr);
  }
  return ffmpeg;
};

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

export interface SceneChange {
  frameNumber: number;
  pts: number;
  ptsTime: number;
}

export const detectSceneChanges = (videoPath: string, threshold = 0.4): Promise<SceneChange[]> =>
  new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg path not found'));
      return;
    }
    const ffmpeg = spawn(ffmpegPath, [
      '-i', videoPath,
      '-filter:v', `select='gt(scene,${threshold})',showinfo`,
      '-f', 'null',
      '-'
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    ffmpeg.on('close', () => {
      const sceneChanges: SceneChange[] = [];
      for (const line of stderr.split('\n')) {
        if (!line.includes('Parsed_showinfo')) continue;
        const nMatch = line.match(/n:\s*(\d+)/);
        const ptsMatch = line.match(/pts:\s*(\d+)/);
        const ptsTimeMatch = line.match(/pts_time:\s*([\d.]+)/);
        if (nMatch && ptsTimeMatch) {
          sceneChanges.push({
            frameNumber: parseInt(nMatch[1]),
            pts: ptsMatch ? parseInt(ptsMatch[1]) : 0,
            ptsTime: parseFloat(ptsTimeMatch[1]),
          });
        }
      }
      resolve(sceneChanges);
    });
    ffmpeg.on('error', reject);
  });

export const getVideoInfo = (videoPath: string): Promise<VideoInfo> =>
  new Promise((resolvePromise, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg path not found'));
      return;
    }
    const ffmpeg = spawn(ffmpegPath, ['-i', videoPath, '-hide_banner']);
    let stderr = '';
    ffmpeg.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    ffmpeg.on('close', () => {
      const dimMatch = stderr.match(/Stream.*Video:.*?(\d{2,5})x(\d{2,5})/);
      if (!dimMatch) {
        reject(new Error(`Could not determine video dimensions for: ${videoPath}`));
        return;
      }
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      const duration = durMatch
        ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3])
        : 0;
      resolvePromise({
        width: parseInt(dimMatch[1]),
        height: parseInt(dimMatch[2]),
        duration,
      });
    });
  });

const isOrientationMismatch = (sw: number, sh: number, tw: number, th: number): boolean =>
  (sw > sh && tw < th) || (sw < sh && tw > th);

export const buildVideoFilter = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): string => {
  if (!isOrientationMismatch(sourceWidth, sourceHeight, targetWidth, targetHeight)) {
    return `scale=${targetWidth}:${targetHeight}`;
  }

  const targetAspect = targetWidth / targetHeight;
  const makeEven = (n: number) => Math.floor(n / 2) * 2;
  let cropW: number, cropH: number, cropX: number, cropY: number;

  if (sourceWidth / sourceHeight > targetAspect) {
    cropW = makeEven(Math.round(sourceHeight * targetAspect));
    cropH = makeEven(sourceHeight);
    cropX = Math.floor((sourceWidth - cropW) / 2);
    cropY = Math.floor((sourceHeight - cropH) / 2);
  } else {
    cropW = makeEven(sourceWidth);
    cropH = makeEven(Math.round(sourceWidth / targetAspect));
    cropX = Math.floor((sourceWidth - cropW) / 2);
    cropY = Math.floor((sourceHeight - cropH) / 2);
  }

  return `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${targetWidth}:${targetHeight}`;
};

export const spawnVideoFrameReader = (config: {
  videoPath: string;
  fps: number;
  totalFrames: number;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg path not found');
  }
  const args = [
    '-stream_loop', '-1',
    '-i', config.videoPath,
    '-r', `${config.fps}`,
    '-frames:v', `${config.totalFrames}`,
  ];
  if (config.width && config.height) {
    const filter = config.sourceWidth && config.sourceHeight
      ? buildVideoFilter(config.sourceWidth, config.sourceHeight, config.width, config.height)
      : `scale=${config.width}:${config.height}`;
    args.push('-vf', filter);
  }
  args.push(
    '-f', 'rawvideo',
    '-pix_fmt', 'bgr24',
    '-v', 'quiet',
    'pipe:1'
  );
  return spawn(ffmpegPath, args);
};

export const readVideoFrame = (
  stream: Readable,
  frameSize: number,
  timeoutMs = defaults.timeouts.readVideoFrame,
): Promise<Buffer | null> =>
  new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      stream.removeListener('readable', onReadable);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onErrorOrClose);
      stream.removeListener('close', onErrorOrClose);
    };
    const onReadable = () => {
      tryRead();
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onErrorOrClose = () => {
      cleanup();
      resolve(null);
    };
    const tryRead = () => {
      const data = stream.read(frameSize) as Buffer | null;
      if (data !== null) {
        cleanup();
        resolve(data.length === frameSize ? data : null);
        return;
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          console.error('readVideoFrame timeout:', timeoutMs);
          cleanup();
          resolve(null);
        }, timeoutMs);
      }
      stream.once('readable', onReadable);
      stream.once('end', onEnd);
      stream.once('error', onErrorOrClose);
      stream.once('close', onErrorOrClose);
    };
    tryRead();
  });

export const getProgress = (onProgress: (currentFrame: number) => any) =>
  (stderrOutput: Buffer) => {
    const matchResult = stderrOutput.toString().match(/frame=[ ]+(\d+)/);
    if (!matchResult) {
      return;
    }
    const currentFrame = +matchResult[1];
    if (isNaN(currentFrame)) {
      return;
    }
    onProgress(currentFrame);
  };

export const calculateProgress = (framesCount: number, callback: (progress: number) => any) =>
  (currentFrame: number) =>
    callback(
      +(currentFrame / framesCount * 100).toFixed(2)
    );

export const waitDrain = (
  stream: Writable,
  processStream?: {
    once: (eventName: string, listener: (...args: any[]) => void) => any;
    removeListener: (eventName: string, listener: (...args: any[]) => void) => any;
  },
  timeoutMs = defaults.timeouts.waitDrain,
) =>
  new Promise<boolean>(resolve => {
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      stream.removeListener('drain', onDrain);
      stream.removeListener('error', onErrorOrClose);
      stream.removeListener('close', onErrorOrClose);
      processStream?.removeListener('error', onErrorOrClose);
      processStream?.removeListener('exit', onErrorOrClose);
      processStream?.removeListener('close', onErrorOrClose);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onErrorOrClose = () => {
      cleanup();
      resolve(false);
    };
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        console.error('waitDrain timeout:', timeoutMs);
        cleanup();
        resolve(false);
      }, timeoutMs);
    }
    stream.once('drain', onDrain);
    stream.once('error', onErrorOrClose);
    stream.once('close', onErrorOrClose);
    processStream?.once('error', onErrorOrClose);
    processStream?.once('exit', onErrorOrClose);
    processStream?.once('close', onErrorOrClose);
  });

export interface ProcessExitResult {
  exitCode: number;
  reason?: string;
}

const resolveProcessExit = (
  resolve: (result: ProcessExitResult) => void,
  exitCode: number,
  reason?: string,
) => {
  resolve({ exitCode, ...(reason && { reason }) });
};

export const waitForProcessExit = (
  processStream: {
    once: (eventName: string, listener: (...args: any[]) => void) => any;
    removeListener: (eventName: string, listener: (...args: any[]) => void) => any;
  },
  timeoutMs = defaults.timeouts.waitForProcessExit,
) =>
  new Promise<ProcessExitResult>(resolve => {
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      processStream.removeListener('exit', onExit);
      processStream.removeListener('close', onClose);
      processStream.removeListener('error', onError);
    };
    const onExit = (code: number | null) => {
      cleanup();
      const exitCode = code ?? 0;
      resolveProcessExit(
        resolve,
        exitCode,
        exitCode !== 0 ? `ffmpeg exited with code ${exitCode}` : undefined,
      );
    };
    const onClose = (code: number | null) => {
      cleanup();
      const exitCode = code ?? 0;
      resolveProcessExit(
        resolve,
        exitCode,
        exitCode !== 0 ? `ffmpeg exited with code ${exitCode}` : undefined,
      );
    };
    const onError = () => {
      cleanup();
      resolveProcessExit(resolve, 1, 'ffmpeg process error');
    };
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        console.error('waitForProcessExit timeout:', timeoutMs);
        cleanup();
        resolveProcessExit(resolve, 1, `waitForProcessExit timeout (${timeoutMs}ms)`);
      }, timeoutMs);
    }

    processStream.once('exit', onExit);
    processStream.once('close', onClose);
    processStream.once('error', onError);
  });

export interface VideoSegment {
  outputStartFrame: number;
  videoSeekSeconds: number;
  frameCount: number;
}

const mergeSmallScenes = (sceneChanges: SceneChange[], videoDuration: number, minDuration = 2): SceneChange[] => {
  if (sceneChanges.length === 0) return [];
  const merged: SceneChange[] = [sceneChanges[0]];
  for (let i = 1; i < sceneChanges.length; i++) {
    const lastKept = merged[merged.length - 1];
    const gap = sceneChanges[i].ptsTime - lastKept.ptsTime;
    if (gap >= minDuration) {
      merged.push(sceneChanges[i]);
    }
  }
  const lastScene = merged[merged.length - 1];
  if (videoDuration - lastScene.ptsTime < minDuration && merged.length > 1) {
    merged.pop();
  }
  return merged;
};

/** Minimum time between auto-edit cuts; cuts still land on beats. */
export const DEFAULT_AUTO_EDIT_MIN_CUT_INTERVAL_SECONDS = 2;
/** Window after the minimum gap in which the strongest beat is chosen. */
export const DEFAULT_AUTO_EDIT_MAX_CUT_INTERVAL_SECONDS = 4;
/** Half a bar of 4/4, used as the minimum gap when tempo is known. */
export const AUTO_EDIT_MIN_CUT_BEATS = 2;
/** One bar of 4/4, used as the maximum gap when tempo is known. */
export const AUTO_EDIT_MAX_CUT_BEATS = 4;
/** Snap an onset to the tempo grid when it is within this fraction of a beat. */
export const BEAT_SNAP_TOLERANCE = 0.25;

export const cutIntervalSecondsFromTempo = (bpm: number) => ({
  minCutIntervalSeconds: AUTO_EDIT_MIN_CUT_BEATS * (60 / bpm),
  maxCutIntervalSeconds: AUTO_EDIT_MAX_CUT_BEATS * (60 / bpm),
});

export const snapBeatsToTempoGrid = (
  beats: Array<{ frameIndex: number; intensity?: number }>,
  tempo: Pick<TempoEstimate, 'periodFrames' | 'phaseFrame'>,
  totalFrames: number,
): Array<{ frameIndex: number; intensity?: number }> => {
  const period = tempo.periodFrames;
  if (!(period > 0)) {
    return beats.slice();
  }
  const maxSnap = Math.max(1, period * BEAT_SNAP_TOLERANCE);
  const merged: Array<{ frameIndex: number; intensity?: number }> = [];
  const push = (beat: { frameIndex: number; intensity?: number }) => {
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].frameIndex === beat.frameIndex) {
        if ((beat.intensity ?? 0) > (merged[i].intensity ?? 0)) {
          merged[i] = beat;
        }
        return;
      }
    }
    merged.push(beat);
  };
  for (const beat of beats) {
    const n = Math.round((beat.frameIndex - tempo.phaseFrame) / period);
    const grid = Math.round(tempo.phaseFrame + n * period);
    const dist = Math.abs(beat.frameIndex - grid);
    if (dist <= maxSnap && grid > 0 && grid < totalFrames) {
      push({ frameIndex: grid, intensity: beat.intensity });
    } else {
      push(beat);
    }
  }
  return merged.sort((a, b) => a.frameIndex - b.frameIndex);
};

export const selectAutoEditCutFrames = (
  beats: Array<{ frameIndex: number; intensity?: number }>,
  fps: number,
  totalFrames: number,
  minIntervalSeconds = DEFAULT_AUTO_EDIT_MIN_CUT_INTERVAL_SECONDS,
  maxIntervalSeconds = DEFAULT_AUTO_EDIT_MAX_CUT_INTERVAL_SECONDS,
): number[] => {
  const sorted = beats
    .filter(beat => beat.frameIndex > 0 && beat.frameIndex < totalFrames)
    .sort((a, b) => a.frameIndex - b.frameIndex);
  if (sorted.length === 0 || fps <= 0) {
    return [];
  }
  if (minIntervalSeconds <= 0) {
    return sorted.map(beat => beat.frameIndex);
  }

  const minGap = Math.max(1, Math.round(fps * minIntervalSeconds));
  const maxGap = Math.max(minGap, Math.round(fps * maxIntervalSeconds));
  const selected: number[] = [];
  let lastCut = 0;

  while (lastCut + minGap < totalFrames) {
    const windowStart = lastCut + minGap;
    const windowEnd = Math.min(lastCut + maxGap, totalFrames);

    let best: { frameIndex: number; intensity?: number } | undefined;
    let nextAfterWindow: { frameIndex: number; intensity?: number } | undefined;

    for (const beat of sorted) {
      if (beat.frameIndex < windowStart) {
        continue;
      }
      if (beat.frameIndex >= windowEnd) {
        nextAfterWindow = beat;
        break;
      }
      const intensity = beat.intensity ?? 0;
      if (!best || intensity > (best.intensity ?? 0)) {
        best = beat;
      }
    }

    const chosen = best ?? nextAfterWindow;
    if (!chosen) {
      break;
    }
    selected.push(chosen.frameIndex);
    lastCut = chosen.frameIndex;
  }

  return selected;
};

export const buildBeatSyncedSegments = (
  beatFrameIndices: number[],
  totalFrames: number,
  sceneChanges: SceneChange[],
  videoDuration: number,
  fps: number,
  options?: {
    beatIntensities?: number[];
    minCutIntervalSeconds?: number;
    maxCutIntervalSeconds?: number;
    tempo?: TempoEstimate;
  },
): VideoSegment[] => {
  if (sceneChanges.length === 0) {
    return [
      {
        outputStartFrame: 0,
        videoSeekSeconds: 0,
        frameCount: totalFrames,
      },
    ];
  }

  const consolidated = mergeSmallScenes(sceneChanges, videoDuration);
  let seekPositions: number[];
  if (consolidated.length >= 2) {
    seekPositions = consolidated.map(sc => sc.ptsTime);
  } else {
    const count = Math.max(10, Math.ceil(videoDuration / 3));
    seekPositions = Array.from({ length: count }, (_, i) => (i * videoDuration) / count);
  }

  const tempo = options?.tempo;
  const tempoIntervals = tempo && tempo.bpm > 0
    ? cutIntervalSecondsFromTempo(tempo.bpm)
    : undefined;
  let beats: Array<{ frameIndex: number; intensity?: number }> = beatFrameIndices.map((frameIndex, i) => ({
    frameIndex,
    intensity: options?.beatIntensities?.[i],
  }));
  if (tempo) {
    beats = snapBeatsToTempoGrid(beats, tempo, totalFrames);
  }

  const cutBeats = selectAutoEditCutFrames(
    beats,
    fps,
    totalFrames,
    options?.minCutIntervalSeconds ?? tempoIntervals?.minCutIntervalSeconds,
    options?.maxCutIntervalSeconds ?? tempoIntervals?.maxCutIntervalSeconds,
  );

  const boundaries = [0, ...cutBeats];
  if (boundaries[boundaries.length - 1] !== totalFrames) {
    boundaries.push(totalFrames);
  }
  const unique = Array.from(new Set(boundaries)).sort((a, b) => a - b);

  const segments: VideoSegment[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    segments.push({
      outputStartFrame: unique[i],
      videoSeekSeconds: seekPositions[i % seekPositions.length],
      frameCount: unique[i + 1] - unique[i],
    });
  }
  return segments;
};

export const getCutFrameIndices = (segments: VideoSegment[]): number[] =>
  segments
    .slice(1)
    .map(segment => segment.outputStartFrame)
    .filter(frameIndex => frameIndex > 0);

export const writeConcatFile = (
  segments: VideoSegment[],
  videoPath: string,
  videoDuration: number,
  fps: number,
): string => {
  const absVideoPath = resolvePath(videoPath).replace(/\\/g, '/');
  const escaped = absVideoPath.replace(/'/g, "'\\''");
  let content = '';

  for (const seg of segments) {
    const segDuration = seg.frameCount / fps;
    let remaining = segDuration;
    let pos = seg.videoSeekSeconds % videoDuration;

    while (remaining > 0.001) {
      const available = videoDuration - pos;
      const take = Math.min(remaining, available);
      content += `file '${escaped}'\n`;
      content += `inpoint ${pos.toFixed(6)}\n`;
      content += `outpoint ${(pos + take).toFixed(6)}\n\n`;
      remaining -= take;
      pos = 0;
    }
  }

  const concatPath = joinPath(tmpdir(), `av-concat-${Date.now()}.txt`);
  writeFileSync(concatPath, content, 'utf-8');
  return concatPath;
};

export const writeSubtitlesFile = (subtitles: string): string => {
  const subtitlePath = joinPath(tmpdir(), `av-subtitles-${Date.now()}.srt`);
  writeFileSync(subtitlePath, subtitles, 'utf-8');
  return subtitlePath;
};

export const spawnConcatVideoFrameReader = (config: {
  concatFilePath: string;
  fps: number;
  totalFrames: number;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg path not found');
  }
  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', config.concatFilePath,
    '-r', `${config.fps}`,
    '-frames:v', `${config.totalFrames}`,
  ];
  if (config.width && config.height) {
    const filter = config.sourceWidth && config.sourceHeight
      ? buildVideoFilter(config.sourceWidth, config.sourceHeight, config.width, config.height)
      : `scale=${config.width}:${config.height}`;
    args.push('-vf', filter);
  }
  args.push(
    '-f', 'rawvideo',
    '-pix_fmt', 'bgr24',
    '-v', 'quiet',
    'pipe:1'
  );
  return spawn(ffmpegPath, args);
};

export const cleanupTempFile = (filePath: string) => {
  try { unlinkSync(filePath); } catch {}
};

export const cleanupConcatFile = cleanupTempFile;
