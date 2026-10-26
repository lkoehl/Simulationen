# Der bewegte Mann

Interaktive Simulation zu Ort, Geschwindigkeit und Beschleunigung, nach dem Vorbild der PhET-Simulation „The Moving Man“.

## Was man damit machen kann

- **Mann ziehen**: Mit Maus, Finger oder Pfeiltasten. Das Ziehen startet die Aufnahme, die Diagramme zeichnen mit.
- **Geschwindigkeit oder Beschleunigung vorgeben**: Regler oder Zahl einstellen und **Start** drücken. Der Mann läuft dann von selbst, z. B. aus der Ruhe bei −8 m mit a = 1 m/s². Die vorgegebene Größe ist im Panel markiert.
- **Wände** bei −10 m und +10 m: Der Mann bleibt dort stehen.
- **s-t-, v-t- und a-t-Diagramm** untereinander mit gemeinsamer Zeitachse von 0 bis 20 s. Geschwindigkeit und Beschleunigung sind am Anfang ausgeblendet, damit die Klasse erst vermuten kann. Der Wertebereich von v und a lässt sich zoomen.
- **Pfeile** für v und a direkt am Mann.
- **Rückblick**: Zeitleiste ziehen oder in ein Diagramm tippen. Der Mann steht dann dort, wo er zu diesem Zeitpunkt war, die Felder zeigen s, v und a.
- **Abspielen** wiederholt die Aufnahme, auch in Zeitlupe (½×, ¼×).
- **Ab hier aufnehmen** verwirft alles nach dem gewählten Zeitpunkt und nimmt von dort weiter auf. **Neu** löscht die Aufnahme und stellt den Mann zurück an den Start. Beides lässt sich rückgängig machen.

Tastatur: Leertaste startet und pausiert, Pfeiltasten verschieben den ausgewählten Mann (mit Umschalt in Meterschritten).

## Wie gerechnet wird

Die Simulation läuft in festen Schritten von 1/60 s, eine Aufnahme fasst 20 s.

- **v oder a vorgegeben**: Ort und Geschwindigkeit werden exakt integriert (bei konstantem a gilt s = s₀ + v₀t + ½at² ohne Rundungsfehler).
- **Mann gezogen**: Gemessen wird nur der Ort. Zeigerereignisse kommen unregelmäßig und nicht im Takt der Bildschirmbilder an. Deshalb wird jeder Zeiger-Ort mit seinem Zeitstempel gespeichert und zu jedem Simulationsschritt genau zu dessen Zeitpunkt interpoliert. v und a ergeben sich dann aus einer lokalen Ausgleichsgeraden bzw. -parabel über ±0,1 s bzw. ±0,25 s. So bleiben die Kurven ruhig, und v und a erscheinen nur kurz nach s.

Die Tests (`npm test`) prüfen unter anderem, dass v und a einer verrauschten Handbewegung richtig rekonstruiert werden, dass gleichmäßig beschleunigte Bewegung exakt der Formel folgt und dass der Mann an den Wänden stehen bleibt.

## Entwicklung

Voraussetzung: Node.js `^20.19.0 || >=22.12.0`.

```bash
npm install
npm run dev
```

`npm run build` erzeugt eine einzige, eigenständige Datei `dist/index.html` (Skript, Stile und Schrift eingebettet). Sie lässt sich überall hin kopieren oder per Doppelklick öffnen.
