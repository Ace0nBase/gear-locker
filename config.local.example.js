// Optional local test override. Copy this file to config.local.js.
// config.local.js is not published and is loaded only on this computer when the
// page address has ?env=emulator. Any live project id, live key, or workers.dev
// address is refused. The app then stays off. It does not fall through to production.
window.GEAR_LOCAL = {
  firebase: {
    apiKey: "demo-gear-locker",
    authDomain: "localhost",
    projectId: "demo-gear-locker",
    storageBucket: "demo-gear-locker.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:demo"
  },
  lookupUrl: "http://127.0.0.1:8787"
};
