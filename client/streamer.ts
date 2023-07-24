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
  _playing = false;
  buffers: { audioBuffer: AudioBuffer; time: number; progress: number }[] = [];
  callbackNodes: any[] = [];
  currentSource = null;
  output;
  startedAt;
  pausedAt;

  constructor(options: StreamerOptions) {
    Object.assign(this, options);
  }

  async resetOutput() {
    if (this.output) {
      this.output.gain.value = 0;
    }
    this.output = this.ac.createGain();
    this.output.gain.value = 1;
    this.output.connect(this.destination);
    return this.output;
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
    src.connect(this.output);
    src.start(time);
    src.onended = () => {
      this.buffers.shift();
    };
    return src;
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

  samples2seconds(numberOfSamples, sampleRate) {
    return numberOfSamples / sampleRate / this.scalingFactor;
  }
  seconds2samples(seconds, sampleRate) {
    return Math.round(seconds * this.scalingFactor * sampleRate);
  }

  async processChunk() {
    let start = this.start; // start of chunk bytes (as fetched)
    let end = Math.min(this.max, this.start + this.step); // end of chunk

    let { buffer } = await this.fetchAudioBuffer(this.start, end - 1);

    const { samplesDecoded, sampleRate, audioBuffer } =
      await this.arrayBufferToAudioBuffer(buffer);

    // inspired by https://github.com/eshaz/icecast-metadata-js/blob/7c234e44f9a361b92c83203b9e03b4177ecf7a21/src/icecast-metadata-player/src/players/WebAudioPlayer.js#L286-L303
    const startSamples =
      this.decodedSample * this.scalingFactor + this.startSampleOffset;

    /* const audioContextSamples = this.seconds2samples(
      this.ac.currentTime - this.delay,
      sampleRate
    );

    if (startSamples < audioContextSamples) {
      this.startSampleOffset += audioContextSamples - startSamples;
    } */

    const time = this.samples2seconds(startSamples, sampleRate) + this.delay;

    this.buffers.push({ audioBuffer, time, progress: this.start / this.max });

    const play = () => this.playBuffer(audioBuffer, time);
    this.decodedSample += samplesDecoded;

    this.start = end;
    return { play, time, start, end };
  }

  set playing(value) {
    this._playing = value;
  }
  get playing() {
    return this._playing;
  }

  get currentBuffer() {
    return this.buffers[0];
  }

  get progress() {
    if (!this.currentBuffer) {
      return 0;
    }
    const { progress } = this.currentBuffer;
    return progress;
  }

  get bufferProgress() {
    if (!this.max || !this.start) {
      return 0;
    }
    return this.start / this.max;
  }

  async play() {
    let resumeTime;
    // check if player is resuming (has been paused before => pausedAt is set)
    if (this.pausedAt) {
      resumeTime = this.pausedAt - this.startedAt;
      console.log("resumeTime", resumeTime);
    }

    this.playing = false;
    await this.ac.resume();
    this.bitRate = 320000;
    this.start = 0;
    this.max = 1765876;
    this.step = this.bitRate / 8;
    this.decodedSample = 0;
    this.delay = 1;
    this.startSampleOffset = 0;
    this.scalingFactor = 100;
    this.playing = true;
    this.resetOutput();
    let first = true;

    while (this.start < this.max && this.playing) {
      const { time, play, start, end } = await this.processChunk();
      if (first) {
        this.startedAt = time;
      }
      // start();
      const node = this.createWebAudioCallback(() => {
        if (this.playing) {
          /* const timeLeft = time - this.ac.currentTime;
          console.log("schedule in ", timeLeft); */
          console.log("start, end", start, end);
          play();
        } else {
          console.log("not playing anymore...");
        }
      }, time);
      this.callbackNodes.push(node);
      first = false;
    }
  }

  wipeCallbacks() {
    this.callbackNodes.forEach((node) => {
      node.ignoreCallback = true;
      if (node["started"]) {
        node.stop();
      }
    });
    this.callbackNodes = [];
  }

  pause() {
    console.log("pause!", this.buffers.length);
    this.pausedAt = this.ac.currentTime;

    this.wipeCallbacks();
    this.output.gain.setValueAtTime(1, this.pausedAt);
    this.output.gain.linearRampToValueAtTime(0, this.pausedAt + 0.1);
    this.playing = false;
  }

  createWebAudioCallback(callback, time) {
    const constantSourceNode = this.ac.createConstantSource();
    constantSourceNode.onended = () => {
      if (!constantSourceNode["ignoreCallback"]) {
        callback();
      } else {
        console.log("ignore callback!");
      }
    };
    // constantSourceNode.connect(this.ac.destination);
    if (time > this.ac.currentTime) {
      constantSourceNode.start(time - 0.2);
      constantSourceNode["started"] = true;
      constantSourceNode.stop(time - 0.1);
    }
    return constantSourceNode;
  }
}

export class Chunk {}
