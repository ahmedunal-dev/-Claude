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
| **Level & Bosse** | Jedes Level hat 3 Stages. In jeder Stage weichst du zuerst etwa 30 Sekunden lang Hindernissen aus (der Balken oben zeigt, wie weit es noch ist), dann kommt nach einer Warnung ein Bosskampf. Boss 3 ist der schwerste. Ab Level 2 haben alle Bosse mehr Leben, schießen schneller und ihre Geschosse sind schneller. |
| **Bosse** | **Warden:** gezielte Salven und Geschossringe. **Hydra:** Spiralen, Laser, Geschosswände mit Lücke, ruft Drohnen. **Rift Core:** 3 Phasen (bei 66 % und 33 % Leben), die jeweils härter werden, mit 4-armigen Spiralen, Dreifach-Lasern und Kamikaze-Gegnern. Ist ein Boss besiegt, verwandeln sich alle Geschosse auf dem Bildschirm in Shards, und es gibt einen Punktebonus. |
| **Gegner** | Drohnen (fliegen in Wellen), Diver (zielen kurz und rasen dann auf dich zu) und Gunner (bleiben oben und schießen gezielt). Abgeschossene Gegner lassen Shards fallen. |
| **Waffen** | Dein Schiff schießt automatisch. Die Startwaffe ist der Blaster. **?-Boxen** geben eine zufällige Waffe: Spread, Rapid, Homing, Beam oder Plasma. Erwischst du dieselbe Waffe noch einmal, steigt sie eine Stufe auf (bis Lv3). Nach jedem Boss wird die Waffe zurückgesetzt. |
| **Grazen** | Knapp an Gegnergeschossen vorbeifliegen bringt Punkte und lädt den Overdrive-Ring. |
| **Power-ups** | Schild (fängt einen Treffer ab), Magnet (zieht Shards an), Zeitlupe. |
| **Zonen** | Alle 30 Sekunden beginnt eine neue Zone mit eigener Farbe, die Musik wird intensiver und das Tempo steigt. Ab etwa 75 Sekunden zieht das Tempo weiter an, Lücken werden enger und bis zu 3 Laser feuern gleichzeitig. Jede Runde endet irgendwann. |
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
