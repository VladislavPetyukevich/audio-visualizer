import { Readable, Writable } from 'stream';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { resolve as resolvePath, join as joinPath } from 'path';
import { tmpdir } from 'os';
import ffmpegPath from 'ffmpeg-static';

export interface AudioMuxSegment {
  seekSeconds: number;
  durationSeconds: number;
}

interface FfmpegVideoWriterConfig {
  audioFilename: string;
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
    '-crf', crf,
    '-c:a', 'aac', '-b:a', '384k', '-profile:a', 'aac_low',
    '-c:v', 'libx264', '-r', `${config.fps}`, '-pix_fmt', 'yuv420p', '-preset', preset, config.videoFileName,
    '-r', `${config.fps}`,
    '-i', '-'
  );
  const ffmpeg = spawn(ffmpegPath, args);
  ffmpeg.stdin.pipe(process.stdout);
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

export const readVideoFrame = (stream: Readable, frameSize: number): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const tryRead = () => {
      const data = stream.read(frameSize) as Buffer | null;
      if (data !== null) {
        resolve(data.length === frameSize ? data : null);
        return;
      }
      const onReadable = () => {
        cleanup();
        tryRead();
      };
      const onEnd = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        stream.removeListener('readable', onReadable);
        stream.removeListener('end', onEnd);
      };
      stream.once('readable', onReadable);
      stream.once('end', onEnd);
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

export const waitDrain = (stream: Writable) =>
  new Promise<void>(resolve => stream.once('drain', resolve));

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

export const buildBeatSyncedSegments = (
  beatFrameIndices: number[],
  totalFrames: number,
  sceneChanges: SceneChange[],
  videoDuration: number,
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

  const boundaries = [0, ...beatFrameIndices];
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

export const cleanupConcatFile = (filePath: string) => {
  try { unlinkSync(filePath); } catch {}
};
