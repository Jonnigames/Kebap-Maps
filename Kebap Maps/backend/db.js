const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(
  path.join(__dirname, 'kebapmaps.db'),
  (err) => {
    if (err) {
      console.error('DB Fehler:', err.message);
    } else {
      console.log('SQLite verbunden');

      // wichtig: Foreign Keys aktivieren
      db.run('PRAGMA foreign_keys = ON');
    }
  }
);

module.exports = db;
