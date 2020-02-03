import {promises as fs} from 'fs';
import {reduce} from 'lodash';
import axios from 'axios';
import puppetter from 'puppeteer';
import Telegram from 'messaging-api-telegram';
import cron from 'node-cron';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const client = Telegram.TelegramClient.connect(TELEGRAM_BOT_TOKEN);
let knownShows = {};
let newShows = [];
const knownShowsBackupFile = './lib/known-shows.json';
const lodashCdnUrl =
  'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.15/lodash.min.js';

if (!TELEGRAM_BOT_TOKEN) {process.exit(1);}

cron.schedule('* * * * *', run);

function run() {
  return restoreKnownShows()
    .then(exec)
    .catch(console.error);
}

function exec() {
  return getCurrentShows()
    .then(getNewShows)
    .then((_newShows) => newShows = _newShows)
    .then(backupKnownShows)
    .then(notifyNewShows)
    .then(() => console.log(Date.now()));
}

function getCurrentShows() {
  let browser;
  let page;

  return puppetter.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']})
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
    .catch(console.log)
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
    .catch(console.error);
}

function backupKnownShows() {
  return fs.writeFile(knownShowsBackupFile, JSON.stringify(knownShows));
}

function notifyNewShows() {
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
        .then(() => client.sendMessage(CHAT_ID, msg))
        .then(() => index === newShows.length && resolve());
    });
  });
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
