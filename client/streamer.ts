import { MPEGDecoder } from "mpg123-decoder";

interface StreamerOptions {
  url: string;
  ac: AudioContext;
  decoder: MPEGDecoder;
  destination: GainNode;
}

export class Streamer {
  url: string;
  ac: AudioContext;
  decoder: MPEGDecoder;
  destination: GainNode;

  bitRate = 320000;
  start = 0;
  max = 1765876;
  step = this.bitRate / 8;
  decodedSample = 0;
  delay = 1;
  startSampleOffset = 0;
  scalingFactor = 100;

  constructor(options: StreamerOptions) {
    Object.assign(this, options);
  }
  async fetchAudioBuffer(startRange, endRange) {
    const response = await fetch(this.url, {
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
    if (!contentRangeHeader || !contentLengthHeader) {
      throw new Error("No Content-Range or Content-Length header reiceved!");
    }
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
    const buffer = new Uint8Array(arrayBuffer);
    return { buffer, bytes };
  }
  playBuffer(buffer, time = this.ac.currentTime) {
    const src = this.ac.createBufferSource();
    src.buffer = buffer;
    src.connect(this.destination);
    src.start(time);
  }

  async arrayBufferToAudioBuffer(buffer) {
    // the buffer is always the same length...
    const res = await this.decoder.decode(buffer);

    if (res.errors.length) {
      console.error("decode error", res.errors);
    }
    const { channelData, samplesDecoded, sampleRate } = res;
    const audioBuffer = this.ac.createBuffer(
      channelData.length,
      samplesDecoded,
      sampleRate
    );
    channelData.forEach((channel, idx) =>
      audioBuffer.getChannelData(idx).set(channel)
    );

    return { audioBuffer, samplesDecoded, sampleRate };
  }

  async processChunk() {
    let end = Math.min(this.max, this.start + this.step);
    //console.log(`chunk ${this.start} - ${end}`);

    let { buffer } = await this.fetchAudioBuffer(this.start, end - 1);

    const { samplesDecoded, sampleRate, audioBuffer } =
      await this.arrayBufferToAudioBuffer(buffer);

    // inspired by https://github.com/eshaz/icecast-metadata-js/blob/7c234e44f9a361b92c83203b9e03b4177ecf7a21/src/icecast-metadata-player/src/players/WebAudioPlayer.js#L286-L303
    const startSamples =
      this.decodedSample * this.scalingFactor + this.startSampleOffset;
    const audioContextSamples = Math.round(
      (this.ac.currentTime - this.delay) * sampleRate * this.scalingFactor
    );
    if (startSamples < audioContextSamples) {
      this.startSampleOffset += audioContextSamples - startSamples;
    }
    const time = startSamples / sampleRate / this.scalingFactor + this.delay;

    this.playBuffer(audioBuffer, time);
    this.decodedSample += samplesDecoded;

    this.start = end;
  }

  async play() {
    await this.ac.resume();

    while (this.start < this.max) {
      await this.processChunk();
    }
  }
  pause() {}
}
