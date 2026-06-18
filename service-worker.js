// שם וגרסה לקאש (אחסון זמני של קבצים) - כששנה את הקוד בעתיד, נשנה את המספר כדי שהדפדפן יידע לעדכן
const CACHE_NAME = 'personal-notes-v2';

// כל הקבצים שצריך לשמור כדי שהאפליקציה תעבוד בלי אינטרנט
const FILES_TO_CACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './crypto-storage.js',
];

// כשה-service worker "מותקן" לראשונה - שומר את כל הקבצים החשובים בקאש
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

// מנקה גרסאות קאש ישנות כשיש גרסה חדשה
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});

// כל בקשה שהאפליקציה עושה - בודק קודם אם יש בקאש (מקומי), ורק אם אין - מנסה אינטרנט
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
