import os from 'os';
import { promises as fs } from 'fs';
import { reduce } from 'lodash';
import puppetter from 'puppeteer';
import Telegram from 'messaging-api-telegram';
import cron from 'node-cron';
import logger from './logger.js';

const { TELEGRAM_BOT_TOKEN ,CHAT_ID, NODE_ENV } = process.env;

const client = Telegram.TelegramClient.connect(TELEGRAM_BOT_TOKEN);
let knownShows = {};
let newShows = [];
const browserOptions = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
};
if (os.arch().includes('arm')) {
  browserOptions.executablePath = 'chromium-browser';
}
const knownShowsBackupFile = './lib/known-shows.json';
const lodashCdnUrl = 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.15/lodash.min.js';

if (!TELEGRAM_BOT_TOKEN) {process.exit(1);}

restoreKnownShows()
  .then(() => cron.schedule('* * * * *', run));

function run() {
  return getCurrentShows()
    .then(getNewShows)
    .then((_newShows) => {
      newShows = _newShows;
      newShows.length && logger.info('New shows', newShows);
    })
    .then(() => NODE_ENV !== 'development' && backupKnownShows())
    .then(notifyNewShows)
    .catch((e) => logger.error(e));
}

function getCurrentShows() {
  let browser;
  let page;

  logger.debug('Getting current shows');
  return puppetter.launch(browserOptions)
    .then((_browser) => browser = _browser)
    .then(() => browser.newPage())
    .then((_page) => page = _page)
    .then(() => page.goto('http://www.comedybar.co.il/show.php?id=52'))
    .then(() => page.addScriptTag({url: lodashCdnUrl}))
    .then(() => page.evaluate(() => {
      const tableRows = document.querySelectorAll('.show_appearances_list tr');
      return _.reduce(tableRows, (shows, tr) => {
        if (tr.rowIndex === 0 || tr.rowIndex % 2) {return shows;}
        const showDate = tr.cells[0].innerText;
        shows[showDate] = {
          date: showDate,
          day: tr.cells[2].innerText,
          location: tr.cells[4].innerText,
          time: tr.cells[6].innerText,
          link: tr.cells[8].children[0].href,
          linkText: tr.cells[8].children[0].innerText
        };
        return shows;
      }, {});
    }))
    .catch((e) => logger.error(e))
    .finally(() => browser.close());
}

function getNewShows(currentShows) {
  return reduce(currentShows, (newShows, show, showDate) => {
    if (knownShows[showDate]) {return newShows;}
    newShows.push(show);
    knownShows[showDate] = show;
    return newShows;
  }, []);
}

function restoreKnownShows() {
  return fs.readFile(knownShowsBackupFile)
    .then(JSON.parse)
    .then((_knownShows) => knownShows = _knownShows)
    .then(() => logger.info('Restored known shows from file'))
    .catch((e) => logger.error(e));
}

function backupKnownShows() {
  return fs.writeFile(knownShowsBackupFile, JSON.stringify(knownShows));
}

function notifyNewShows() {
    return promiseForEach(newShows, sendMessage);
}

function sendMessage(show) {
  return client.sendMessage(CHAT_ID, getShowMessage(show), {parse_mode: 'MarkdownV2'});
}

function getShowMessage({date, day, time, location, link, linkText}) {
  const linkStr = link && link.includes('http')
    ? `[הזמנת כרטיסים](${link})`
    : linkText;

  const msg =  [
    'הופעה חדשה של שחר חסון',
    `תאריך: ${date}`,
    `יום: ${day}`,
    `שעה: ${time}`,
    `מקום: ${escapeReservedChars(location)}`,
    linkStr
  ];


  return msg.join('\n');
}

function escapeReservedChars(str) {
  // https://core.telegram.org/bots/api#markdownv2-style
  return str.replace(/[_\*\[\]\(\)~`>#+-=|{}\.!]/g, (s) => `\\${s}`);
}

function promiseForEach(arr, callback) {
  let i = 0;

  return Promise.resolve()
    .then(nextPromise);

  function nextPromise() {
    if (i >= arr.length) {return;}

    return Promise.resolve(callback(arr[i], i++))
      .then(nextPromise);
  };
}
