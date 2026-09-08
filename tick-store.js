/**
 * tick-store.js
 * -----------------------------------------------------------------------
 * Centralized, server-side version of the tick-to-candle builder.
 * Any device (phone, PC, etc) can POST ticks here via /api/ingest-ticks,
 * and any device can then ask for a signal without needing its own local
 * history - the server already has it.
 *
 * Persistence: snapshotted to disk periodically so a simple restart
 * doesn't lose everything. For durability across REDEPLOYS on Railway,
 * attach a Volume mounted at DATA_DIR (see README) - without one, the
 * disk is ephemeral and resets on redeploy, though it survives ordinary
 * restarts/sleeps in between.
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const TIMEFRAME_SECONDS = { "1m": 60, "3m": 180, "5m": 300, "30m": 1800, "1h": 3600, "4h": 14400 };
const MAX_CANDLES_PER_TF = 300;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "candles.json");

// store[symbol][tf] = { current: {time,open,high,low,close}|null, history: [...] }
let store = {};

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    /* ignore - directory may already exist */
  }
}

function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      console.log(`Tick store loaded from ${STORE_FILE}`);
    }
  } catch (e) {
    console.warn("Could not load tick store, starting fresh:", e.message);
    store = {};
  }
}

function save() {
  ensureDataDir();
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store));
  } catch (e) {
    console.warn("Could not save tick store:", e.message);
  }
}

function getBuilder(symbol, tf) {
  if (!store[symbol]) store[symbol] = {};
  if (!store[symbol][tf]) store[symbol][tf] = { current: null, history: [] };
  return store[symbol][tf];
}

function ingestTick(symbol, tMs, price) {
  if (!symbol || typeof price !== "number" || typeof tMs !== "number") return;

  for (const tf of Object.keys(TIMEFRAME_SECONDS)) {
    const periodMs = TIMEFRAME_SECONDS[tf] * 1000;
    const bucketStart = Math.floor(tMs / periodMs) * periodMs;
    const b = getBuilder(symbol, tf);

    if (!b.current || b.current.time !== bucketStart) {
      if (b.current) {
        b.history.push(b.current);
        if (b.history.length > MAX_CANDLES_PER_TF) b.history.shift();
      }
      b.current = { time: bucketStart, open: price, high: price, low: price, close: price };
    } else {
      b.current.high = Math.max(b.current.high, price);
      b.current.low = Math.min(b.current.low, price);
      b.current.close = price;
    }
  }
}

// Only fully-closed candles - same "no flicker" rule as the client.
function getCandles(symbol, tf) {
  const b = store[symbol]?.[tf];
  if (!b || b.history.length === 0) return null;
  return [...b.history];
}

function getCandleCount(symbol, tf) {
  return store[symbol]?.[tf]?.history.length || 0;
}

load();
setInterval(save, 15000);
process.on("SIGTERM", () => { save(); process.exit(0); });

module.exports = { ingestTick, getCandles, getCandleCount, TIMEFRAME_SECONDS };
