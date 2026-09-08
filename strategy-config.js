/**
 * ALFA Strategy — backend signal configuration.
 * Edit this file to tune the server-side strategy without changing the extension UI.
 *
 * minVotes: minimum number of directional strategy votes required.
 * minMajority: required share of votes for CALL/PUT (0.55 = 55%).
 * enabledStrategies: set a strategy to false to exclude it from the vote count.
 */
module.exports = {
  minVotes: 2,
  minMajority: 0.55,
  enabledStrategies: {
    "RSI": true,
    "MACD": true,
    "MA10/30": true,
    "Bollinger": true,
    "Trend (EMA 20/50)": true,
    "Support/Resistance": true,
    "Candlestick": true,
    "Price Action": true,
    "Stochastic": true,
    "CCI": true,
    "Momentum": true,
    "ADX": true,
    "Breakout": true
  }
};
