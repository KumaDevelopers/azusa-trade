import { createServer } from "node:http";
import { handleTwelveStream } from "./twelve-stream.mjs";

const { TWELVE_DATA_API_KEY, TERMINAL_ORIGIN, PORT = "8080" } = process.env;
if (!TWELVE_DATA_API_KEY || !TERMINAL_ORIGIN) {
  throw new Error("TWELVE_DATA_API_KEY dan TERMINAL_ORIGIN diperlukan.");
}

createServer((request, response) => {
  if (request.url === "/health") { response.writeHead(200).end("ok"); return; }
  if (request.method !== "GET" || request.headers.origin !== TERMINAL_ORIGIN) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", TERMINAL_ORIGIN);
  response.setHeader("Vary", "Origin");
  if (!handleTwelveStream(request, response, { ...process.env, LOCAL_TWELVE_STREAM: "1" })) response.writeHead(404).end();
}).listen(Number(PORT));
