const config = require('./config');
const renderAudioVisualizer = require('../src');
const startTime = new Date();

const millisecondsToTime = (milliseconds) => {
  const seconds = Math.trunc((milliseconds / 1000) % 60);
  const minutes = Math.trunc((milliseconds / (1000 * 60)) % 60);
  const hours = Math.trunc((milliseconds / (1000 * 60 * 60)) % 24);

  const hoursFormated = (hours < 10) ? `0${hours}` : hours;
  const minutesFormated = (minutes < 10) ? `0${minutes}` : minutes;
  const secondsFormated = (seconds < 10) ? `0${seconds}` : seconds;

  return `${hoursFormated}:${minutesFormated}:${secondsFormated}`;
};

renderAudioVisualizer(config)
  .then((exitCode) => {
    console.log(`exited with code: ${exitCode}`);
    console.log(`rendered in: `, millisecondsToTime((new Date()) - startTime));
  });
