import { MPEGDecoder } from "mpg123-decoder";
import { Streamer } from "./streamer";
import "./style.css";

const decoder = new MPEGDecoder();
const ac = new AudioContext();
const audioUrl = "/.netlify/functions/stream";
let volume = 1;
const mix = ac.createGain();
mix.connect(ac.destination);

const streamer = new Streamer({
  url: audioUrl,
  ac,
  decoder,
  destination: mix,
});

document.getElementById("slider").addEventListener("input", (e) => {
  volume = e.target.value / 100;
  mix.gain.value = volume;
});

setInterval(() => {
  const pp = document.getElementById("play-progress");
  pp.style.width = `${Math.round(streamer.progress * 100)}%`;
  const bp = document.getElementById("buffer-progress");
  bp.style.width = `${Math.round(streamer.bufferProgress * 100)}%`;
}, 500);

async function run() {
  await decoder.ready;

  document
    .getElementById("play")
    .addEventListener("click", () => streamer.play());
  document
    .getElementById("pause")
    .addEventListener("click", () => streamer.pause());
}

run();
