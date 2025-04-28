const axios = require('axios');

const symbols = ['XRPUSDT', 'ICPUSDT', 'APTUSDT', 'SOLUSDT', 'BNBUSDT', 'SUIUSDT', 'HBARUSDT'];
const interval = '5m';
const limit = 500;
const atrPeriod = 1;
const atrMultiplier = 2;
const useClose = true;
const zlsmaLength = 50;
const includeZLSMA = true;

const webhookUrl = 'https://discord.com/api/webhooks/1322193887003148308/MmkpxxH5XcYYgiCnUAKI0tokZq0XwDJ9x1vU0t93KvZndhDoCIZOkeBS71mRuLnmtuL2';

const state = {};

function highest(arr, len) {
  return Math.max(...arr.slice(-len));
}

function lowest(arr, len) {
  return Math.min(...arr.slice(-len));
}

function calculateATR(data, period) {
  const atr = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      atr.push(data[i].high - data[i].low);
    } else {
      const highLow = data[i].high - data[i].low;
      const highClose = Math.abs(data[i].high - data[i - 1].close);
      const lowClose = Math.abs(data[i].low - data[i - 1].close);
      const tr = Math.max(highLow, highClose, lowClose);
      if (i < period) {
        atr.push(tr);
      } else {
        const prevATR = atr[atr.length - 1];
        atr.push((prevATR * (period - 1) + tr) / period);
      }
    }
  }
  return atr;
}

function linreg(data, length) {
  const sumX = (length * (length - 1)) / 2;
  const sumY = data.reduce((sum, val) => sum + val, 0);
  const sumXY = data.reduce((sum, val, i) => sum + i * val, 0);
  const sumXX = data.reduce((sum, _, i) => sum + i * i, 0);
  const slope = (length * sumXY - sumX * sumY) / (length * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / length;
  return data.map((_, i) => slope * i + intercept);
}

function calculateZLSMA(data, length) {
  let zlsma = [];
  for (let i = length - 1; i < data.length; i++) {
    const slice = data.slice(i - length + 1, i + 1);
    const lsma = linreg(slice.map(c => c.close), length);
    const lsma2 = linreg(lsma, length);
    const eq = lsma[lsma.length - 1] - lsma2[lsma2.length - 1];
    zlsma.push(lsma[lsma.length - 1] + eq);
  }
  return zlsma;
}

async function sendDiscordMessage(type, price, time, symbol, trend) {
  const msg = {
    content: `\uD83D\uDCE2 **${type} Signal**\n\uD83D\uDD52 Time: ${time}\n\uD83D\uDCB0 Price: ${price.toFixed(4)}\n\uD83D\uDCC8 Trend: ${trend}\n\uD83D\uDD17 Symbol: ${symbol}\n__________________\n\uD83D\uDD34 Live`,
  };
  try {
    await axios.post(webhookUrl, msg);
    console.log(`✅ Sent ${type} signal for ${symbol}`);
  } catch (err) {
    console.error('❌ Discord Webhook Error:', err.message);
  }
}

async function checkForSignal(symbol) {
  try {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await axios.get(url);

    const candles = res.data.map(c => ({
      time: new Date(c[0]).toISOString(),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));

    const atrValues = calculateATR(candles, atrPeriod);
    const zlsma = includeZLSMA ? calculateZLSMA(candles, zlsmaLength) : [];

    const i = candles.length - 1;
    const slice = candles.slice(i - atrPeriod + 1, i + 1);
    const closeArr = slice.map(c => c.close);
    const atr = atrMultiplier * atrValues[i];

    const high = useClose ? highest(closeArr, atrPeriod) : highest(slice.map(c => c.high), atrPeriod);
    const low = useClose ? lowest(closeArr, atrPeriod) : lowest(slice.map(c => c.low), atrPeriod);

    let longStop = high - atr;
    let shortStop = low + atr;

    const prevState = state[symbol] || {
      dir: 1,
      longStopPrev: null,
      shortStopPrev: null
    };

    if (prevState.longStopPrev !== null && candles[i - 1].close > prevState.longStopPrev)
      longStop = Math.max(longStop, prevState.longStopPrev);
    if (prevState.shortStopPrev !== null && candles[i - 1].close < prevState.shortStopPrev)
      shortStop = Math.min(shortStop, prevState.shortStopPrev);

    let newDir = prevState.dir;
    if (prevState.shortStopPrev !== null && candles[i].close > prevState.shortStopPrev) newDir = 1;
    else if (prevState.longStopPrev !== null && candles[i].close < prevState.longStopPrev) newDir = -1;

    const avgVolume = candles.slice(i - 20, i).reduce((sum, c) => sum + c.volume, 0) / 20;
    const currentVolume = candles[i].volume;
    const volumeRatio = currentVolume / avgVolume;

    const range = candles[i].high - candles[i].low;
    const potentialMovePercent = ((atr / candles[i].close) * 100).toFixed(2);

    const entryPrice = candles[i].close;
    const stopLoss = newDir === 1 ? entryPrice - atr : entryPrice + atr;
    const takeProfit = newDir === 1 ? entryPrice + 2 * atr : entryPrice - 2 * atr;

    const trend = candles[i].close > candles[0].close ? '📈 Upward' : '📉 Downward';

    if (newDir === 1 && prevState.dir === -1) {
      await sendDiscordMessage("BUY", entryPrice, candles[i].time, symbol, `${trend} | 📊 Vol x${volumeRatio.toFixed(2)} | 📉 SL: ${stopLoss.toFixed(4)} | 📈 TP: ${takeProfit.toFixed(4)} | 📌 Move: ${potentialMovePercent}%`);
    } else if (newDir === -1 && prevState.dir === 1) {
      await sendDiscordMessage("SELL", entryPrice, candles[i].time, symbol, `${trend} | 📊 Vol x${volumeRatio.toFixed(2)} | 📉 SL: ${stopLoss.toFixed(4)} | 📈 TP: ${takeProfit.toFixed(4)} | 📌 Move: ${potentialMovePercent}%`);
    }

    state[symbol] = {
      dir: newDir,
      longStopPrev: longStop,
      shortStopPrev: shortStop
    };

  } catch (err) {
    console.error(`❌ Error for ${symbol}:`, err.message);
  }
}

async function runBot() {
  console.log('🚀 Bot started...');
  for (const symbol of symbols) {
    checkForSignal(symbol);
  }
}
setInterval(runBot, 60 * 1000); // Every 1 minute
runBot(); // Initial call