const rangeParser = require("range-parser");
const fs = require("fs");
const audioFilePath = "./numsdrums.mp3"; // Replace with the actual path to your audio file

exports.handler = async function (event, context) {
  const rangeHeader = event.headers["range"];
  const audioFileSize = fs.statSync(audioFilePath).size;
  if (rangeHeader) {
    const ranges = rangeParser(audioFileSize, rangeHeader, { combine: true });
    if (!ranges) {
      return {
        statusCode: 416,
        body: "Requested Range Not Satisfiable",
      };
    }
    if (ranges.type === "bytes") {
      const range = ranges[0];
      const start = range.start;
      const end = range.end;
      const chunkSize = end - start + 1;

      const fileBuffer = fs.readFileSync(audioFilePath);
      const fileContents = fileBuffer.slice(start, end + 1);

      const headers = {
        "Content-Type": "audio/mpeg",
        "Content-Length": chunkSize,
        "Content-Range": `bytes ${start}-${end}/${audioFileSize}`,
      };
      return {
        headers,
        statusCode: 206,
        body: fileContents.toString("base64"),
        isBase64Encoded: true,
      };
    }
    return {
      status: 400,
      body: "Unknown Error",
    };
  }
};
