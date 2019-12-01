# Audio-visualizer
Audio visualizer generator for Node.js with simple configuration.  
Only WAV audio and PNG image format is supported now.

## Example
```javascript
const renderAudioVisualizer = require('audio-visualizer').renderAudioVisualizer;
const config = {
  image: {
    path: 'media/background.png'
  },
  audio: {
    path: 'media/audio.wav'
  },
  outVideo: {
    path: 'media/out.mp4',
    fps: 25, // Default value: 60
    spectrum: { // Audio spectrum configuration. Optional.
      frequencyBuses: [0, 100, 200, 500, 1000], // Default value: [0, 100, 200, 500, 1000, 1500, 2000, 3000, 5000, 10000]
      width: 300, // Default value: 30% of background image width
      height: 300, // Default value: 30% of background image height
      color: '#cccc99' // Default value: inverted color of background image
    }
  }
};

const onProgress = (progressPercent: number) => {
  console.log(`progress: ${progressPercent} %`);
};

renderAudioVisualizer(config, onProgress)
  .then((exitCode) => {
    console.log(`exited with code: ${exitCode}`);
  });
```

## Output preview
![frame of output video](example/media/out-sample.png)
