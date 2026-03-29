# Kebap-Maps
README – Kebap Maps

==================================================
PROJEKTÜBERSICHT
==================================================

Kebap Maps ist eine lokale Webanwendung zur Suche, Anzeige, Bewertung und Verwaltung von Dönerläden.
Die Website besteht aus einem Frontend, einem Backend und einer lokalen SQLite-Datenbank.

Die Anwendung wird lokal auf dem eigenen Rechner ausgeführt.
Damit alle Funktionen korrekt nutzbar sind, muss das Backend gestartet werden, bevor das Frontend im Browser geöffnet wird.

Bitte die Website über Google Chrome oder Mozilla Firefox testen.

==================================================
TECHNISCHER AUFBAU
==================================================

Frontend:
- HTML
- CSS
- JavaScript
- Vue 3

Backend:
- Node.js
- Express

Datenbank:
- SQLite

Verwendete Libraries / Pakete:
- Express
- sqlite3
- cors
- Leaflet

==================================================
PROJEKTSTRUKTUR
==================================================

Das Projekt ist in Frontend und Backend aufgeteilt.

Frontend:
- index.html
  Enthält die Struktur und die sichtbare Benutzeroberfläche der Website.
- style.css
  Enthält das Design, Layout und Styling.
- script.js
  Enthält die Frontend-Logik, Benutzerinteraktionen und die Kommunikation mit dem Backend.

Backend:
- server.js
  Startet den lokalen Server und stellt die API für das Frontend bereit.
- seed.js
  Optionales Skript zum Befüllen oder Zurücksetzen der Datenbank.
- db.js
  Enthält die Datenbankanbindung und Datenbanklogik.
- kebapmaps.db
  SQLite-Datenbankdatei mit den gespeicherten Daten.

==================================================
FUNKTIONSUMFANG DER WEBSITE
==================================================

Die Website bietet unter anderem folgende Funktionen:

Allgemein:
- lokale Webanwendung mit eigener Benutzeroberfläche
- Navigation zwischen verschiedenen Ansichten
- strukturierte Darstellung von Shop-Informationen

Kartenfunktionen:
- interaktive Karte
- Anzeige von Dönerläden als Marker
- Auswahl eines Shops über die Karte
- Detailansicht zu ausgewählten Läden

Shop-Informationen:
- Name
- Adresse
- Preisangaben
- Wartezeit
- Fleischart
- Bewertungen
- Bildanzeige (bei selbst angelegten Läden immer gleich)

Suche und Filter:
- Suche nach Dönerläden
- Filterung nach bestimmten Eigenschaften
- schnellere Eingrenzung von Ergebnissen

Benutzerfunktionen:
- Registrierung
- Login
- Logout
- Passwort ändern
- Konto löschen

Favoriten:
- Shops als Favoriten speichern
- eigene Favoritenliste anzeigen
- Community-Merkliste / gemeinsame Favoritenbereiche

Eigene Einträge:
- neue Dönerläden hinzufügen
- eigene Einträge bearbeiten
- eigene Einträge löschen

Bewertungen / Community:
- Shops bewerten
- Bewertungen anzeigen
- Community-Einträge einsehen
- vorhandene Einträge übernehmen bzw. weiterverwenden

==================================================
VORAUSSETZUNGEN
==================================================

Für den lokalen Start des Projekts wird benötigt:
- Node.js
- npm

Download:
https://nodejs.org

Empfohlen wird die aktuelle LTS-Version.

Installation prüfen:
node -v
npm -v

Wenn beide Befehle eine Versionsnummer ausgeben, ist Node.js korrekt installiert.

==================================================
WICHTIGER HINWEIS ZUR NUTZUNG
==================================================

Das Backend muss gestartet sein, bevor die Datei index.html geöffnet wird.

Ohne laufenden Server funktionieren wichtige Teile der Website nicht korrekt, zum Beispiel:
- Login / Registrierung
- Laden von Shop-Daten
- Speichern neuer Einträge
- Bearbeiten und Löschen von Einträgen
- Bewertungen
- Favoriten
- Community-Funktionen

==================================================
ANLEITUNG ZUM START DES PROJEKTS
==================================================

1. Projekt entpacken
Zuerst die ZIP-Datei vollständig entpacken.

2. Backend-Ordner öffnen
Anschließend im Terminal in den Backend-Ordner wechseln.
Dort müssen sich die relevanten Backend-Dateien befinden, zum Beispiel:
- server.js
- seed.js
- package.json

3. Abhängigkeiten installieren
Falls noch kein node_modules-Ordner vorhanden ist, müssen die Abhängigkeiten installiert werden:

npm install

4. Seed-Skript ausführen (optional)
Falls die Datenbank neu befüllt oder vorbereitet werden soll:

node seed.js

Dieser Schritt ist optional und nur notwendig, wenn das Projekt mit Seed-Daten gestartet werden soll.

5. Server starten
Zum Starten des Backends:

node server.js

6. Frontend öffnen
Nachdem der Server läuft, die Datei index.html im Browser öffnen.

7. Server beenden
Zum Beenden des Servers im Terminal:
Windows:
Strg + C

macOS:
Ctrl + C

==================================================
START UNTER WINDOWS
==================================================

1. Terminal öffnen
Möglichkeiten:
- Eingabeaufforderung (CMD)
- PowerShell
- Im Explorer in den Projektordner gehen, dann Shift + Rechtsklick und „PowerShell hier öffnen“

2. In den Backend-Ordner wechseln
Beispiel:

cd pfad\zum\projektordner\backend

Wichtig:
In diesem Ordner müssen sich server.js, seed.js und package.json befinden.

3. Abhängigkeiten installieren

npm install

4. Optional: Seed-Skript ausführen

node seed.js

5. Server starten

node server.js

oder

npm start

6. Frontend öffnen
Anschließend die Datei index.html aus dem Frontend-Ordner im Browser öffnen.

Empfohlene Browser:
- Google Chrome
- Mozilla Firefox

7. Server beenden

Strg + C

==================================================
START UNTER macOS
==================================================

1. Terminal öffnen
Möglichkeiten:
- Programme → Dienstprogramme → Terminal
- Cmd + Leertaste → „Terminal“ eingeben

2. In den Backend-Ordner wechseln
Beispiel:

cd /pfad/zum/projektordner/backend

Tipp:
Der Ordner kann auch direkt in das Terminal gezogen werden, um den Pfad automatisch einzufügen.

3. Abhängigkeiten installieren

npm install

4. Optional: Seed-Skript ausführen

node seed.js

5. Server starten

node server.js

oder

npm start

6. Frontend öffnen
Danach die Datei index.html aus dem Frontend-Ordner im Browser öffnen.

Empfohlene Browser:
- Google Chrome
- Mozilla Firefox

7. Server beenden

Ctrl + C

==================================================
LOKALE SERVERADRESSE
==================================================

Wenn der Server erfolgreich gestartet wurde, läuft das Backend üblicherweise unter:

http://localhost:3000

Je nach Projektkonfiguration kann diese Adresse leicht abweichen, standardmäßig wird jedoch localhost mit Port 3000 verwendet.

==================================================
HINWEISE BEI PROBLEMEN
==================================================

Falls das Projekt nicht startet:
- prüfen, ob Node.js installiert ist
- prüfen, ob npm install erfolgreich ausgeführt wurde
- prüfen, ob der richtige Ordner geöffnet wurde
- prüfen, ob server.js im Backend-Ordner liegt
- prüfen, ob im Terminal Fehlermeldungen ausgegeben werden

Falls die Website geöffnet wird, aber Funktionen nicht arbeiten:
- prüfen, ob das Backend noch läuft
- prüfen, ob localhost:3000 erreichbar ist
- sicherstellen, dass index.html erst nach dem Start des Servers geöffnet wurde
