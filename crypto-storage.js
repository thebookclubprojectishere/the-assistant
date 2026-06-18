// ============================================
// קובץ זה אחראי על שני דברים בלבד:
// 1. הצפנה ופענוח (באמצעות Web Crypto API המובנה בדפדפן)
// 2. שמירה וקריאה מהאחסון המקומי (IndexedDB)
// שום קוד אחר באפליקציה "יודע" איך הצפנה עובדת - רק קובץ זה.
// ============================================

const DB_NAME = 'notes-app-db';
const DB_VERSION = 1;
const STORE_NAME = 'encrypted-entries';
const SALT_STORE_NAME = 'app-salt';

// ---------- שלב א: גזירת מפתח מהפספרייז ----------

// הופך טקסט רגיל (פספרייז) למפתח הצפנה.
// "salt" הוא ערך אקראי נוסף שמוודא ששתי משתמשות עם אותו פספרייז
// עדיין יקבלו מפתחות שונים (מגן מפני התקפות מסוימות). ה-salt עצמו
// אינו סודי - הוא נשמר בגלוי, אבל בלי הפספרייז הוא חסר תועלת לתוקף.
async function deriveKeyFromPassphrase(passphrase, salt) {
  const encoder = new TextEncoder();
  const passphraseBytes = encoder.encode(passphrase);

  // שלב 1: מייבאים את הפספרייז כ"חומר גלם" למפתח
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passphraseBytes,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // שלב 2: "מותחים" את הפספרייז 250,000 פעמים (PBKDF2) - זה מכוון, ועושה
  // ניחוש המוני של פספרייז (brute-force) הרבה יותר איטי לתוקף פוטנציאלי.
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 250000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ---------- שלב ב: הצפנה ופענוח של טקסט ----------

async function encryptText(plainText, key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);

  // IV (Initialization Vector) - ערך אקראי לכל הצפנה בנפרד, כדי שאותו
  // טקסט מוצפן פעמיים לא יראה אותו דבר. נשמר בגלוי לצד הטקסט המוצפן.
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );

  return {
    ciphertext: bufferToBase64(encryptedBuffer),
    iv: bufferToBase64(iv),
  };
}

async function decryptText(encryptedEntry, key) {
  const ciphertextBuffer = base64ToBuffer(encryptedEntry.ciphertext);
  const iv = base64ToBuffer(encryptedEntry.iv);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertextBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

// פונקציות עזר קטנות - ממירות בין פורמט בינארי (איך שההצפנה עובדת)
// לטקסט (איך ששומרים בקלות ב-IndexedDB)
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------- שלב ג: אחסון מקומי (IndexedDB) ----------

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SALT_STORE_NAME)) {
        db.createObjectStore(SALT_STORE_NAME);
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// ה-salt נוצר פעם אחת בלבד, בהתקנה הראשונה, ונשמר (בגלוי - זה תקין, ראי הסבר למעלה)
async function getOrCreateSalt() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SALT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(SALT_STORE_NAME);
    const request = store.get('salt');

    request.onsuccess = () => {
      if (request.result) {
        resolve(base64ToBuffer(request.result));
      } else {
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        store.put(bufferToBase64(newSalt), 'salt');
        resolve(newSalt);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveEncryptedEntry(entry) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllEncryptedEntries() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- API ציבורי - זה מה ש"שאר האפליקציה" קוראת לו ----------
// כל מה שמעל הוא פרטים פנימיים. הפונקציות הבאות הן הממשק היחיד
// שצריך להכיר כדי להשתמש במודול הזה.

const SecureStorage = {
  // מאתחלת מפתח עבודה מתוך פספרייז - קוראים לזה פעם אחת כשנכנסים לאפליקציה
  async unlock(passphrase) {
    const salt = await getOrCreateSalt();
    const key = await deriveKeyFromPassphrase(passphrase, salt);
    return key;
  },

  // שומרת פתק חדש (מצפינה אותו לפני השמירה)
  async saveEntry(key, plainTextContent, tags = []) {
    const { ciphertext, iv } = await encryptText(plainTextContent, key);
    const entry = {
      id: crypto.randomUUID(),
      ciphertext,
      iv,
      tags,
      createdAt: new Date().toISOString(),
    };
    await saveEncryptedEntry(entry);
    return entry.id;
  },

  // טוענת את כל הפתקים ומפענחת אותם
  async loadAllEntries(key) {
    const encryptedEntries = await getAllEncryptedEntries();
    const decrypted = [];
    for (const entry of encryptedEntries) {
      try {
        const content = await decryptText(entry, key);
        decrypted.push({
          id: entry.id,
          content,
          tags: entry.tags,
          createdAt: entry.createdAt,
        });
      } catch (err) {
        // אם הפענוח נכשל - כלומר הפספרייז שגוי - לא קורסים, רק מסמנים שגיאה
        console.error('Decryption failed for entry', entry.id, err);
        throw new Error('WRONG_PASSPHRASE');
      }
    }
    return decrypted;
  },
};
