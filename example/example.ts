import config from './config';
import { renderAudioVisualizer } from '../src';
const startTime = new Date();

const millisecondsToTime = (milliseconds: number) => {
  const seconds = Math.trunc((milliseconds / 1000) % 60);
  const minutes = Math.trunc((milliseconds / (1000 * 60)) % 60);
  const hours = Math.trunc((milliseconds / (1000 * 60 * 60)) % 24);

  const hoursFormated = (hours < 10) ? `0${hours}` : hours;
  const minutesFormated = (minutes < 10) ? `0${minutes}` : minutes;
  const secondsFormated = (seconds < 10) ? `0${seconds}` : seconds;

  return `${hoursFormated}:${minutesFormated}:${secondsFormated}`;
};

renderAudioVisualizer(config)
  .then((exitCode: number) => {
    console.log(`exited with code: ${exitCode}`);
    console.log(`rendered in: `, millisecondsToTime(+new Date() - +startTime));
  });
