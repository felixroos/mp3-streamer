const http = require("http");
const fs = require("fs");
const rangeParser = require("range-parser");

const audioFilePath = "numsdrums.mp3"; // Replace with the actual path to your audio file

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");

  if (req.method === "OPTIONS") {
    return res.end();
  }
  const rangeHeader = req.headers["range"];

  if (rangeHeader) {
    const ranges = rangeParser(audioFileSize, rangeHeader, { combine: true });
    if (!ranges) {
      res.writeHead(416, "Requested Range Not Satisfiable");
      res.end();
      return;
    } else if (ranges.type === "bytes") {
      const range = ranges[0];
      const start = range.start;
      const end = range.end;
      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(audioFilePath, { start, end });
      const head = {
        "Content-Type": "audio/mpeg",
        "Content-Length": chunkSize,
        "Content-Range": `bytes ${start}-${end}/${audioFileSize}`,
      };
      console.log(head);
      res.writeHead(206, "Partial Content", head);

      fileStream.pipe(res);
      return;
    }
  }

  // no range requested, serve the full file
  res.writeHead(200, "OK", {
    "Content-Type": "audio/mpeg",
    "Content-Length": audioFileSize,
  });
  fs.createReadStream(audioFilePath).pipe(res);
});

const audioFileSize = fs.statSync(audioFilePath).size;

const port = 3000;
server.listen(port, () => {
  console.log(`Servr running on port ${port}`);
});
