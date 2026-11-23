import { backtest } from "./trading.mjs";
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: backtest(data.bars, data.options) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
