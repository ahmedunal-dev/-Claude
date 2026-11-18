# Rift Runner

Ein schnelles Ein-Finger-Arcade-Spiel im Neon-Look. Du steuerst ein Schiff durch einen Strom aus Hindernissen, der immer schneller wird. Eine Runde dauert 20 bis 90 Sekunden, danach geht es mit einem Tipp sofort weiter. Auf genau diese Schleife setzen erfolgreiche Hyper-Casual-Spiele.

## Spielprinzip

| Element | Was passiert |
| --- | --- |
| **Steuerung** | Irgendwo auf dem Bildschirm ziehen. Das Schiff folgt relativ zum Finger, damit der Finger das Schiff nicht verdeckt. Am Desktop folgt es der Maus, alternativ Pfeiltasten/WASD. |
| **Close Calls** | Knapp an einem Hindernis vorbeifliegen gibt Bonuspunkte, eine kurze Zeitlupe und lädt den Ring um das Schiff auf. |
| **Overdrive** | Ist der Ring voll, bist du 3,5 Sekunden lang unverwundbar, fliegst schneller und zerschlägst alle Hindernisse. Danach lädt sich der Ring 8 Sekunden lang nicht auf, und jeder weitere Overdrive braucht mehr Close Calls. |
| **Shards & Multiplikator** | Goldene Shards hintereinander einsammeln erhöht den Multiplikator bis x10. Nach 2,3 Sekunden ohne Shard verfällt die Kette. |
| **Hindernisse** | Blöcke (auch bewegliche), Wände mit Lücke (auch schwingende), rotierende Balken, springende Minen und Laser mit Vorwarnung, die auf deine Position zielen. Sie werden nach und nach freigeschaltet. |
| **Level** | 10 Level, jedes mit eigenem Namen, eigener Farbe, eigenem Mix aus Hindernissen und Gegnern und einem Boss am Ende. Zuerst weichst du 30 bis 45 Sekunden lang aus (der Balken oben zeigt, wie weit es noch ist), dann kommt der Bosskampf. Ist der Boss besiegt, ist das Level geschafft, und das nächste wird freigeschaltet. Im **Level-Menü** kannst du jedes freigeschaltete Level spielen. |
| **Die 10 Level** | 1 First Light (nur Blöcke, Wände und Drohnen, Boss Warden) · 2 Static Field (rotierende Balken, Diver) · 3 Mine Run (Minen, erster Hydra) · 4 Crossfire (erste Laser) · 5 Deep Rift (alles, erster Rift Core) · 6 Swarm (wenig Hindernisse, viele Gegner, Elite-Warden) · 7 Laser Grid (Laser-Level) · 8 Pressure (hohes Tempo) · 9 Gauntlet (alles dicht, starker Hydra) · 10 Rift Heart (Finale, stärkster Boss). Die Werte stehen in `LEVELS` in `www/game.js`. |
| **Gegner & Bosse** | Drohnen (fliegen in Wellen), Diver (zielen kurz und rasen dann auf dich zu), Gunner (bleiben oben und schießen). Bosse: **Warden** (Salven, Ringe), **Hydra** (Spiralen, Laser, Geschosswände, ruft Drohnen), **Rift Core** (3 Phasen). Je später das Level, desto stärker ist der Boss (mehr Leben, schnellere und dichtere Angriffe). |
| **Waffen & Upgrades** | Es ist immer nur **eine** Waffe aktiv, und sie schießt automatisch. Jedes Level beginnt mit der **Standardwaffe**. Im Menü **Upgrades** verbesserst du alle 6 Waffen mit Shards dauerhaft, jeweils von Lv1 bis Lv6 (Kosten 60, 150, 300, 550, 900): **Standard** (schneller, mehr Schaden, ab Lv4 Doppelschuss), **Spread** (Fächer aus 3 bis 8 Schüssen), **Rapid** (Dauerfeuer, 9 bis 19 Schuss pro Sekunde), **Homing** (zielsuchende Raketensalven), **Beam** (Laserstrahl), **Plasma** (große, durchschlagende Kugeln). |
| **Waffen-Drops** | Gegner lassen die 5 Spezialwaffen fallen, klar erkennbar an Farbe, Symbol und Namen (gelb Spread, cyan Rapid, blau Homing, lila Beam, grün Plasma). Ein Drop ersetzt deine aktuelle Waffe **12 Sekunden lang** durch diese Waffe, auf deiner gekauften Stufe. Danach hast du wieder die Standardwaffe. Ein neuer Drop ersetzt die aktuelle Waffe und startet die 12 Sekunden neu. Oben links stehen die aktive Waffe, ihre Stufe und die Restzeit. Drops fallen vor und während des Bosskampfs. |
| **Grazen** | Knapp an Gegnergeschossen vorbeifliegen bringt Punkte und lädt den Overdrive-Ring. |
| **Power-ups** | Schild (fängt einen Treffer ab), Magnet (zieht Shards an), Zeitlupe. |
| **Sterne** | Pro Level gibt es bis zu 3 Sterne: Boss besiegt, ohne Wiederbelebung, und 70 % der Gegner zerstört. Die Sterne stehen im Level-Menü, der Bestwert eines Levels zählt nur, wenn du es geschafft hast. |
| **Meta-Loop** | Shards sind Währung: Damit kaufst du 6 Schiff-Skins (500 bis 15.000 Shards) oder eine Wiederbelebung (50 Shards, einmal pro Runde). Rekord und Shards werden gespeichert. |

Sound und Musik werden komplett per Web Audio erzeugt, es gibt also keine Audiodateien. Haptisches Feedback nutzt auf iOS das Capacitor-Haptics-Plugin, im Browser `navigator.vibrate`.

## Lokal spielen

```bash
npm run dev          # öffnet www/ auf http://localhost:5173
```

Alternativ `www/index.html` über einen beliebigen statischen Webserver ausliefern.

## Ab in den App Store (iOS)

Das Spiel ist reines HTML5/Canvas und wird mit [Capacitor](https://capacitorjs.com) als native App verpackt. Dafür brauchst du einen Mac mit Xcode und einen Apple-Developer-Account (99 $ pro Jahr).

```bash
npm install
npm run ios:add      # erzeugt das Xcode-Projekt in ios/
npm run ios:sync     # kopiert www/ in die App
npm run ios:open     # öffnet Xcode
```

In Xcode:

1. **Bundle Identifier** in `capacitor.config.json` von `com.example.riftrunner` auf deine eigene ID ändern, zum Beispiel `de.deinname.riftrunner`.
2. Unter *Signing & Capabilities* dein Team auswählen.
3. In `Info.plist` den Eintrag `UIStatusBarHidden = YES` und `UIRequiresFullScreen = YES` setzen und die Ausrichtung auf Portrait beschränken.
4. Ein App-Icon in 1024×1024 hinterlegen. Eine Vorlage liegt in `www/icon.svg`.
5. Die Schrift *Chakra Petch* wird aktuell von Google Fonts geladen. Für die Offline-Nutzung solltest du die Fontdatei nach `www/` kopieren und per `@font-face` einbinden. Ohne Netz greift sonst die Fallback-Schrift.
6. *Product → Archive* ausführen und über App Store Connect hochladen.

Für Android funktioniert es genauso mit `npm run android:add` und `npm run android:open` (Android Studio).

## Was die Download-Zahlen treibt

Der Code allein bringt noch keine Downloads. Diese Punkte entscheiden mit:

- **Name prüfen:** „Rift Runner“ ist ein Arbeitstitel. Vor dem Release im App Store nachsehen, ob der Name schon vergeben ist.
- **Store-Video:** Die ersten 3 Sekunden des Preview-Videos sollten einen Overdrive-Moment oder eine Laser-Ausweichaktion zeigen.
- **Monetarisierung:** Die Wiederbelebung ist bereits so gebaut, dass sie sich leicht auf „Rewarded Ad ansehen“ umstellen lässt (`revive()` in `www/game.js`). Ergänzen lassen sich ein In-App-Kauf „Werbung entfernen“ und Skin-Pakete.
- **Retention:** Naheliegende nächste Schritte sind tägliche Missionen („10 Close Calls in einer Runde“), eine Daily-Challenge mit festem Seed und Game-Center-Bestenlisten.

## Struktur

```
www/
  index.html             Menüs, HUD, Overlays
  style.css              Neon-UI, Safe-Area-Unterstützung für Notch und Home-Indicator
  game.js                Engine: Spawner, Kollision, Effekte, Audio, Shop, Speicherstand
  manifest.webmanifest   PWA ("Zum Home-Bildschirm")
  icon.svg               App-Icon-Vorlage
capacitor.config.json    Native Hülle für iOS und Android
```
