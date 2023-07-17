const rangeParser = require("range-parser");

exports.handler = async function (event, context) {
  const rangeHeader = event.headers["range"];

  if (rangeHeader) {
    const ranges = rangeParser(audioFileSize, rangeHeader, { combine: true });
    if (!ranges) {
      return {
        statusCode: 416,
        body: "Requested Range Not Satisfiable",
      };
    } else if (ranges.type === "bytes") {
      return {
        statusCode: 200,
        body: JSON.stringify({ ranges }),
      };
      /* const range = ranges[0];
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
      return; */
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ event, context }),
  };
};
