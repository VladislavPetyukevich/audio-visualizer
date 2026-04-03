import { Readable, Writable } from 'stream';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

interface FfmpegVideoWriterConfig {
  audioFilename: string;
  videoFileName: string;
  fps: number;
  crf?: string;
  preset?: string;
  onStderr?: (data: any) => any;
}

export const spawnFfmpegVideoWriter = (config: FfmpegVideoWriterConfig) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg path not found');
  }
  const crf = config.crf || '23';
  const preset = config.preset || 'medium';
  const args = [
    '-y',
    '-i', config.audioFilename,
    '-crf', crf,
    '-c:a', 'aac', '-b:a', '384k', '-profile:a', 'aac_low',
    '-c:v', 'libx264', '-r', `${config.fps}`, '-pix_fmt', 'yuv420p', '-preset', preset, config.videoFileName,
    '-r', `${config.fps}`,
    '-i', '-'
  ];
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
}

export const getVideoInfo = (videoPath: string): Promise<VideoInfo> =>
  new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg path not found'));
      return;
    }
    const ffmpeg = spawn(ffmpegPath, ['-i', videoPath, '-hide_banner']);
    let stderr = '';
    ffmpeg.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    ffmpeg.on('close', () => {
      const match = stderr.match(/Stream.*Video:.*?(\d{2,5})x(\d{2,5})/);
      if (!match) {
        reject(new Error(`Could not determine video dimensions for: ${videoPath}`));
        return;
      }
      resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
    });
  });

export const spawnVideoFrameReader = (config: {
  videoPath: string;
  fps: number;
  totalFrames: number;
}) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg path not found');
  }
  return spawn(ffmpegPath, [
    '-stream_loop', '-1',
    '-i', config.videoPath,
    '-r', `${config.fps}`,
    '-frames:v', `${config.totalFrames}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'bgr24',
    '-v', 'quiet',
    'pipe:1'
  ]);
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
