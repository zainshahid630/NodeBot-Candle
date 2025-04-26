



const axios = require('axios');

const symbols = ['XRPUSDT', 'ICPUSDT', 'APTUSDT', 'SOLUSDT', 'BNBUSDT'];
const interval = '1m';
const limit = 500;
const atrPeriod = 2;
const atrMultiplier = 5;

const webhookUrl = 'https://discord.com/api/webhooks/1322193887003148308/MmkpxxH5XcYYgiCnUAKI0tokZq0XwDJ9x1vU0t93KvZndhDoCIZOkeBS71mRuLnmtuL2';

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

function calculateRSI(data, period = 14) {
  let gains = 0, losses = 0;
  const rsi = [];

  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  gains /= period;
  losses /= period;

  rsi.push(100 - (100 / (1 + gains / losses)));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) {
      gains = (gains * (period - 1) + diff) / period;
      losses = (losses * (period - 1)) / period;
    } else {
      gains = (gains * (period - 1)) / period;
      losses = (losses * (period - 1) - diff) / period;
    }
    rsi.push(100 - (100 / (1 + gains / losses)));
  }

  return rsi;
}

function calculateKSJ(data) {
  const ksValues = [];
  for (let i = 1; i < data.length; i++) {
    const priceDiff = data[i].close - data[i - 1].close;
    const volume = data[i].volume;
    ksValues.push(priceDiff * volume);
  }
  return ksValues;
}

function calculateVolumeTrend(data) {
  const volumes = data.map(c => c.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  return volumes[volumes.length - 1] > avgVol ? 1 : -1;
}

async function sendDiscordMessage(message) {
  try {
    await axios.post(webhookUrl, { content: message });
    console.log('✅ Signal sent to Discord');
  } catch (err) {
    console.error('❌ Discord Webhook Error:', err.message);
  }
}

function getHistoricalPerformance(data, type) {
  let gains = [], losses = [];
  for (let i = 0; i < data.length - 10; i++) {
    const entryPrice = data[i].close;
    const futurePrice = data[i + 10].close;
    const change = ((futurePrice - entryPrice) / entryPrice) * 100;
    if (type === 'BUY' && change > 0) gains.push(change);
    if (type === 'SELL' && change < 0) losses.push(Math.abs(change));
  }
  const expectedGain = gains.length ? (gains.reduce((a, b) => a + b) / gains.length).toFixed(2) : 0;
  const expectedLoss = losses.length ? (losses.reduce((a, b) => a + b) / losses.length).toFixed(2) : 0;
  return { expectedGain, expectedLoss };
}

async function analyzeSymbol(symbol) {
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

    const atr = calculateATR(candles, atrPeriod);
    const rsi = calculateRSI(candles);
    const ksj = calculateKSJ(candles);
    const volumeTrend = calculateVolumeTrend(candles);

    const closePrices = candles.map(c => c.close);
    const trend = closePrices[closePrices.length - 1] > closePrices[0] ? 'UPWARD' : 'DOWNWARD';
    const currentPrice = closePrices[closePrices.length - 1];

    let points = 0;
    let reasons = [];

    const rsiVal = rsi[rsi.length - 1];
    if ((trend === 'UPWARD' && rsiVal > 55) || (trend === 'DOWNWARD' && rsiVal < 45)) {
      points++;
      reasons.push(`RSI confirms trend: ${rsiVal.toFixed(2)}`);
    }

    const ksjSignal = ksj.slice(-10).reduce((a, b) => a + b, 0);
    if ((ksjSignal > 0 && trend === 'UPWARD') || (ksjSignal < 0 && trend === 'DOWNWARD')) {
      points++;
      reasons.push(`KSJ supports trend: ${ksjSignal.toFixed(2)}`);
    }

    if ((volumeTrend > 0 && trend === 'UPWARD') || (volumeTrend < 0 && trend === 'DOWNWARD')) {
      points++;
      reasons.push(`Volume Trend: ${volumeTrend > 0 ? 'High' : 'Low'}`);
    }

    const signal = trend === 'UPWARD' ? 'BUY' : 'SELL';
    const { expectedGain, expectedLoss } = getHistoricalPerformance(candles, signal);

    if (points >= 2) {
      const message = `📊 **${symbol} Signal Alert**\n\n` +
        `**Signal:** ${signal}\n` +
        `**Strength:** ${points}/3 ✅\n` +
        `**Reasons:**\n- ${reasons.join('\n- ')}\n` +
        `**Expected Gain:** ${expectedGain}% 📈\n` +
        `**Expected Loss:** ${expectedLoss}% 📉\n` +
        `**Current Price:** ${currentPrice.toFixed(4)} 💰\n` +
        `**Trend:** ${trend}`;
      await sendDiscordMessage(message);
    }
  } catch (err) {
    console.error(`Error analyzing ${symbol}:`, err.message);
  }
}

// Run all symbols
(async () => {
  for (const symbol of symbols) {
    await analyzeSymbol(symbol);
  }
})();
