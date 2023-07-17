# stream-test

- a node server that returns chunks of an mp3 file via Range header.
- a client that requests all chunks and plays them in sequence

running:

```sh
npm i
npm run server
npm run client # another terminal
# then open  http://localhost:5173/
```
