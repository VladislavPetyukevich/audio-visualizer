import { spawn } from 'child_process';
import { path as ffmpegPath } from 'ffmpeg-static';

interface FfmpegVideoWriterConfig {
  audioFilename: string;
  videoFileName: string;
  fps: number;
  onStderr?: (data: any) => any;
}

export const spawnFfmpegVideoWriter = (config: FfmpegVideoWriterConfig) => {
  const args = [
    '-y',
    '-i', config.audioFilename,
    '-c:v', 'libx264', '-r', `${config.fps}`, '-pix_fmt', 'yuv420p', config.videoFileName,
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
