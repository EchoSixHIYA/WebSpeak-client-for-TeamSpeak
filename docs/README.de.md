<a id="readme-top"></a>

<div align="center">
  <img src="./assets/webspeak-logo.png" alt="WebSpeak" width="88" />
  <h1>WebSpeak · Deutsch</h1>
  <p><strong>Deiner TeamSpeak-Community im Browser beitreten.</strong></p>
  <p><a href="../README.md">Projektstartseite</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.en.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.ja.md">日本語</a></p>
  <p>
    <a href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest"><img src="https://img.shields.io/github/v/release/EchoSixHIYA/WebSpeak-client-for-TeamSpeak?style=flat-square&amp;color=0f766e" alt="Release" /></a>
    <a href="../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-0f766e?style=flat-square" alt="AGPL-3.0-only" /></a>
  </p>
</div>

WebSpeak ist ein selbst gehosteter Browserclient und ein Sprach-Gateway für TeamSpeak 3 und TeamSpeak 6. Nutzer verwenden Sprache, Chat und Bildschirmfreigabe im Browser; Betreiber verwalten Zielserver, Zugriff und Daten über die Webkonsole.

Stabile Version: [Hinweise zu v0.2.9](#latest-release-notes) · [Pakete herunterladen](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest). Der Store für funktionale Plugins ist derzeit auf `dev` verfügbar und nicht in v0.2.9 enthalten.

[Live-Demo](#demo) · [Funktionen](#features) · [Screenshots](#screenshots) · [Bereitstellung](#deployment) · [Verwaltung](#administration) · [Erweiterte Einstellungen](#advanced) · [Skins & Plugins](#extensions) · [Problemlösung](#troubleshooting) · [Änderungsprotokoll](#changelog)

<a id="demo"></a>

## Live-Demo

- [Shanghai · shanghai.webspeak.online](https://shanghai.webspeak.online)
- [Hongkong · webspeak.online](https://webspeak.online)

Willkommensseite und Sprachbereich direkt ausprobieren. Netzwerk, Auslastung und Verfügbarkeit der Demo-Knoten können schwanken.

<a id="features"></a>

## Funktionen

| Funktion | Beschreibung |
| --- | --- |
| Echtzeit-Sprache | Opus, optionales WebRTC und WebSocket-Fallback; Stummschaltung, VOX, Geräteauswahl, Browser-Geräuschunterdrückung und Lautstärke je Mitglied. |
| Kanäle & Nachrichten | Kanalbaum und TeamSpeak-Trenner, Mitgliedsstatus, Kanalwechsel, Kanal-/Server-/Privatchat, Anstupsen, Flüstern und lokaler Chatverlauf. |
| Bildschirm & Audio | Bildschirmfreigabe zwischen Browsern und unterstützten nativen TeamSpeak-6-Clients mit Qualitäts-, Bitraten- und Statistikoptionen; Fenster-/Tab-Audio auf dem Desktop. |
| Identität & Verbindungen | Gespeicherte Identitäten, TS3-Identitätsimport/-export, Favoriten und Verlauf, SRV-/Nickname-Auflösung, IPv4/IPv6 und Einladungen. |
| Instanzverwaltung | Feste oder offene Ziele, Zugriffsregeln, Einladungen, Sitzungen, Logs, Diagnosen, Backups und optionale TeamSpeak-Verwaltung. |
| Skins & Oberfläche | Tag, Nacht, ILLUSIA und KAAK, `.wskin`-Pakete über GitHub, fünf Sprachen und responsive Ansichten. |
| Verteilte Sprache | Der Browser verbindet sich direkt mit dem gewählten Relay-Sprach-Gateway; die URL der Eingangsinstanz bleibt erhalten. |
| Bereitstellung | Docker amd64/arm64, Serverpakete für Windows x64 und Linux x64/ARM64 sowie Android-Vorschau-APKs. |

### TeamSpeak-Versionskompatibilität

Sprachverbindungen verwenden das TeamSpeak-Clientprotokoll und benötigen keine Query-Zugangsdaten. Die optionale TS-Verwaltung verwendet eigene WebQuery-/ServerQuery-Zugangsdaten.

- **TeamSpeak 3**: Die Erkennung wertet die führende `3.x`-Versionsnummer aus. Ältere Serverversionen sollten in der jeweiligen Umgebung geprüft werden, da nicht jede historische Version separat getestet wurde.
- **TeamSpeak 6**: Unterstützt, einschließlich Bildschirmfreigabe mit nativen TeamSpeak-6-Clients.
- **Automatische Erkennung**: Das Gateway liest die `version`-Antwort des Servers und hält das erkannte Protokoll in der Verbindungsdiagnose fest.
- Das Gateway verwendet das Upstream-SDK `1.0.0-beta.19` [`@honeybbq/teamspeak`](https://github.com/HoneyBBQ/teamspeak-js); WebSpeak richtet sich an TeamSpeak 3 und 6.

<a id="screenshots"></a>

## Screenshots

![WebSpeak · Sprachbereich](./screenshots/webspeak-de.png)

<details>
<summary>Willkommensseite, Audiosteuerung und Mitgliedermenü anzeigen</summary>

### Willkommensseite

![WebSpeak · Willkommensseite](./screenshots/webspeak-de-home.png)

### Audiosteuerung

![WebSpeak · Audiosteuerung](./screenshots/webspeak-de-audio.png)

### Mitgliedermenü

![WebSpeak · Mitgliedermenü](./screenshots/webspeak-de-menu.png)

</details>

<a id="deployment"></a>

## Bereitstellung & erste Konfiguration

Die Compose-Konfiguration verwendet `network_mode: host` für Linux-Docker-Hosts. Für einen Windows-Server das Release-Paket verwenden.

| Methode | Geeignet für | Umgebung |
| --- | --- | --- |
| Docker Compose (empfohlen) | Dauerbetrieb, einfache Updates und persistente Daten | Docker Engine + Docker Compose |
| Release-Paket | Betrieb ohne Node.js und Build-Werkzeuge | Windows x64 oder Linux x64/ARM64 |
| Aus dem Quellcode | Entwicklung und Anpassungen | Node.js 22.12+, Git und native Build-Werkzeuge |

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

Das passende `windows-x64.zip`, `linux-x64.tar.gz` oder `linux-arm64.tar.gz` aus den [GitHub Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest) herunterladen und den enthaltenen Starter ausführen. Die Pakete enthalten Node.js und Produktionsabhängigkeiten. Docker unterstützt amd64/arm64.

Android-APKs für `arm64-v8a`, `armeabi-v7a` und `x86_64` sind ebenfalls verfügbar. Sie sind für Tests per Sideload debug-signiert, keine Google-Play-Pakete; echte TeamSpeak-Sprachtests auf Geräten stehen noch aus.

### Aus dem Quellcode

```bash
git clone https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
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

### HTTPS & persistente Daten

Öffentliche Webseite und WebSocket über HTTPS bereitstellen. Beispielsweise die eigene Domain auf den Host zeigen lassen und Caddy als Reverse Proxy einrichten:

```caddyfile
webspeak.example.com {
  reverse_proxy 127.0.0.1:3040
}
```

Die Beispieldomain durch die eigene ersetzen. Ein erreichbarer Reverse Proxy oder Tunnel garantiert keine UDP-Medienverbindung; siehe [Erweiterte Einstellungen](#advanced). Release- und Quellcode-Installationen verwenden `data/`, Docker das Volume `webspeak-data`. Bei Backup und Umzug `webspeak.db` und den zugehörigen `master.key` gemeinsam aufbewahren.

<a id="administration"></a>

## Administration

Unter `/admin` werden Server, Zugriff, WebRTC, Relays, Einladungen, aktive Sitzungen, Logs und Backups verwaltet. Der Skin-Store liegt unter `/admin/skins`, der Store für funktionale Plugins (dev) unter `/admin/plugins`.

### Optionale TeamSpeak-Verwaltung

WebSpeak-Verwaltung und Sprachverbindungen sind davon unabhängig. Im Modus mit festem Server die TS-Verbindung unter `/admin/ts-admin` einrichten.

1. WebQuery auf dem TS-Server aktivieren und einen berechtigten TS-Administrator einen API-Schlüssel erstellen lassen. HTTP-/HTTPS-URL von WebQuery und Schlüssel eintragen. Gemeint ist der TS-Query-Dienst, nicht die WebSpeak-Webseite. Unterstützt werden TS3 ab 3.12 und TS6.
2. Virtuelle Server-ID `0` wählt anhand des festen Sprachports aus. Bei eingeschränkten Schlüsseln die freigegebene Server-ID eintragen. Änderungen erfordern einen schreibbaren Geltungsbereich und entsprechende TS-Rechte; Leseschlüssel dienen zur Anzeige.
3. Alternativ ServerQuery SSH oder bei TS3 ServerQuery TCP wählen. Query-Host (leer: festes Ziel), Query-Port, Benutzername und Passwort eintragen; SSH benötigt einen vertrauenswürdigen Hostschlüssel-Fingerabdruck. Dies ist kein SSH-Zugang zum Betriebssystem. TCP ist unverschlüsselt und nur für vertrauenswürdige Netze geeignet. HTTPS-Zertifikate müssen vom Gateway als vertrauenswürdig erkannt werden.
4. Speichern und verbinden oder aktualisieren. Verfügbar sind Servereinstellungen, Kanalverwaltung, Verschieben/Ausschließen/Sperren von Mitgliedern, Gruppenzuweisung und Entsperren. Aktionen benötigen Bestätigung und TS-Rechte; Listen werden manuell aktualisiert.

Zugangsdaten werden serverseitig verschlüsselt und nie von der API zurückgegeben. Datenbank und `master.key` gemeinsam sichern. Verbindungsfehler beeinflussen weder WebSpeak-Verwaltung noch Sprache. Sperren verwenden die Benutzer-UID, damit andere Nutzer derselben Gateway-IP nicht betroffen sind.

<a id="advanced"></a>

## Erweiterte Einstellungen

Diese Funktionen sind optional. Ohne sie arbeitet WebSpeak weiterhin mit dem kompatiblen Sprachtransport. Die Einstellungen befinden sich unter **Administration → Server** und gelten für neue Verbindungen.

### WebRTC-Sprache mit niedriger Latenz

WebRTC verwendet für Browser-Sprache einen Echtzeit-Medienpfad und ermöglicht außerdem Desktop-Begleitton. Das aktuelle WebSpeak-Gateway stellt WebRTC selbst bereit; ein zusätzlicher Medienserver ist nicht erforderlich.

1. Unter `/admin` anmelden und auf der Seite **Server** die **Erweiterten Einstellungen** öffnen.
2. Bei deaktiviertem WebRTC Start- und Endport für UDP festlegen. Der Standardbereich ist `40000–40099`.
3. Den gesamten UDP-Bereich in Sicherheitsgruppe und Firewall des WebSpeak-Hosts freigeben.
4. **WebRTC** aktivieren und speichern. Nicht unterstützte Browser oder Netzwerke wechseln automatisch zum kompatiblen Transport.

Der Portbereich ist bei aktiviertem WebRTC gesperrt. Zum Ändern WebRTC zuerst deaktivieren und speichern, danach die Firewall-Regeln anpassen. Für öffentliche Bereitstellungen ist HTTPS erforderlich.

### Sprach-WebRTC hinter Reverse Proxy oder TCP-Tunnel

Unter **Server → Erweiterte Einstellungen** die **öffentliche Medienadresse** als per UDP erreichbare IP oder Domain des Sprach-Gateways eintragen, ohne Schema, Pfad oder Port. Sie ersetzt die aus dem Webseitenaufruf abgeleitete Adresse. Ein Proxy-Hostname ist nicht automatisch eine erreichbare Medienadresse.

**IPv6-Kandidaten** sind optional und behalten IPv4 bei; IPv6-Routing und Firewall müssen passen. Als **Sprach-STUN** kann `stun:turn.teamspeak.com:3478` eingetragen werden. Browser und Gateway verwenden dann denselben Dienst. Leer behält das bisherige Verhalten bei: STUN des Gateway-SDKs, kein Browser-STUN. Zulässig sind IPv4-erreichbare UDP-STUN-Domains oder IPv4-Adressen, keine IPv6-Literale oder TURN-Zugangsdaten.

Speichern und neu verbinden. Den gesamten UDP-Portbereich öffnen und bei statischer Weiterleitung die Portnummern erhalten. STUN findet Adressabbildungen, leitet aber keine Audiodaten weiter. Ein reiner TCP-Tunnel ohne nutzbaren UDP-/IPv6-Pfad führt weiter zum kompatiblen Transport.

### ICE-Kandidaten für Bildschirmfreigabe

Die Medien der Bildschirmfreigabe versuchen weiterhin eine direkte Browser-zu-Browser-Verbindung; WebSpeak leitet nur die Signalisierung weiter. Standardmäßig werden die öffentlichen TeamSpeak-STUN-Dienste zur Ermittlung öffentlicher Kandidaten verwendet. STUN überträgt keine Medien. Ein autorisierter externer TURN-Dienst kann über `WEBSPEAK_SCREEN_SHARE_ICE_SERVERS` als JSON-Array konfiguriert werden, zum Beispiel:

```json
[{"urls":"stun:turn.teamspeak.com:3478"},{"urls":"turns:turn.example.com:5349","username":"<username>","credential":"<credential>"}]
```

Mit TURN kann die Medienübertragung diesen externen Dienst verwenden, aber niemals das WebSpeak-Gateway. Ohne TURN werden nur direkte ICE-Pfade und STUN verwendet.

### Plattformübergreifendes P2P-Bildschirmteilen

Browsernutzer und native TeamSpeak-6-Clients können Bildschirmfreigaben gegenseitig erkennen, starten und ansehen. Zwischen Browsern sowie zwischen Browser und nativem Client werden die Bildschirmmedien möglichst über eine direkte WebRTC/ICE-Peer-to-Peer-Verbindung übertragen; WebSpeak übernimmt Sitzungsberechtigung, Freigabestatus und SDP-/ICE-Signalisierung, transportiert aber keine Bildschirmmedien. Die Oberfläche zeigt Live-Status und Zuschauerzahl und bietet Lautstärke-, Vollbild- und Beenden-Steuerung. Für die Aufnahme stehen bis zu 1080p und 60 FPS sowie WebRTC-Statistiken zur Verfügung.

### Relay-Modus

Ein Relay hilft, wenn ein TeamSpeak-Server Verbindungen aus einer anderen Region ablehnt oder der direkte Weg instabil ist. Es ist kein VPN, sondern leitet nur den TeamSpeak-Verkehr der aktuellen WebSpeak-Sitzung weiter.

Eine Relay-Instanz betreibt sowohl die ältere UDP-Kompatibilitätsweiterleitung als auch ein separates Sprach-Gateway, jedoch keine Besucher- oder Administrationsseite. Das Eingangs-Gateway signiert mit dem gemeinsamen Token ein einmaliges Sprach-Ticket und delegiert es; anschließend verbindet sich der Browser direkt mit dem Relay, das seinerseits TeamSpeak erreicht. Die Seite bleibt unter der URL des Eingangs-Gateways. Ein zufälliges Token mit mindestens 16 Zeichen verwenden.

<details>
<summary>Start- und Konfigurationsbeispiele für Relays anzeigen</summary>

#### Aus dem Quellcode starten

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm rebuild @discordjs/opus --foreground-scripts
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

Das Sprach-Gateway lauscht standardmäßig auf `127.0.0.1:3041`. Eine HTTPS-Domain für das Relay einrichten und sie mit Caddy oder einem vergleichbaren Proxy an `127.0.0.1:3041` weiterleiten, zum Beispiel:

```caddyfile
relay.example.com {
  reverse_proxy 127.0.0.1:3041
}
```

In den Relay-Einstellungen des Eingangs-Gateways als **Voice gateway address** diesen HTTPS-Ursprung eintragen, etwa `https://relay.example.com`. Die Seite bleibt auf ihrem ursprünglichen Gateway und öffnet danach eine WSS-Verbindung zum Relay. WebRTC ist auf dem Relay standardmäßig aktiviert. Zusätzlich UDP `40000-40099` freigeben und `WEBSPEAK_RELAY_WEBRTC_PUBLIC_HOST` auf eine öffentliche Relay-IP oder direkt erreichbare Domain setzen. Bei geänderter WebRTC-Portspanne auch die Firewall anpassen. UDP `39087` für ältere Kompatibilitätsweiterleitungen offen lassen.

#### Im Gateway aktivieren

1. **Administration → Server → Relay-Server** öffnen und einen oder mehrere Knoten hinzufügen.
2. Anzeigename, UDP-Endpunkt wie `relay.example.com#39087`, HTTPS-Ursprung des Sprach-Gateways wie `https://relay.example.com` und das passende Token eintragen und speichern.
3. Besucher können auf der Willkommensseite Direktzugriff oder einen konfigurierten Relay-Knoten auswählen.

Relay deaktivieren und speichern, um die Option von der Willkommensseite zu entfernen.

</details>

### Abhängigkeiten und Hinweise zur Herkunft

- Der Relay-Dienst ist Bestandteil von WebSpeak und verwendet Node.js-Standardbibliotheken; GOST, sing-box oder ein anderes Proxy-Framework werden nicht verwendet.
- WebRTC verwendet [werift](https://github.com/shinyoshiaki/werift-webrtc) `0.24.4`; das Upstream-Projekt steht unter MIT-Lizenz.
- TeamSpeak verwendet das Upstream-Paket [HoneyBBQ/teamspeak-js](https://github.com/HoneyBBQ/teamspeak-js) `@honeybbq/teamspeak@1.0.0-beta.19`; ein eigener SDK-Fork muss nicht gebaut werden.

<a id="extensions"></a>

## Skins & funktionale Plugins

### Skin-Pakete `.wskin`

Skins gestalten Aussehen, Layout und zugehörige Widgets. Administratoren installieren, aktivieren und wählen den Standard-Skin. Autoren verwenden öffentliche Schnittstellen ohne Änderungen am WebSpeak-Quellcode.

[Entwicklungsleitfaden](./SKIN_DEVELOPMENT.md) · [Agent Skill](../.agents/skills/webspeak-skin-development/SKILL.md) · [Skin-Katalog](https://github.com/Huddle-Up-Forge/webspeak-skins) · [Discord-Voice-Beispiel](https://github.com/Huddle-Up-Forge/webspeak-skin-discord-voice)

### Funktionale Plugins `.wplugin` (dev)

Funktionale Plugins sind unabhängige Anwendungen mit Browserfunktionen und optionalen Node-Backends, eigenen Routen, Daten und Zusammenarbeit. Administratoren prüfen Code und Abhängigkeiten vor der Aktivierung; Updates erfordern erneutes Vertrauen. Anwendungen unterstützen TS-Server- oder Instanz-Bereiche und eine separate Origin. API v2 benötigt die aktuelle dev-Version und ist nicht in v0.2.9 enthalten.

[Entwicklungsleitfaden](./PLUGIN_DEVELOPMENT.md) · [Agent Skill](../.agents/skills/webspeak-plugin-development/SKILL.md) · [Verteilungskatalog & Beispiel](https://github.com/Huddle-Up-Forge/webspeak-plugin)

<a id="troubleshooting"></a>

## Problemlösung

| Symptom | Prüfen |
| --- | --- |
| WebRTC fällt trotz Aktivierung zurück | Fehlercode im Sprachstatus, HTTPS, vollständigen UDP-Portbereich und öffentliche Medienadresse prüfen. Ein TCP-Tunnel transportiert diese UDP-Medien nicht. |
| Ziel wird als lokale Adresse blockiert | Der offene Modus beschränkt Loopback-/Privatadressen. Für einen TS-Server auf demselben Host den administrativ konfigurierten festen Servermodus verwenden. |
| Bildschirmfreigabe läuft ab oder bleibt schwarz | Sie verwendet eine eigene WebRTC-Verbindung. Aushandlung, ICE und Codec-Statistik prüfen; verbundenes Sprach-WebRTC bestätigt nicht die Bildschirmverbindung. |
| Daten fehlen oder lassen sich nach dem Update nicht entschlüsseln | Dasselbe Datenverzeichnis bzw. Volume mit passendem `master.key` verwenden. Nicht mit `docker compose down -v` aktualisieren. |

### ⚠️ Voraussetzungen und Hinweise

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
| Sitzungslimit | Bis zu 100 aktive Browser-Sitzungen pro Instanz; dies ist ein Anwendungslimit, keine Leistungszusage oder TS-Lizenzgrenze. |

<a id="changelog"></a>

## Änderungsprotokoll

<a id="latest-release-notes"></a>

### [v0.2.9](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.9) · 2026-10-24

#### Erweiterungen

- Umstellung auf das Upstream-SDK 1.0.0-beta.19. Normale Sprachverbindungen verwenden das Live-Clientverzeichnis ohne Query-Listenberechtigungen.
- Neuer GitHub-Skin-Store mit Installation, Updates und Freigabe pro Instanz. Discord Voice wird als eigenständiges standardkonformes `.wskin`-Beispiel verteilt.
- Optionale TS-Verwaltung im Modus mit festem Server: WebQuery-, TCP- oder SSH-Query-Zugangsdaten ermöglichen die Verwaltung von Server, Kanälen, Mitgliedern, Servergruppen und Sperren.
- Relays können einen direkten Sprachendpunkt für Browser bereitstellen und die Sprachsitzung übernehmen; eine zusätzliche Weiterleitung zwischen Gateways entfällt.
- Allgemeine Schnittstellen zum Beibehalten des Arbeitsbereichs und zur Wiederverbindung; KAAK nutzt diese und bietet Zugänge zur Administration, zum Projekt-GitHub und zur QQ-Gruppe.
- Unterstützung für TeamSpeak-Kanaltrenner mit Ausrichtung, Wiederholung, Leerzeilen und Standardlinien sowie öffentlichen Darstellungsdaten für Skins.

#### Fehlerbehebungen

- Vollbildgröße der Bildschirmfreigabe und Bereinigung von Status und Wiedergaberessourcen ausgeschiedener Mitglieder korrigiert.
- Erfolgreiche Sperren werden nicht mehr als Fehler gemeldet; Query-Verbindungen zählen nicht als Mitglieder, und das Kanalpasswort ist korrekt beschriftet.
- Berechtigungs-, Ratenlimit- und Zeitüberschreitungsfehler werden unterschieden. Schlägt nur die Aktualisierung nach einer erfolgreichen Aktion fehl, erscheint eine eigene Warnung gegen doppelte Ausführung.
- Verhindert, dass das SDK fehlgeschlagene HTTP-Antworten als erfolgreiche WebQuery-Ergebnisse behandelt; Layoutfehler auf der DC-Startseite, im Chat und bei schmalen Ansichten behoben.

#### Bekannte Probleme

- Die in [PR #48](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/48) beschriebene Sicherheitsabsicherung ist nicht enthalten; das Schließen des PRs bedeutet nicht, dass die gemeldeten Probleme behoben sind.

<details>
<summary>v0.2.8 und frühere Versionen anzeigen</summary>

### [v0.2.8](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.8) · 2026-10-17

#### Bildschirmfreigabe und Verbindungsstabilität

- Aushandlung und Verarbeitung der Videospur für Bildschirmfreigaben zwischen Browsern und nativen TeamSpeak-Clients korrigiert.
- Schnelle Kanalwechsel werden zuverlässiger verarbeitet, um inkonsistente Clientzustände zu vermeiden.
- Darstellungsfehler in einigen Skin-Komponenten und der KAAK-Übersetzung behoben.

#### Verbesserungen der Oberfläche

- Audiogerätenamen werden vollständig angezeigt und bei wenig Platz umgebrochen, damit lange Namen unterscheidbar bleiben.
- Unbeabsichtigte Textauswahl des Avatar-Platzhalters behoben.

### [v0.2.7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.7) · 2026-10-13

#### Offeneres Skin-System

- Ein offenerer Skin-Editor und die zugehörige Laufzeit erlauben es nun, Stil und Position beliebiger Komponenten anzupassen und Widgets hinzuzufügen.
- Öffne nach dem Wechsel in den Sprachbereich im selben Browser ein neues Fenster mit der Administrationsoberfläche und melde dich an, um den Skin-Editor zu aktivieren.
- Der Skin „KAAK“ ist als Entwicklungsbeispiel enthalten.
- Der Agent Skill für die Skin-Entwicklung wurde aktualisiert.

#### Funktionserweiterungen

- Serveradressen können nun über SRV-Einträge und TeamSpeak-Nickname-Einträge aufgelöst werden.
- Im freien Modus lassen sich mehrere Server-Tabs verwalten; diese Schaltflächen sind im Modus „Fester Server“ nicht verfügbar.
- Eine Option für die Bitrate der Bildschirmfreigabe wurde hinzugefügt.
- WebSpeak speichert eingegebene Kanalpasswörter nun im Browser.
- Gesperrte Kanäle werden mit einem Schlosssymbol angezeigt.
- Der Chatverlauf wird nun dauerhaft gespeichert.

#### Fehlerbehebungen

- Fehler bei der Adressauflösung behoben.
- Fokuskonflikte zwischen Lautstärkeregelung und dem Ziehen von Mitgliedskarten behoben.
- Fehler behoben, durch den der Benutzerstatus fälschlich als unbekannt erkannt wurde.

### [v0.2.6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.6) · 2026-10-08

Gegenüber 0.2.5 wurden Sprach-Gateway, gemeinsame Protokolle, Sprachoberfläche und Admin-Module umfassend umstrukturiert; #6/#7/#10 behoben, #9/#12 umgesetzt und der in PR #13 gemeldete Fall bereits aktiver TS6-Freigaben behoben. Opus- und Sitzungslebenszyklen sowie mobile Steuerung verbessert. Pakete: Windows x64, Linux x64/ARM64, Docker amd64/arm64 und Android arm64-v8a/armeabi-v7a/x86_64.

### [v0.2.5](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.5) · 2026-09-27

`.wskin`-Skins, Aktivierungs-/Standardverwaltung und geschützte Tages-, Nacht- und ILLUSIA-Skins ergänzt; unfertiges Aurora-Voice-Beispiel entfernt, Skin-Ladeblitze, dunkle Bedienelemente und Artwork-Ebenen im Sprachbereich korrigiert sowie offiziellen Skin-Entwicklungs-Agent-Skill hinzugefügt.

### [v0.2.4](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.4) · 2026-09-22

Plattformübergreifendes P2P-Bildschirmteilen zwischen Browsern und nativen TeamSpeak-6-Clients ergänzt; STUN-/externes-TURN-Konfiguration, Live-Player und Zuschauerstatus, Aufnahmeoptionen bis 1080p/60 FPS und WebRTC-Statistiken hinzugefügt; Bildschirmfreigabe-Interaktion verbessert und Besucherzählung ergänzt.

### [v0.2.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.3) · 2026-09-19

Mitgliederplanung und direkte Verschiebung nach Berechtigung ergänzt; Avatar-, Stummschaltstatus- und Identitätsunterstützung hinzugefügt; Screenshots und Dokumentation für alle fünf Sprachen aktualisiert.

### [v0.2.2](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.2) · 2026-09-17

Browserseitige Mikrofon-Geräuschunterdrückung, russische und japanische Oberfläche sowie sprachabhängige Begrüßungstexte ergänzt; Lautstärkeinteraktion und Fehlertexte/-codes auf Basis von PR #2 verbessert.

### [v0.2.1](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.1) · 2026-09-13

Verbindungsfehler auf der Willkommensseite verbessert, Fehlercodes erhalten und sicher gekürzt sowie IPv6-Ziele standardmäßig unterstützt.

### [v0.2.0](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.0) · 2026-09-10

Passwortabfrage, dedizierter Relay-Modus, Auswahl mehrerer Relays und Ursachendarstellung in der Administration ergänzt.

### [v0.1.8](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.8) · 2026-09-08

Docker-Bereitstellung vereinfacht, lokale TeamSpeak-Ziele unterstützt, 15-Sekunden-Timeout ergänzt und kontinuierliche Netzwerküberwachung eingeführt.

### [v0.1.7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.7) · 2026-09-06

Deutsch, Telegram, Netzwerkleistung und Gesamtlautstärke ergänzt; Lautstärkeschwankungen beim Begleitton behoben.

### [v0.1.6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.6) · 2026-09-04

Desktop-Begleitton, Hinweise zur gespeicherten Identität und Website-Symbol ergänzt; WebRTC-Mitgliederlautstärke korrigiert.

### [v0.1.5](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.5) · 2026-09-04

Identitätsspeicherung korrigiert und Designumschaltung verbessert.

### [v0.1.4](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.4) · 2026-09-03

WebRTC und Kanalchat korrigiert sowie Administration, Protokolle und Mobilansicht verbessert.

### [v0.1.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.3) · 2026-09-03

Integriertes WebRTC, aktualisiertes TeamSpeak-SDK und bessere Mitgliedersynchronisierung und Sprachpufferung.

</details>

<a id="contributors"></a>

## Mitwirkende & Herkunft

<details>
<summary>Upstream-Autoren und PR-Beiträge anzeigen</summary>

Diese Liste würdigt den Autor des zugrunde liegenden SDKs, Beiträge aus zusammengeführten GitHub-PRs sowie ursprüngliche Arbeiten, die in eigenständig verteilte Skin-Pakete übernommen wurden.

- [HoneyBBQ](https://github.com/HoneyBBQ) — Autor des [teamspeak-js-SDKs (`@honeybbq/teamspeak`)](https://github.com/HoneyBBQ/teamspeak-js), das den von WebSpeak verwendeten TeamSpeak-Protokollclient bereitstellt.
- [LainHE](https://github.com/LainHE) — [zusammengeführte PRs #2, #8, #28, #31–#35, #37, #38 und #40](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pulls?q=is%3Apr+is%3Amerged+author%3ALainHE): Browser-Fehlerübersetzungen, Skalierung und Startseitenlayout, Bildschirmfreigabe-Bitrate und Zuschaueravatare, Relay-Zielprüfung und Wiederverbindung, vertrauenswürdige Proxys, Weitergabe von Verbindungsfehlern, Audio-Fehlermeldungen und Ressourcenfreigabe bei WebRTC-Fehlern.
- [TimmySheep](https://github.com/TimmySheep) — [zusammengeführte PRs #13 und #15–#24](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pulls?q=is%3Apr+is%3Amerged+author%3ATimmySheep) zu vorhandenen TS6-Freigaben, Seitenverhältnis, mobiler Sprache/Bildschirm-Wachhalten/Skin-Menü, Kanaloptionen der Identität, PWA/Design, Chatverlauf, Mitglieder-Audiozuständen und Mikrofonberechtigungen.
- [yichen11818](https://github.com/yichen11818) — [PR #25](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/25) ermöglichte Verbindungen über registrierte TeamSpeak-Nicknames und bewahrte Nickname-Ziele; [PR #51](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/51) verbesserte das Beibehalten des KAAK-Arbeitsbereichs und die Wiederverbindung nach der ersten Verbindung. [PR #27](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/27) und [PR #52](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/52) lieferten das ursprüngliche Design und die Implementierung des Discord-Skins (Commit-Autor **yumi**), die das WebSpeak-Projekt in einen [eigenständig verteilten `.wskin`-Skin](https://github.com/Huddle-Up-Forge/webspeak-skin-discord-voice) überführte.

</details>

## Community & verwandte Projekte

[GitHub Issues](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues) · [QQ-Gruppe 869500475](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=yhumUMDD9PmyYFWdXWUb_x7hM5trFQY8&authKey=Pw3HBGT7GwMinTQnuFGfnpf0aRSzXOJKcAiujVP1%2BXMpjheAKrncTRivicBJxpjV&noverify=0&group_code=869500475) · [Telegram](https://t.me/+8qShpTcuN9A3MWY9)

[NeteaseTSBot](https://github.com/yichen11818/NeteaseTSBot): TeamSpeak-Musikbot mit plattformübergreifender Wiedergabe und Webkonsole.

## Lizenz

WebSpeak wird unter [AGPL-3.0-only](../LICENSE) veröffentlicht. Lizenzen und Herkunft von Abhängigkeiten stehen in den jeweiligen Upstream-Projekten.

<p align="right"><a href="#readme-top">Nach oben ↑</a></p>
