const axios = require('axios');

const symbol = 'APTUSDT';
const interval = '15m';
const limit = 100;
const atrPeriod = 1;
const atrMultiplier = 1;
const useClose = true;
const profitTarget = 0.5;
const zlsmaLength = 75;
const includeZLSMA = true;

const webhookUrl = 'https://discord.com/api/webhooks/1322193887003148308/MmkpxxH5XcYYgiCnUAKI0tokZq0XwDJ9x1vU0t93KvZndhDoCIZOkeBS71mRuLnmtuL2';

let dir = 1;
let longStopPrev = null;
let shortStopPrev = null;

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
  const sumXX = data.reduce((sum, val, i) => sum + i * i, 0);
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

async function sendDiscordMessage(type, price, time) {
  const msg = {
    content: `📢 **${type} Signal**
🕒 Time: ${time}
💰 Price: ${price.toFixed(4)}
🔗 Symbol: ${symbol}`,
  };

  try {
    await axios.post(webhookUrl, msg);
    console.log(`✅ Sent ${type} signal to Discord`);
  } catch (err) {
    console.error('❌ Discord Webhook Error:', err.message);
  }
}
async function SendDiscordCustom(content){
  const msg = {
    content: content
  };
  try {
    await axios.post(webhookUrl, msg);
    // console.log(`✅ Sent ${type} signal to Discord`);
  } catch (err) {
    console.error('❌ Discord Webhook Error:', err.message);
  }
}

async function checkForSignal() {

  try {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await axios.get(url);

    const candles = res.data.map(c => ({
      time: new Date(c[0]).toISOString(),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
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
    if (longStopPrev !== null && candles[i - 1].close > longStopPrev)
      longStop = Math.max(longStop, longStopPrev);

    let shortStop = low + atr;
    if (shortStopPrev !== null && candles[i - 1].close < shortStopPrev)
      shortStop = Math.min(shortStop, shortStopPrev);

    let newDir = dir;
    if (candles[i].close > shortStopPrev) newDir = 1;
    else if (candles[i].close < longStopPrev) newDir = -1;

    if (newDir === 1 && dir === -1) {
      await sendDiscordMessage("BUY", candles[i].close, candles[i].time);
    } else if (newDir === -1 && dir === 1) {
      await sendDiscordMessage("SELL", candles[i].close, candles[i].time);
    }

    dir = newDir;
    longStopPrev = longStop;
    shortStopPrev = shortStop;
  } catch (err) {
    await SendDiscordCustom('❌ Error in signal check:', err.message)
    console.error('❌ Error in signal check:', err.message);
  }
}

setInterval(checkForSignal, 1 * 60 * 1000); // Every 15 minutes
checkForSignal(); // Initial call
