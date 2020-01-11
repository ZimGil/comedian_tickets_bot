import {promises as fs} from 'fs';
import _ from 'lodash';
import axios from 'axios';
import puppetter from 'puppeteer';
import Telegram from 'messaging-api-telegram';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const client = Telegram.TelegramClient.connect(TELEGRAM_BOT_TOKEN);
let knownShows = {};
let newShows = [];
const CHECK_INTERVAL = 3 * 60 * 1000;
const knownShowsBackupFile = './lib/known-shows.json';
const lodashCdnUrl =
  'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.15/lodash.min.js';

if (!TELEGRAM_BOT_TOKEN) {process.exit(1);}

restoreKnownShows()
  .then(() => setInterval(exec, CHECK_INTERVAL));

function exec() {
  return getCurrentShows()
    .then(getNewShows)
    .then((_newShows) => newShows = _newShows)
    .then(backupKnownShows)
    .then(getSubscribers)
    .then(notifyNewShows);
}

function getCurrentShows() {
  let browser;
  let page;

  return puppetter.launch()
    .then((_browser) => browser = _browser)
    .then(() => browser.newPage())
    .then((_page) => page = _page)
    .then(() => page.goto('http://www.comedybar.co.il/show.php?id=52'))
    .then(() => page.addScriptTag({url: lodashCdnUrl}))
    .then(() => page.evaluate(() => {
      const tableRows = document.querySelectorAll('.show_appearances_list tr');
      return _.reduce(tableRows, (shows, tr) => {
        if (tr.rowIndex <= 2 || tr.rowIndex % 2) {return shows;}
        const showDate = tr.cells[0].innerText;
        shows[showDate] = {
          date: showDate,
          day: tr.cells[2].innerText,
          location: tr.cells[4].innerText,
          time: tr.cells[6].innerText,
          link: tr.cells[8].children[0].href
        };
        return shows;
      }, {});
    }))
    .finally(() => browser.close());
}

function getNewShows(currentShows) {
  return _.reduce(currentShows, (newShows, show, showDate) => {
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
    .catch(console.error);
}

function backupKnownShows() {
  return fs.writeFile(knownShowsBackupFile, JSON.stringify(knownShows));
}

function getSubscribers() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
  return axios.get(url)
    .then((res) => {
      return _.chain(res.data.result)
        .map((update) => update.message.chat.id)
        .uniq()
        .value();
    });
}

function notifyNewShows(chatIds) {
  return new Promise((resolve) => {
    promiseForEach(newShows, (show, index) => {
      let msg = [
        'הופעה חדשה של שחר חסון',
        `תאריך: ${show.date}`,
        `יום: ${show.day}`,
        `שעה: ${show.time}`,
        `מקום: ${show.location}`
      ].join('\n');
      const tinyUrl = `http://tinyurl.com/api-create.php?url=${show.link}`;
      return axios.get(tinyUrl)
        .then((link) => msg += `\nקישור: ${link.data}`)
        .catch(() => msg += '\nהכרטיסים אזלו')
        .then(() => sendMsgToSubscribers(chatIds, msg))
        .then(() => index === newShows.length && resolve());
    });
  });
}

function sendMsgToSubscribers(chatIds, msg) {
  return new Promise((resolve) => {
    promiseForEach(chatIds, (id, index) => {
      return client.sendMessage(id, msg)
        .then(() => index === chatIds.length && resolve());
    });
  });
};

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
