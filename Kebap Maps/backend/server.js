// server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

// Node 18+ hat fetch global. Falls nicht: node-fetch nutzen.
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Kebap Maps Backend läuft');
});

/* =========================
   Passwort Hashing (PBKDF2)
========================= */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const keylen = 32;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4) return false;
    const [, itStr, salt, hashHex] = parts;
    const iterations = Number(itStr);
    if (!Number.isFinite(iterations) || iterations < 10000) return false;

    const expected = Buffer.from(hashHex, 'hex');
    const digest = 'sha256';
    const test = crypto.pbkdf2Sync(password, salt, iterations, expected.length, digest);

    if (expected.length !== test.length) return false;
    return crypto.timingSafeEqual(expected, test);
  } catch {
    return false;
  }
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1] : null;
}

/* =========================
   Auth Middleware
========================= */
function authOptional(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  db.get(
    `
      SELECT u.id, u.username
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `,
    [token],
    (err, row) => {
      if (err) {
        console.error(err);
        req.user = null;
        return next();
      }
      req.user = row ? { id: row.id, username: row.username, token } : null;
      return next();
    }
  );
}

function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
    next();
  });
}

/* =========================
   DB: Tabellen + Migration
========================= */
function initDb() {
  db.serialize(() => {
    // 1) users Tabelle ggf. migrieren (alte email-Spalte entfernen)
    db.all(`PRAGMA table_info(users)`, (err, cols) => {
      const names = Array.isArray(cols) ? cols.map(c => c.name) : [];
      const hasEmail = names.includes('email');
      const hasUsername = names.includes('username');
      const hasPasswordHash = names.includes('password_hash');

      const continueInit = () => {
        // Users
        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Sessions
        db.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);

        // Favorites
        db.run(`
          CREATE TABLE IF NOT EXISTS favorites (
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
          CREATE TABLE IF NOT EXISTS shop_ratings (
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

        // Shops Migration (alte DBs) - ignoriert Fehler, wenn Spalte schon existiert
        db.run(`ALTER TABLE shops ADD COLUMN prices_json TEXT`, () => {});
        db.run(`ALTER TABLE shops ADD COLUMN is_user_created INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE shops ADD COLUMN rating_sum REAL`, () => {});
        db.run(`ALTER TABLE shops ADD COLUMN rating_count INTEGER`, () => {});
        db.run(`ALTER TABLE shops ADD COLUMN owner_user_id INTEGER`, () => {});
        db.run(`ALTER TABLE shops ADD COLUMN created_at TEXT`, () => {});
        db.run(`ALTER TABLE shops ADD COLUMN cloned_from_shop_id INTEGER`, () => {});

        // Favorites Migration
        db.run(`ALTER TABLE favorites ADD COLUMN source TEXT DEFAULT 'normal'`, () => {});

        // Initialisieren, falls NULL
        db.run(`UPDATE shops SET rating_sum = rating WHERE rating_sum IS NULL`, () => {});
        db.run(`UPDATE shops SET rating_count = 1 WHERE rating_count IS NULL`, () => {});
        db.run(`UPDATE shops SET is_user_created = 0 WHERE is_user_created IS NULL`, () => {});
        db.run(`UPDATE favorites SET source = 'normal' WHERE source IS NULL`, () => {});
      };

      if (hasEmail) {
        console.log('Migrating users table: removing email column...');
        db.run(`ALTER TABLE users RENAME TO users_old`, (e1) => {
          if (e1) {
            console.error('Rename users failed:', e1);
            return continueInit();
          }

          db.run(`
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `, (e2) => {
            if (e2) {
              console.error('Create new users failed:', e2);
              return continueInit();
            }

            if (hasUsername && hasPasswordHash) {
              db.run(
                `
                  INSERT INTO users (id, username, password_hash, created_at)
                  SELECT id, username, password_hash, created_at FROM users_old
                `,
                (e3) => {
                  if (e3) console.error('Copy users failed:', e3);

                  db.run(`DROP TABLE users_old`, (e4) => {
                    if (e4) console.error('Drop users_old failed:', e4);
                    return continueInit();
                  });
                }
              );
            } else {
              console.log('users_old hat nicht die passenden Spalten. Alte users werden nicht übernommen.');
              db.run(`DROP TABLE users_old`, () => continueInit());
            }
          });
        });
      } else {
        continueInit();
      }
    });
  });
}

initDb();

/* =========================
   AUTH ROUTES
========================= */
app.post('/auth/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'username und password sind Pflichtfelder.' });
  }
  if (username.length < 3) return res.status(400).json({ error: 'username muss mindestens 3 Zeichen haben.' });
  if (password.length < 6) return res.status(400).json({ error: 'password muss mindestens 6 Zeichen haben.' });

  const password_hash = hashPassword(password);

  db.run(
    `INSERT INTO users (username, password_hash) VALUES (?, ?)`,
    [username, password_hash],
    function (err) {
      if (err) {
        const msg = String(err.message || '');
        if (msg.includes('UNIQUE') && (msg.includes('users.username') || msg.includes('username'))) {
          return res.status(409).json({ error: 'Username ist schon vergeben.' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Registrierung fehlgeschlagen.' });
      }

      const token = makeToken();
      const userId = this.lastID;

      db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, userId], (sErr) => {
        if (sErr) {
          console.error(sErr);
          return res.status(500).json({ error: 'Session konnte nicht erstellt werden.' });
        }
        return res.json({ ok: true, token, user: { id: userId, username } });
      });
    }
  );
});

app.post('/auth/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) return res.status(400).json({ error: 'username und password sind Pflichtfelder.' });

  db.get(
    `SELECT id, username, password_hash FROM users WHERE username = ?`,
    [username],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB Fehler' });
      }
      if (!row) return res.status(401).json({ error: 'Login fehlgeschlagen.' });

      if (!verifyPassword(password, row.password_hash)) {
        return res.status(401).json({ error: 'Login fehlgeschlagen.' });
      }

      const token = makeToken();
      db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, row.id], (sErr) => {
        if (sErr) {
          console.error(sErr);
          return res.status(500).json({ error: 'Session konnte nicht erstellt werden.' });
        }
        return res.json({ ok: true, token, user: { id: row.id, username: row.username } });
      });
    }
  );
});

app.get('/auth/me', authRequired, (req, res) => {
  res.json({ ok: true, user: { id: req.user.id, username: req.user.username } });
});

app.post('/auth/logout', authRequired, (req, res) => {
  db.run(`DELETE FROM sessions WHERE token = ?`, [req.user.token], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Logout fehlgeschlagen.' });
    }
    return res.json({ ok: true });
  });
});

app.post('/auth/change-password', authRequired, (req, res) => {
  const oldPassword = String(req.body.oldPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Bitte altes und neues Passwort angeben.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben.' });
  }

  db.get(
    `SELECT id, password_hash FROM users WHERE id = ?`,
    [req.user.id],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB Fehler' });
      }
      if (!row) return res.status(404).json({ error: 'User nicht gefunden.' });

      if (!verifyPassword(oldPassword, row.password_hash)) {
        return res.status(401).json({ error: 'Altes Passwort ist falsch.' });
      }

      const newHash = hashPassword(newPassword);

      db.run(
        `UPDATE users SET password_hash = ? WHERE id = ?`,
        [newHash, req.user.id],
        (uErr) => {
          if (uErr) {
            console.error(uErr);
            return res.status(500).json({ error: 'Passwort konnte nicht geändert werden.' });
          }

          db.run(`DELETE FROM sessions WHERE user_id = ?`, [req.user.id], () => {
            return res.json({ ok: true });
          });
        }
      );
    }
  );
});

app.post('/me/delete', authRequired, (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ error: 'Passwort fehlt.' });

  // 1) Passwort checken
  db.get(
    `SELECT id, password_hash FROM users WHERE id = ?`,
    [req.user.id],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB Fehler' });
      }
      if (!row) return res.status(404).json({ error: 'User nicht gefunden.' });

      if (!verifyPassword(password, row.password_hash)) {
        return res.status(401).json({ error: 'Passwort ist falsch.' });
      }

      // 2) Alles löschen, was dem User gehört
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const continueAfterRatingsDeleted = () => {
          // Eigene Shops löschen
          db.run(`DELETE FROM shops WHERE owner_user_id = ? AND is_user_created = 1`, [req.user.id], (e1) => {
            if (e1) {
              console.error(e1);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Eigene Shops konnten nicht gelöscht werden.' });
            }

            // User löschen
            db.run(`DELETE FROM users WHERE id = ?`, [req.user.id], (e2) => {
              if (e2) {
                console.error(e2);
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'User konnte nicht gelöscht werden.' });
              }

              db.run('COMMIT', (e3) => {
                if (e3) {
                  console.error(e3);
                  return res.status(500).json({ error: 'Commit fehlgeschlagen.' });
                }
                return res.json({ ok: true });
              });
            });
          });
        };

        // Sessions killen
        db.run(`DELETE FROM sessions WHERE user_id = ?`, [req.user.id]);

        // Favoriten löschen
        db.run(`DELETE FROM favorites WHERE user_id = ?`, [req.user.id]);

        // Bewertungen des Users sauber "zurückrechnen" und danach löschen
        db.all(
          `SELECT shop_id, rating FROM shop_ratings WHERE user_id = ?`,
          [req.user.id],
          (rErr, rows) => {
            if (rErr) {
              console.error(rErr);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Bewertungen konnten nicht gelesen werden.' });
            }

            const ratings = Array.isArray(rows) ? rows : [];

            // 1) Für jeden betroffenen Shop: echte Werte holen -> in JS rechnen -> speichern
            const adjustNext = (i) => {
            if (i >= ratings.length) return deleteRatingsRows();

            const shopIdRaw = Number(ratings[i].shop_id);
            const rating = Number(ratings[i].rating);
            if (!Number.isFinite(shopIdRaw) || !Number.isFinite(rating)) return adjustNext(i + 1);

            // 1) Klon -> Original auflösen (damit du genau das updatest, was du im UI zeigst)
            db.get(
              `SELECT id, cloned_from_shop_id FROM shops WHERE id = ?`,
              [shopIdRaw],
              (mErr, mRow) => {
              if (mErr || !mRow) {
                console.error(mErr);
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Shop konnte nicht gelesen werden.' });
              }

            const targetShopId = (mRow.cloned_from_shop_id != null)
            ? Number(mRow.cloned_from_shop_id)
            : shopIdRaw;

            // 2) Jetzt echte Aggregatwerte vom TARGET-Shop holen
            db.get(
              `SELECT rating_sum, rating_count FROM shops WHERE id = ?`,
              [targetShopId],
              (gErr, shopRow) => {
              if (gErr || !shopRow) {
              console.error(gErr);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Shop-Daten konnten nicht gelesen werden.' });
            }

            const sum = Number(shopRow.rating_sum ?? 0);
            const count = Number(shopRow.rating_count ?? 0);

            // 3) Exakt “wie beim Hinzufügen”, nur rückwärts:
            const newCount = Math.max(count - 1, 0);
            const newSum = sum - rating;
            const safeSum = Number.isFinite(newSum) ? newSum : 0;

            const newAvg = newCount > 0 ? Math.round((safeSum / newCount) * 10) / 10 : 0;

            db.run(
              `UPDATE shops SET rating_sum = ?, rating_count = ?, rating = ? WHERE id = ?`,
              [safeSum, newCount, newAvg, targetShopId],
              (uErr) => {
                if (uErr) {
                  console.error(uErr);
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: 'Shop-Bewertungen konnten nicht aktualisiert werden.' });
                }
                return adjustNext(i + 1);
              }
            );
          }
        );
      }
    );
  };


            // 2) Dann erst die Bewertungen-Zeilen löschen
            const deleteRatingsRows = () => {
              db.run(
                `DELETE FROM shop_ratings WHERE user_id = ?`,
                [req.user.id],
                (dErr) => {
                  if (dErr) {
                    console.error(dErr);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Bewertungen konnten nicht gelöscht werden.' });
                  }

                  continueAfterRatingsDeleted();
                }
              );
            };

            // Starte das Zurückrechnen
            adjustNext(0);
          }
        );
      });
    }
  );
});

/* =========================
   FAVORITES (per user)
========================= */
app.get('/me/favorites', authRequired, (req, res) => {
  db.all(`SELECT shop_id FROM favorites WHERE user_id = ?`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB Fehler' });
    const ids = (rows || []).map(r => Number(r.shop_id)).filter(n => Number.isFinite(n));
    res.json({ ok: true, ids });
  });
});

app.post('/me/favorites/:shopId/toggle', authRequired, (req, res) => {
  const shopId = Number(req.params.shopId);
  if (!shopId) return res.status(400).json({ error: 'Ungültige Shop-ID' });

  const source = (req.body && req.body.source === 'community') ? 'community' : 'normal';

  db.get(
    `SELECT source FROM favorites WHERE user_id = ? AND shop_id = ?`,
    [req.user.id, shopId],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB Fehler' });

      if (row) {
        db.run(
          `DELETE FROM favorites WHERE user_id = ? AND shop_id = ?`,
          [req.user.id, shopId],
          (dErr) => {
            if (dErr) return res.status(500).json({ error: 'DB Fehler' });
            return res.json({ ok: true, is_fav: false });
          }
        );
      } else {
        db.run(
          `INSERT INTO favorites (user_id, shop_id, source) VALUES (?, ?, ?)`,
          [req.user.id, shopId, source],
          (iErr) => {
            if (iErr) return res.status(500).json({ error: 'DB Fehler' });
            return res.json({ ok: true, is_fav: true });
          }
        );
      }
    }
  );
});

/**
 * GET /me/favorites/shops
 * - liefert Favoriten als Shop-Liste, inkl. f.source
 * - zeigt auch Community-Shops, die NICHT in /shops auftauchen
 * - nutzt effektive Rating-Werte (Klon -> Original)
 */
app.get('/me/favorites/shops', authRequired, (req, res) => {
  const sql = `
    SELECT
      s.*,

      COALESCE(o.rating, s.rating) AS rating,
      COALESCE(o.rating_sum, s.rating_sum) AS rating_sum,
      COALESCE(o.rating_count, s.rating_count) AS rating_count,

      f.source AS fav_source,
      u.username AS owner_username,

      CASE
        WHEN s.is_user_created = 1
          AND s.owner_user_id IS NOT NULL
          AND s.owner_user_id <> ?
          AND EXISTS (
            SELECT 1 FROM shops mine
            WHERE mine.owner_user_id = ?
              AND mine.is_user_created = 1
              AND mine.cloned_from_shop_id = s.id
          )
        THEN 1 ELSE 0
      END AS is_added

    FROM favorites f
    JOIN shops s ON s.id = f.shop_id
    LEFT JOIN shops o ON o.id = s.cloned_from_shop_id
    LEFT JOIN users u ON u.id = s.owner_user_id
    WHERE f.user_id = ?
    ORDER BY datetime(f.created_at) DESC
  `;

  // 3 Platzhalter: owner<>?, owner=?, f.user_id=?
  db.all(sql, [req.user.id, req.user.id, req.user.id], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB Fehler' });
    }
    res.json(rows || []);
  });
});

/**
 * GET /me/ratings/shops
 * - liefert alle Shops, die der User bewertet hat (auch Community-Originale),
 *   unabhängig davon, ob ein Klon existiert oder gelöscht wurde
 */
app.get('/me/ratings/shops', authRequired, (req, res) => {
  const sql = `
    SELECT
      s.*,
      r.rating AS my_rating
    FROM shop_ratings r
    JOIN shops s ON s.id = r.shop_id
    WHERE r.user_id = ?
    ORDER BY datetime(r.updated_at) DESC
  `;

  db.all(sql, [req.user.id], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB Fehler' });
    }
    res.json(rows || []);
  });
});

/* =========================
   SHOPS
========================= */
app.get('/shops', authOptional, (req, res) => {
  const { chicken, steak, hack, minRating } = req.query;

  const where = [];
  const whereParams = [];

  const hasUser = !!req.user;

  // Sichtbarkeit
  if (hasUser) {
    where.push('(s.is_user_created = 0 OR s.owner_user_id = ?)');
    whereParams.push(req.user.id);
  } else {
    where.push('s.is_user_created = 0');
  }

  if (chicken === '1') where.push('s.chicken = 1');
  if (steak === '1') where.push('s.steak = 1');
  if (hack === '1') where.push('s.hack = 1');

  // Filter auf effektive Bewertung
  if (minRating !== undefined && minRating !== '') {
    where.push('COALESCE(o.rating, s.rating) >= ?');
    whereParams.push(Number(minRating));
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  let sql;
  let finalParams;

  if (hasUser) {
    sql = `
      SELECT
        s.*,

        COALESCE(o.rating, s.rating) AS rating,
        COALESCE(o.rating_sum, s.rating_sum) AS rating_sum,
        COALESCE(o.rating_count, s.rating_count) AS rating_count,

        (
          SELECT r.rating
          FROM shop_ratings r
          WHERE r.user_id = ?
            AND r.shop_id = COALESCE(s.cloned_from_shop_id, s.id)
        ) AS my_rating

      FROM shops s
      LEFT JOIN shops o ON o.id = s.cloned_from_shop_id
      ${whereSql}
      ORDER BY COALESCE(o.rating, s.rating) DESC
    `;

    // 1 Param für Subquery (r.user_id) + danach WHERE-Params
    finalParams = [req.user.id, ...whereParams];
  } else {
    sql = `
      SELECT
        s.*,

        COALESCE(o.rating, s.rating) AS rating,
        COALESCE(o.rating_sum, s.rating_sum) AS rating_sum,
        COALESCE(o.rating_count, s.rating_count) AS rating_count

      FROM shops s
      LEFT JOIN shops o ON o.id = s.cloned_from_shop_id
      ${whereSql}
      ORDER BY COALESCE(o.rating, s.rating) DESC
    `;

    finalParams = [...whereParams];
  }

  db.all(sql, finalParams, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB Fehler' });
    }
    res.json(rows || []);
  });
});

/**
 * GET /shops/top?limit=3
 * Top-Döner: global (für alle User gleich), nur öffentliche Original-Shops
 */
app.get('/shops/top', (req, res) => {
  const limit = Math.max(1, Math.min(10, Number(req.query.limit || 3)));

  const sql = `
    SELECT
      s.*,
      s.rating AS rating,
      s.rating_sum AS rating_sum,
      s.rating_count AS rating_count
    FROM shops s
    WHERE s.is_user_created = 0
      AND s.cloned_from_shop_id IS NULL
    ORDER BY
      (s.rating IS NULL) ASC,
      s.rating DESC,
      COALESCE(s.rating_count, 0) DESC,
      s.id ASC
    LIMIT ?
  `;

  db.all(sql, [limit], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB Fehler' });
    }
    res.json(rows || []);
  });
});

/* --- Kostenloses Geocoding via OpenStreetMap Nominatim --- */
async function geocodeBerlinAddress(address) {
  const q = `${address}, Berlin, Deutschland`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;

  const r = await fetchFn(url, {
    headers: { 'User-Agent': 'KebapMaps/1.0 (Student Project)' }
  });

  if (!r.ok) return null;
  const data = await r.json();
  if (!data || !data.length) return null;

  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}

function normalizePricesInput(prices) {
  if (!Array.isArray(prices)) return [];

  return prices
    .map(entry => {
      // Neues Format: { label, price }
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const label = String(entry.label || '').trim();
        const priceNum = Number(
          String(entry.price ?? '')
            .replace(',', '.')
            .replace(/[^\d.]/g, '')
        );

        if (!label) return null;

        return {
          label,
          price: Number.isFinite(priceNum) ? priceNum : null
        };
      }

      // Altes Format: "Döner: 7,50 €"
      if (typeof entry === 'string') {
        const text = entry.trim();
        if (!text) return null;

        const match = text.match(/^(.+?)\s*[:\-]\s*([\d.,]+)\s*(?:€|eur)?$/i);

        if (match) {
          return {
            label: match[1].trim(),
            price: Number(match[2].replace(',', '.'))
          };
        }

        return {
          label: text,
          price: null
        };
      }

      return null;
    })
    .filter(Boolean);
}

/**
 * POST /shops (nur eingeloggt)
 */
app.post('/shops', authRequired, async (req, res) => {
  try {
    const { name, address, wait_time, rating, prices, lat, lng, meatType } = req.body;

    if (!name || !address || !wait_time || rating === undefined) {
      return res.status(400).json({ error: 'name, address, wait_time, rating sind Pflichtfelder.' });
    }

    if (!meatType || !['chicken', 'steak', 'hack'].includes(meatType)) {
      return res.status(400).json({ error: 'meatType ist Pflicht und muss chicken/steak/hack sein.' });
    }

    const ratingNum = Number(rating);
    if (Number.isNaN(ratingNum) || ratingNum < 0.5 || ratingNum > 5.0) {
      return res.status(400).json({ error: 'rating muss zwischen 0.5 und 5.0 liegen.' });
    }

    // lat/lng vom Frontend bevorzugen (Autocomplete)
    let finalLat = Number(lat);
    let finalLng = Number(lng);

    if (!Number.isFinite(finalLat) || !Number.isFinite(finalLng)) {
      const geo = await geocodeBerlinAddress(address);
      if (!geo) return res.status(400).json({ error: 'Adresse konnte nicht gefunden werden. Bitte genauer eingeben.' });
      finalLat = geo.lat;
      finalLng = geo.lng;
    }

    const pricesArr = normalizePricesInput(prices);
    const pricesJson = JSON.stringify(pricesArr);

    const chicken = meatType === 'chicken' ? 1 : 0;
    const steak = meatType === 'steak' ? 1 : 0;
    const hack = meatType === 'hack' ? 1 : 0;

    const rating_sum = ratingNum;
    const rating_count = 1;

    const sql = `
      INSERT INTO shops (
        name, address, district, lat, lng,
        rating, wait_time,
        chicken, steak, hack,
        prices_json,
        is_user_created,
        rating_sum, rating_count,
        owner_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      String(name).trim(),
      String(address).trim(),
      '',
      finalLat,
      finalLng,
      ratingNum,
      String(wait_time).trim(),
      chicken,
      steak,
      hack,
      pricesJson,
      1,
      rating_sum,
      rating_count,
      req.user.id
    ];

    db.run(sql, params, function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'DB Insert fehlgeschlagen' });
      }
      res.json({ ok: true, id: this.lastID, lat: finalLat, lng: finalLng });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.put('/shops/:id', authRequired, async (req, res) => {
  try {
    const shopId = Number(req.params.id);
    const address = String(req.body.address || '').trim();
    const wait_time = String(req.body.wait_time || '').trim();
    const prices = req.body.prices;
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!Number.isFinite(shopId)) {
      return res.status(400).json({ error: 'Ungültige Shop-ID.' });
    }

    if (!address || !wait_time) {
      return res.status(400).json({ error: 'Adresse und Wartezeit sind Pflichtfelder.' });
    }

    db.get(
      `SELECT * FROM shops WHERE id = ? AND is_user_created = 1 AND owner_user_id = ?`,
      [shopId, req.user.id],
      async (err, shop) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'DB Fehler.' });
        }

        if (!shop) {
          return res.status(403).json({ error: 'Du darfst nur deine eigenen Läden bearbeiten.' });
        }

        let finalLat = Number(shop.lat);
        let finalLng = Number(shop.lng);

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          finalLat = lat;
          finalLng = lng;
        } else if (address !== String(shop.address || '').trim()) {
          const geo = await geocodeBerlinAddress(address);
          if (!geo) {
            return res.status(400).json({ error: 'Adresse konnte nicht gefunden werden. Bitte genauer eingeben.' });
          }
          finalLat = geo.lat;
          finalLng = geo.lng;
        }

        const pricesArr = normalizePricesInput(prices);
        const pricesJson = JSON.stringify(pricesArr);

        db.run(
          `
            UPDATE shops
            SET address = ?, wait_time = ?, lat = ?, lng = ?, prices_json = ?
            WHERE id = ? AND owner_user_id = ?
          `,
          [address, wait_time, finalLat, finalLng, pricesJson, shopId, req.user.id],
          function (updateErr) {
            if (updateErr) {
              console.error(updateErr);
              return res.status(500).json({ error: 'Shop konnte nicht aktualisiert werden.' });
            }

            return res.json({
              ok: true,
              id: shopId,
              address,
              wait_time,
              lat: finalLat,
              lng: finalLng,
              prices_json: pricesJson
            });
          }
        );
      }
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Serverfehler.' });
  }
});

/**
 * POST /shops/:id/rate
 * - Wenn der Shop ein Klon von mir ist -> Bewertung auf Original schreiben
 */
app.post('/shops/:id/rate', authRequired, (req, res) => {
  const requestedShopId = Number(req.params.id);
  const newRating = Number(req.body.rating);

  if (!requestedShopId) return res.status(400).json({ error: 'Ungültige Shop-ID' });
  if (!Number.isFinite(newRating) || newRating < 0.5 || newRating > 5) {
    return res.status(400).json({ error: 'rating muss zwischen 0.5 und 5.0 liegen.' });
  }

  db.get(
    `SELECT id, owner_user_id, is_user_created, cloned_from_shop_id FROM shops WHERE id = ?`,
    [requestedShopId],
    (e0, row0) => {
      if (e0) return res.status(500).json({ error: 'DB Fehler' });
      if (!row0) return res.status(404).json({ error: 'Shop nicht gefunden' });

      const isMyClone =
        Number(row0.is_user_created) === 1 &&
        Number(row0.owner_user_id) === Number(req.user.id) &&
        row0.cloned_from_shop_id != null;

      const targetShopId = isMyClone ? Number(row0.cloned_from_shop_id) : requestedShopId;

      db.get(
        `SELECT id, rating_sum, rating_count FROM shops WHERE id = ?`,
        [targetShopId],
        (err, shopRow) => {
          if (err) return res.status(500).json({ error: 'DB Fehler' });
          if (!shopRow) return res.status(404).json({ error: 'Shop nicht gefunden' });

          db.get(
            `SELECT rating FROM shop_ratings WHERE user_id = ? AND shop_id = ?`,
            [req.user.id, targetShopId],
            (rErr, rRow) => {
              if (rErr) return res.status(500).json({ error: 'DB Fehler' });

              const previous = rRow ? Number(rRow.rating) : null;

              const sum = Number(shopRow.rating_sum ?? 0);
              const count = Number(shopRow.rating_count ?? 0);

              let newSum = sum;
              let newCount = count;

              if (previous == null) {
                newSum = sum + newRating;
                newCount = count + 1;
              } else {
                newSum = sum + (newRating - previous);
                newCount = count;
              }

              const avg = newCount > 0 ? (newSum / newCount) : newRating;
              const avgRounded = Math.round(avg * 10) / 10;

              db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run(
                  `
                    INSERT INTO shop_ratings (user_id, shop_id, rating, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id, shop_id) DO UPDATE SET
                      rating = excluded.rating,
                      updated_at = CURRENT_TIMESTAMP
                  `,
                  [req.user.id, targetShopId, newRating],
                  (upErr) => {
                    if (upErr) {
                      db.run('ROLLBACK');
                      console.error(upErr);
                      return res.status(500).json({ error: 'Bewertung konnte nicht gespeichert werden.' });
                    }

                    db.run(
                      `UPDATE shops SET rating_sum = ?, rating_count = ?, rating = ? WHERE id = ?`,
                      [newSum, newCount, avgRounded, targetShopId],
                      (sErr) => {
                        if (sErr) {
                          db.run('ROLLBACK');
                          console.error(sErr);
                          return res.status(500).json({ error: 'Shop-Ø konnte nicht aktualisiert werden.' });
                        }

                        db.run('COMMIT', (cErr) => {
                          if (cErr) {
                            console.error(cErr);
                            return res.status(500).json({ error: 'Commit fehlgeschlagen.' });
                          }

                          return res.json({
                            ok: true,
                            rating: avgRounded,
                            my_rating: newRating,
                            target_shop_id: targetShopId
                          });
                        });
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    }
  );
});

/**
 * DELETE /shops/:id
 * - nur eingeloggt
 * - nur user-created
 * - nur Owner
 */
app.delete('/shops/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Ungültige ID' });

  db.get(
    `SELECT is_user_created, owner_user_id FROM shops WHERE id = ?`,
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB Fehler' });
      if (!row) return res.status(404).json({ error: 'Shop nicht gefunden' });

      if (Number(row.is_user_created) !== 1) {
        return res.status(403).json({ error: 'Dieser Shop darf nicht gelöscht werden.' });
      }
      if (Number(row.owner_user_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Du darfst nur deine eigenen Shops löschen.' });
      }

      db.run(`DELETE FROM shops WHERE id = ?`, [id], function (delErr) {
        if (delErr) return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
        return res.json({ ok: true });
      });
    }
  );
});

/**
 * GET /community/shops
 * - nur user-created Shops von ANDEREN
 * - owner_username + is_fav + is_added
 */
app.get('/community/shops', authOptional, (req, res) => {
  const hasUser = !!req.user;
  const me = hasUser ? req.user.id : null;

  const sql = hasUser
    ? `
      SELECT
        s.*,
        u.username AS owner_username,
        EXISTS(
          SELECT 1 FROM favorites f
          WHERE f.user_id = ? AND f.shop_id = s.id
        ) AS is_fav,
        CASE
          WHEN s.owner_user_id = ? THEN 1 ELSE 0
        END AS is_own,
        CASE
          WHEN s.owner_user_id = ? THEN 1
          WHEN EXISTS(
            SELECT 1 FROM shops mine
            WHERE mine.owner_user_id = ?
              AND mine.is_user_created = 1
              AND mine.cloned_from_shop_id = s.id
          ) THEN 1
          ELSE 0
        END AS is_added
      FROM shops s
      JOIN users u ON u.id = s.owner_user_id
      WHERE s.is_user_created = 1
        AND s.owner_user_id IS NOT NULL
        AND s.cloned_from_shop_id IS NULL
      ORDER BY datetime(s.created_at) DESC, s.id DESC
    `
    : `
      SELECT
        s.*,
        u.username AS owner_username,
        0 AS is_fav,
        0 AS is_own,
        0 AS is_added
      FROM shops s
      JOIN users u ON u.id = s.owner_user_id
      WHERE s.is_user_created = 1
        AND s.owner_user_id IS NOT NULL
        AND s.cloned_from_shop_id IS NULL
      ORDER BY datetime(s.created_at) DESC, s.id DESC
    `;

  const params = hasUser ? [me, me, me, me] : [];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB Fehler' });
    }
    res.json(rows || []);
  });
});

/**
 * GET /shops/:id/ratings
 * - Liste der Bewertungen anderer Nutzer (wenn eingeloggt: ohne eigene)
 */
app.get('/shops/:id/ratings', authOptional, (req, res) => {
  const shopId = Number(req.params.id);
  if (!shopId) return res.status(400).json({ error: 'Ungültige Shop-ID' });

  const hasUser = !!req.user;
  const me = hasUser ? req.user.id : null;

  const sql = hasUser
    ? `
      SELECT u.username, r.rating, r.updated_at
      FROM shop_ratings r
      JOIN users u ON u.id = r.user_id
      WHERE r.shop_id = ? AND r.user_id <> ?
      ORDER BY datetime(r.updated_at) DESC
      LIMIT 50
    `
    : `
      SELECT u.username, r.rating, r.updated_at
      FROM shop_ratings r
      JOIN users u ON u.id = r.user_id
      WHERE r.shop_id = ?
      ORDER BY datetime(r.updated_at) DESC
      LIMIT 50
    `;

  const params = hasUser ? [shopId, me] : [shopId];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'DB Fehler' });
    }
    res.json({ ok: true, ratings: rows || [] });
  });
});

/**
 * POST /shops/:id/clone
 * body:
 * - keepFavorite: boolean (wenn true => neuer Shop wird als Favorit gespeichert)
 * - fromFavoriteSource: 'community' | 'normal'
 */
app.post('/shops/:id/clone', authRequired, (req, res) => {
  const shopId = Number(req.params.id);
  if (!shopId) return res.status(400).json({ error: 'Ungültige Shop-ID' });

  const keepFavorite = !!req.body?.keepFavorite;
  const fromFavoriteSource = (req.body?.fromFavoriteSource === 'community') ? 'community' : 'normal';

  db.get(`SELECT * FROM shops WHERE id = ?`, [shopId], (err, s) => {
    if (err) return res.status(500).json({ error: 'DB Fehler' });
    if (!s) return res.status(404).json({ error: 'Shop nicht gefunden' });

    const sql = `
      INSERT INTO shops (
        name, address, district, lat, lng,
        rating, wait_time,
        chicken, steak, hack,
        prices_json,
        is_user_created,
        rating_sum, rating_count,
        owner_user_id,
        cloned_from_shop_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const rating = Number(s.rating) || 0;

    const params = [
      s.name, s.address, s.district || '',
      s.lat, s.lng,
      rating, s.wait_time || '',
      s.chicken || 0, s.steak || 0, s.hack || 0,
      s.prices_json || null,
      1,
      rating, 1,
      req.user.id,
      shopId
    ];

    db.run(sql, params, function (insErr) {
      if (insErr) {
        console.error(insErr);
        return res.status(500).json({ error: 'Kopieren fehlgeschlagen' });
      }

      const newId = this.lastID;

      const done = () => res.json({ ok: true, newId });

      const cleanupCommunity = () => {
        if (fromFavoriteSource !== 'community') return done();
        db.run(
          `DELETE FROM favorites WHERE user_id = ? AND shop_id = ? AND source = 'community'`,
          [req.user.id, shopId],
          () => done()
        );
      };

      const addNewFavorite = () => {
        if (!keepFavorite) return cleanupCommunity();
        db.run(
          `INSERT OR IGNORE INTO favorites (user_id, shop_id, source) VALUES (?, ?, 'normal')`,
          [req.user.id, newId],
          () => cleanupCommunity()
        );
      };

      addNewFavorite();
    });
  });
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
