// Firebase project settings for Gear Locker. These identify the project; they are not passwords.
// Your data is protected by your login and the Firestore security rules.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBexXFiQtDEnmlL2z0x4FXD7YCbeAHTGC4",
  authDomain: "gear-locker-c248c.firebaseapp.com",
  projectId: "gear-locker-c248c",
  storageBucket: "gear-locker-c248c.firebasestorage.app",
  messagingSenderId: "631959211168",
  appId: "1:631959211168:web:7ae416380bb1a91fa3cdc5"
};

// Price + weight lookup service (Cloudflare Worker). Works for every signed-in user.
window.LOOKUP_URL = "https://gear-locker-api.ace0nbase.workers.dev";
