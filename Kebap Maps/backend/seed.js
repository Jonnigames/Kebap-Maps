const db = require('./db');

db.serialize(() => {
  db.run(`DROP TABLE IF EXISTS shop_ratings`);
  db.run(`DROP TABLE IF EXISTS favorites`);
  db.run(`DROP TABLE IF EXISTS sessions`);
  db.run(`DROP TABLE IF EXISTS users`);
  db.run(`DROP TABLE IF EXISTS shops`);

  db.run(`
    CREATE TABLE shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      address TEXT,
      district TEXT,
      lat REAL,
      lng REAL,

      rating REAL,
      wait_time TEXT,

      chicken INTEGER,
      steak INTEGER,
      hack INTEGER,

      prices_json TEXT,
      is_user_created INTEGER DEFAULT 0,
      rating_sum REAL,
      rating_count INTEGER,
      owner_user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE favorites (
      user_id INTEGER NOT NULL,
      shop_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, shop_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(shop_id) REFERENCES shops(id) ON DELETE CASCADE
    )
  `);

  // Ratings pro User pro Shop
  db.run(`
    CREATE TABLE shop_ratings (
      user_id INTEGER NOT NULL,
      shop_id INTEGER NOT NULL,
      rating REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, shop_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(shop_id) REFERENCES shops(id) ON DELETE CASCADE
    )
  `);

  const shops = [
    ["Rüyam Gemüse Kebap", "Hauptstraße 36, 10827 Berlin", "Schöneberg", 52.48459, 13.35225, 5.0, "10–15 min", 1, 0, 0, JSON.stringify([{ label: "Döner", price: 6.9 }, { label: "Dürüm", price: 7.5}])],
    ["Mustafa's Gemüse Kebap", "Mehringdamm 33, 10961 Berlin", "Kreuzberg", 52.4930, 13.3871, 4.0, "20–30 min", 1, 0, 0, JSON.stringify([{ label: "Döner", price: 7.9 }, { label: "Dürüm", price: 9.1 }])],
    ["Oggi's Gemüsekebab", "Döberitzer Str. 1, 10557 Berlin", "Mitte", 52.52955, 13.36892, 5.0, "10–20 min", 1, 0, 0, JSON.stringify([{ label: "Döner", price: 7.0 }, { label: "Dürüm", price: 8.0 }, { label: "Pommes", price: 3.5 }])], 
    ["Zagros", "Skalitzer Str. 100, 10997 Berlin", "Kreuzberg", 52.49955, 13.42844, 4.5, "15–25 min", 1, 0, 0, JSON.stringify([{ label: "Döner", price: 7.0 }, { label: "Dürüm", price: 8.5 }, { label: "Falafel", price: 4.0 }])], 
    ["Ehl-i Kebap by Et Dünyasi", "Gerichtstraße 46, 13347 Berlin", "Mitte", 52.54515, 13.36243, 4.5, "10–15 min", 0, 1, 0, JSON.stringify([{ label: "Döner", price: 7.0 }, { label: "Dürüm", price: 8.9 }])], 
    ["Pamfilya", "Sonnenallee 100, 12045 Berlin", "Neukölln", 52.4811, 13.4333, 4.0, "15–20 min", 0, 1, 1, JSON.stringify([{ label: "Döner", price: 7.0 }, { label: "Dürüm", price: 9.0 }])],
    ["Ugur Imbiss", "Prinzenallee 14, 13357 Berlin", "Mitte", 52.55436, 13.38347, 4.0, "10–15 min", 0, 0, 1, JSON.stringify([{ label: "Döner", price: 8.0 }, { label: "Dürüm", price: 9.0 }])], 
    ["Muca Kebap", "Oranienpl. 2, 10999 Berlin", "Kreuzberg", 52.50238, 13.41509, 4.5, "10–20 min", 0, 1, 0, JSON.stringify([{ label: "Döner", price: 9.0 }, { label: "Dürüm", price: 10.0 }])], 
    ["k.bap Döner", "Seddiner Str. 8, 10315 Berlin", "Lichtenberg", 52.51344, 13.52158, 2.0, "10–15 min", 0, 0, 1, JSON.stringify([{ label: "Döner", price: 7.0 }, { label: "Dürüm", price: 8.0 }])], 
    ["Bistro Legende", "Alfred-Kowalke-Straße 4A, 10315 Berlin", "Lichtenberg", 52.50546, 13.51479, 3.0, "15–25 min", 0, 0, 1, JSON.stringify([{ label: "Döner", price: 7.0 }, { label: "Dürüm", price: 8.0 }])] 
  ];

  const stmt = db.prepare(`
    INSERT INTO shops
      (name, address, district, lat, lng, rating, wait_time, chicken, steak, hack, prices_json, is_user_created, rating_sum, rating_count, owner_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  shops.forEach(s => {
    const rating = s[5];
    // baseline: sum=rating, count=1 (entspricht eurem Start-Ø)
    stmt.run([...s, 0, rating, 1, null]);
  });
  stmt.finalize();

  console.log('Seed erfolgreich: 10 globale Shops + Auth/Favorites/Ratings Tabellen erstellt');
});
