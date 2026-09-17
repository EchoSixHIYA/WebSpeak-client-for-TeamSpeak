# WebSpeak · Deutsch

[Projektstartseite](../README.md) · [简体中文](./README.zh-CN.md) · [English](./README.en.md) · [Русский](./README.ru.md) · [日本語](./README.ja.md)

WebSpeak ist ein selbst gehosteter Webclient und ein Sprach-Gateway für TeamSpeak 3 und TeamSpeak 6. Nutzer können ohne Desktop-Client im Browser Kanälen beitreten; Administratoren verwalten Zielserver, Zugriff und Laufzeitstatus über die Webkonsole.

## Live-Demo

Adresse: <https://webspeak.online>

Die öffentliche Demo läuft in Hongkong. Netzwerkbedingungen und Auslastung können instabil sein; Latenz, Verbindungsabbrüche oder kurze Ausfälle beschreiben nicht jede eigene Bereitstellung.

## ✨ Funktionen

| Funktion | Beschreibung |
| --- | --- |
| TeamSpeak-Kompatibilität | Unterstützt TeamSpeak 3 und TeamSpeak 6 und erkennt das Zielprotokoll automatisch. |
| IPv6-Ziele | IPv6-TeamSpeak-Ziele und über DNS aufgelöste IPv6-Adressen werden standardmäßig unterstützt. |
| Kanäle und Mitglieder | Kanalstruktur und aktuelle Mitglieder anzeigen und Kanäle wechseln. |
| Echtzeit-Sprache | Opus-Audio mit kompatiblem Transport und optional integriertem WebRTC für geringere Latenz. |
| Audiosteuerung | Mikrofon und Lautsprecher auswählen, Lautstärke regeln, testen, stummschalten, VOX und individuelle Mitgliedslautstärke. |
| Browserseitige Geräuschunterdrückung | Optionale Mikrofon-Geräuschunterdrückung in der Browseraufnahme, ohne zusätzliche serverseitige Audioverarbeitung. |
| Nachrichten und Aktionen | Kanal- und Serverchat, private Nachrichten, Anstupsen und Flüsterziele. |
| Desktop-Begleitton | Audio eines freigegebenen Fensters oder Browser-Tabs im aktuellen Kanal teilen. |
| Identität und Zugriff | Gespeicherte Identität, eigene Ziele und widerrufbare Einladungslinks mit Ablaufzeit. |
| Administration | Ziele, Zugriff, WebRTC, Relays, Einladungen, Sitzungen, Protokolle, Diagnosen und Backups verwalten. |
| Oberfläche | Chinesische, englische, deutsche, russische und japanische Oberfläche, helle/dunkle Designs sowie responsive Desktop-/Mobilansicht. |
| Selbsthosting | Daten bleiben beim Betreiber; Docker-, Windows-x64- und Linux-x64-Bereitstellung sind verfügbar. |

## 🖼️ Screenshots

Die Screenshots zeigen die deutsche Willkommensseite, den Sprachbereich, die Audiosteuerung und das Mitgliedermenü.

### Willkommensseite

<p align="center"><img src="./screenshots/webspeak-de-home.png" alt="WebSpeak deutsche Willkommensseite" width="100%" /></p>

### Sprachbereich

<p align="center"><img src="./screenshots/webspeak-de.png" alt="WebSpeak deutscher Sprachbereich" width="100%" /></p>

### Audiosteuerung

<p align="center"><img src="./screenshots/webspeak-de-audio.png" alt="WebSpeak deutsche Audiosteuerung" width="100%" /></p>

### Mitgliedermenü

<p align="center"><img src="./screenshots/webspeak-de-menu.png" alt="WebSpeak deutsches Mitgliedermenü" width="100%" /></p>

## 🧩 Erweiterte Funktionen

Diese Funktionen sind optional. Ohne sie arbeitet WebSpeak weiterhin mit dem kompatiblen Sprachtransport. Die Einstellungen befinden sich unter **Administration → Server** und gelten für neue Verbindungen.

### 1. WebRTC-Sprache mit niedriger Latenz

WebRTC verwendet für Browser-Sprache einen Echtzeit-Medienpfad und ermöglicht außerdem Desktop-Begleitton. Das aktuelle WebSpeak-Gateway stellt WebRTC selbst bereit; ein zusätzlicher Medienserver ist nicht erforderlich.

1. Unter `/admin` anmelden und auf der Seite **Server** die **Erweiterten Einstellungen** öffnen.
2. Bei deaktiviertem WebRTC Start- und Endport für UDP festlegen. Der Standardbereich ist `40000–40099`.
3. Den gesamten UDP-Bereich in Sicherheitsgruppe und Firewall des WebSpeak-Hosts freigeben.
4. **WebRTC** aktivieren und speichern. Nicht unterstützte Browser oder Netzwerke wechseln automatisch zum kompatiblen Transport.

Der Portbereich ist bei aktiviertem WebRTC gesperrt. Zum Ändern WebRTC zuerst deaktivieren und speichern, danach die Firewall-Regeln anpassen. Für öffentliche Bereitstellungen ist HTTPS erforderlich.

### 2. Relay-Modus

Ein Relay hilft, wenn ein TeamSpeak-Server Verbindungen aus einer anderen Region ablehnt oder der direkte Weg instabil ist. Es ist kein VPN, sondern leitet nur den TeamSpeak-Verkehr der aktuellen WebSpeak-Sitzung weiter.

Eine Relay-Instanz ist ein dedizierter Weiterleitungsdienst ohne Besucher- oder Administrationsseite. Sie akzeptiert nur Gateway-Sitzungen mit passendem Token. Ein zufälliges Token mit mindestens 16 Zeichen verwenden.

#### Aus dem Quellcode starten

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm run prepare:sdk
npm run build
WEBSPEAK_MODE=relay \
WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token' \
WEBSPEAK_RELAY_HOST='0.0.0.0' \
WEBSPEAK_RELAY_PORT='39087' \
node dist/index.js
```

Windows PowerShell:

```powershell
$env:WEBSPEAK_MODE = "relay"
$env:WEBSPEAK_RELAY_TOKEN = "replace-with-a-long-random-token"
$env:WEBSPEAK_RELAY_HOST = "0.0.0.0"
$env:WEBSPEAK_RELAY_PORT = "39087"
node .\dist\index.js
```

#### Aus einem Release-Paket starten

Das passende Paket aus den [Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest) herunterladen und entpacken:

```bash
# Linux
export WEBSPEAK_MODE=relay
export WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token'
export WEBSPEAK_RELAY_HOST='0.0.0.0'
export WEBSPEAK_RELAY_PORT='39087'
./runtime/node ./dist/index.js
```

Unter Windows PowerShell dieselben Variablen setzen und `.\runtime\node.exe .\dist\index.js` ausführen.

#### Mit Docker starten

```bash
docker run -d --name webspeak-relay --restart unless-stopped --network host \
  -e WEBSPEAK_MODE=relay \
  -e WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token' \
  -e WEBSPEAK_RELAY_PORT='39087' \
  ghcr.io/echosixhiya/webspeak:latest
```

Den UDP-Listening-Port des Relay-Hosts freigeben, standardmäßig `39087`.

#### Im Gateway aktivieren

1. **Administration → Server → Relay-Server** öffnen und einen oder mehrere Knoten hinzufügen.
2. Für jeden Knoten einen Anzeigenamen, einen Endpunkt wie `relay.example.com#39087` und das passende Token eintragen und speichern.
3. Besucher können auf der Willkommensseite Direktzugriff oder einen konfigurierten Relay-Knoten auswählen.

Relay deaktivieren und speichern, um die Option von der Willkommensseite zu entfernen.

### 3. Abhängigkeiten und Hinweise zur Herkunft

- Der Relay-Dienst ist Bestandteil von WebSpeak und verwendet Node.js-Standardbibliotheken; GOST, sing-box oder ein anderes Proxy-Framework werden nicht verwendet.
- WebRTC verwendet [werift](https://github.com/shinyoshiaki/werift-webrtc) `0.24.4`; das Upstream-Projekt steht unter MIT-Lizenz.
- Die TeamSpeak-Protokollverbindung verwendet den projektgepflegten [EchoSixHIYA/teamspeak-js](https://github.com/EchoSixHIYA/teamspeak-js)-SDK-Fork.

## 🧾 Änderungsprotokoll

| Version | Datum | Zusammenfassung |
| --- | --- | --- |
| [v0.2.2](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.2) | 2026-09-17 | Browserseitige Mikrofon-Geräuschunterdrückung, russische und japanische Oberfläche sowie sprachabhängige Begrüßungstexte ergänzt; Lautstärkeinteraktion und Fehlertexte/-codes auf Basis von PR #2 verbessert. |
| [v0.2.1](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.1) | 2026-09-13 | Verbindungsfehler auf der Willkommensseite verbessert, Fehlercodes erhalten und sicher gekürzt sowie IPv6-Ziele standardmäßig unterstützt. |
| [v0.2.0](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.0) | 2026-09-10 | Passwortabfrage, dedizierter Relay-Modus, Auswahl mehrerer Relays und Ursachendarstellung in der Administration ergänzt. |
| [v0.1.8](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.8) | 2026-09-08 | Docker-Bereitstellung vereinfacht, lokale TeamSpeak-Ziele unterstützt, 15-Sekunden-Timeout ergänzt und kontinuierliche Netzwerküberwachung eingeführt. |
| [v0.1.7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.7) | 2026-09-06 | Deutsch, Telegram, Netzwerkleistung und Gesamtlautstärke ergänzt; Lautstärkeschwankungen beim Begleitton behoben. |
| [v0.1.6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.6) | 2026-09-04 | Desktop-Begleitton, Hinweise zur gespeicherten Identität und Website-Symbol ergänzt; WebRTC-Mitgliederlautstärke korrigiert. |
| [v0.1.5](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.5) | 2026-09-04 | Identitätsspeicherung korrigiert und Designumschaltung verbessert. |
| [v0.1.4](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.4) | 2026-09-03 | WebRTC und Kanalchat korrigiert sowie Administration, Protokolle und Mobilansicht verbessert. |
| [v0.1.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.3) | 2026-09-03 | Integriertes WebRTC, aktualisiertes TeamSpeak-SDK und bessere Mitgliedersynchronisierung und Sprachpufferung. |

Vollständige Historie: [CHANGELOG.md](../CHANGELOG.md).

## 🚀 Bereitstellung

| Methode | Geeignet für | Umgebung |
| --- | --- | --- |
| Docker Compose (empfohlen) | Dauerbetrieb, einfache Updates und persistente Daten | Docker Engine + Docker Compose |
| Release-Paket | Betrieb ohne Node.js und Build-Werkzeuge | Windows x64 oder Linux x64 |
| Aus dem Quellcode | Entwicklung und Anpassungen | Node.js 22.5+, Git und native Build-Werkzeuge |

### Docker Compose (empfohlen)

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
docker compose pull
docker compose up -d
```

Nach dem Start ist WebSpeak unter `http://<dein-host>:3040` erreichbar. Bei einem Reverse Proxy auf diese Adresse zeigen; für WebRTC den im Adminbereich angezeigten UDP-Bereich freigeben. Die Daten liegen im Volume `webspeak-data`.

```bash
docker compose ps
docker compose logs -f webspeak
```

Upgrade:

```bash
git pull --ff-only
docker compose pull
docker compose up -d
```

`docker compose down -v` nicht ausführen, da dadurch Datenbank und Administratoreinstellungen gelöscht werden.

### Release-Paket

Das passende `windows-x64.zip` oder `linux-x64.tar.gz` aus den [GitHub Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest) herunterladen, in ein eigenes Verzeichnis entpacken und `start-webspeak.cmd` bzw. `./start-webspeak.sh` starten. Die Pakete enthalten Node.js und Produktionsabhängigkeiten.

### Aus dem Quellcode

```bash
git clone https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm run prepare:sdk
npm rebuild @discordjs/opus --foreground-scripts
npm --prefix web ci
npm --prefix web run build
npm run build
npm start
```

Für den Bau von `@discordjs/opus` werden Python, Make und eine C/C++-Toolchain benötigt.

### Erste Konfiguration

1. `http://<dein-host>:3040/admin` öffnen.
2. Mit `admin` / `admin` anmelden und sofort ein neues Passwort mit mindestens 12 Zeichen setzen.
3. Unter **Server** TeamSpeak-Ziel und Zugriffsmethode konfigurieren, zum Beispiel `voice.example.com#9987`.
4. Für öffentliche Nutzung HTTPS einrichten; bei aktiviertem WebRTC den im Adminbereich angezeigten UDP-Bereich freigeben.

## ⚠️ Voraussetzungen und Hinweise

| Bereich | Hinweis |
| --- | --- |
| Browser | Aktuelles Chrome, Edge oder ein moderner WebRTC-fähiger Browser wird empfohlen. Mikrofon- und Fenster-Audio benötigen normalerweise HTTPS. |
| TeamSpeak-Netzwerk | Der WebSpeak-Host muss den Zielserver erreichen können; der Standard-Sprachport ist `9987`. |
| Webnetzwerk | Der Dienst verwendet `3040/TCP`; öffentlich sollte ein HTTPS-Reverse-Proxy für Seite und WebSocket verwendet werden. |
| IPv6 | Literale Ziele als `[2001:db8::1]#9987` eintragen. Host/Container benötigen geroutetes IPv6, aktiviertes IPv6 in Betriebssystem und Node.js sowie passende Firewall-Regeln. |
| WebRTC | Standardbereich `40000–40099/UDP`; den gesamten Bereich freigeben und WebRTC vor einer Änderung deaktivieren. |
| Gespeicherte Identität | Eine Browseridentität kann nur eine aktive gespeicherte Verbindung halten. Für parallele Verbindungen deaktivieren oder ein anderes Browserprofil verwenden. |
| Begleitton | Nur auf dem Desktop verfügbar und WebRTC erforderlich. Bei Fenster- oder Tab-Freigabe auch Audio freigeben. |
| Daten | Docker verwendet `webspeak-data`; Release-Pakete und Quellcode verwenden `data/`. Vor Updates sichern. |
| Sitzungslimit | Eine Instanz akzeptiert bis zu 100 aktive Browser-Sitzungen. |
