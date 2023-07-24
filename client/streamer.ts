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

  bitRate = 320000; // bits per second
  sampleRate; // samples per second
  start = 0; // byte position
  max = 1765876; // max bytes
  step = this.bitRate / 8; // bytes per chunk
  decodedSample = 0; // sample position
  delay = 1; // seconds until playback starts
  _playing = false;
  buffers: {
    audioBuffer: AudioBuffer;
    time: number;
    progress: number;
    start: number;
    decodedSample: number;
  }[] = [];
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

  async processChunk(offset) {
    let start = this.start; // start of chunk bytes (as fetched)
    let end = Math.min(this.max, this.start + this.step); // end of chunk

    let { buffer } = await this.fetchAudioBuffer(this.start, end - 1);

    const { samplesDecoded, sampleRate, audioBuffer } =
      await this.arrayBufferToAudioBuffer(buffer);

    const time = this.decodedSample / sampleRate + this.delay;

    this.buffers.push({
      audioBuffer,
      time,
      progress: this.start / this.max,
      start: this.start,
      decodedSample: this.decodedSample,
    });

    const play = () => this.playBuffer(audioBuffer, time + offset);
    this.decodedSample += samplesDecoded;

    this.start = end;
    return { play, time, start, end, sampleRate };
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
    console.log("play", this.progress, this.bufferProgress);
    this.playing = false;
    await this.ac.resume();
    this.bitRate = 320000;
    this.max = 1765876;
    this.step = this.bitRate / 8;

    const startOffset = this.currentBuffer?.start ?? 0; // bytes
    const sampleOffset = this.currentBuffer?.decodedSample ?? 0; // samples
    const secondOffset = (startOffset * 8) / this.bitRate;
    //const secondOffset = this.pausedAt ? this.pausedAt - this.startedAt : 0;

    // this.buffers = [];
    this.start = startOffset;
    // this.start = Math.max(startOffset - this.step, 0); // scrub back a little bit
    this.decodedSample = sampleOffset;

    this.delay = this.ac.currentTime + 0.5;
    this.resetOutput();
    this.playing = true;
    let first = true;

    while (this.start < this.max && this.playing) {
      let { time, play } = await this.processChunk(-secondOffset);
      // start();
      const node = this.createWebAudioCallback(() => {
        if (this.playing) {
          play();
        } else {
          console.log("not playing anymore...");
        }
      }, time - secondOffset);
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
    this.pausedAt = this.ac.currentTime;

    this.wipeCallbacks();
    this.output.gain.setValueAtTime(1, this.pausedAt);
    this.output.gain.linearRampToValueAtTime(0, this.pausedAt + 0.1);
    this.playing = false;
  }
  stop() {
    this.pause();
    this.buffers = [];
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
