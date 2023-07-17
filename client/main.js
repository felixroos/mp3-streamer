import { MPEGDecoder } from "mpg123-decoder";

const decoder = new MPEGDecoder();
const ac = new AudioContext();
const audioUrl = "/.netlify/functions/stream";

async function fetchAudioBuffer(url, startRange, endRange) {
  try {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${startRange}-${endRange}`,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Error fetching audio: ${response.status}, ${response.statusText}`
      );
    }
    const contentRangeHeader = response.headers.get("Content-Range");
    const contentLengthHeader = response.headers.get("Content-Length");
    const bytes = contentRangeHeader.split("/")[1];
    console.log(
      "Content-Range",
      contentRangeHeader,
      "Content-Length",
      contentLengthHeader
    );
    if (!contentRangeHeader || !contentLengthHeader) {
      throw new Error("Server did not provide range support.");
    }
    const arrayBuffer = await response.arrayBuffer();
    return { arrayBuffer, bytes };
  } catch (error) {
    console.log("error fetching audio:", error);
  }
}

const playBuffer = (
  buffer,
  g = 1,
  time = ac.currentTime,
  destination = ac.destination
) => {
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.value = g;
  src.connect(gain);
  gain.connect(destination);
  src.start(time);
};

async function arrayBufferToAudioBuffer(arrayBuffer) {
  // the buffer is always the same length...
  const mpegData = new Uint8Array(arrayBuffer);
  const res = await decoder.decode(mpegData);

  console.log(`decoded`, res);
  if (res.errors.length) {
    console.error("decode error", res.errors);
  }
  const { channelData, samplesDecoded, sampleRate } = res;
  const audioBuffer = ac.createBuffer(
    channelData.length,
    samplesDecoded,
    sampleRate
  );
  channelData.forEach((channel, idx) =>
    audioBuffer.getChannelData(idx).set(channel)
  );

  return { audioBuffer, samplesDecoded, sampleRate };
}

async function run() {
  await decoder.ready;

  document.addEventListener("click", async () => {
    const bitRate = 320000;
    let start = 0,
      max = 1765876,
      step = bitRate / 8; // 1s per chunk

    // bit rate: 320000 bits per second
    // samplerate: 44100 samples per second

    let decodedSample = 0;
    let delay = 1;
    let startSampleOffset = 0;
    const scalingFactor = 100;

    while (start < max) {
      let end = Math.min(max, start + step);
      //console.log(`chunk ${start} - ${end}`);
      let { arrayBuffer } = await fetchAudioBuffer(audioUrl, start, end - 1);
      const { samplesDecoded, sampleRate, audioBuffer } =
        await arrayBufferToAudioBuffer(arrayBuffer);

      // inspired by https://github.com/eshaz/icecast-metadata-js/blob/7c234e44f9a361b92c83203b9e03b4177ecf7a21/src/icecast-metadata-player/src/players/WebAudioPlayer.js#L286-L303
      const startSamples = decodedSample * scalingFactor + startSampleOffset;
      const audioContextSamples = Math.round(
        ac.currentTime * sampleRate * scalingFactor
      );
      if (startSamples < audioContextSamples) {
        startSampleOffset += audioContextSamples - startSamples;
      }
      const time = startSamples / sampleRate / scalingFactor + delay;
      // END NEW

      playBuffer(audioBuffer, 1, time);
      decodedSample += samplesDecoded;

      start = end;
    }
  });

  await decoder.reset();
}

run();

/*

An MP3 file is composed of a series of frames. Each frame contains 1152 samples. 
Typically, the sample rate is 44.1kHz or 48kHz, making a frame last around 1/40th of a second.

numbers.mp3:

Data format:     2 ch,  44100 Hz, .mp3 (0x00000000) 0 bits/channel, 0 bytes/packet, 1152 frames/packet, 0 bytes/frame
                no channel layout.
estimated duration: 39.993425 sec
audio bytes: 1599737
audio packets: 1531
bit rate: 320000 bits per second
packet size upper bound: 1052
maximum packet size: 1045
audio data file offset: 0
optimized

44100Hz = 44100 samples per second

1 sample = 16bit
1 frame = 1152 samples
1 frame = 16*1152bit = 18432bit

*/
