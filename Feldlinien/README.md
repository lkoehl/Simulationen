# Elektrisches Feld

Interaktive Simulation zu elektrischen Feldlinien, Probeladungen, Influenz und dem Faradayschen Käfig. Sie ersetzt die älteren Einzeldateien `Field_Lines_Sim.html` und `Feldlinien-Kraft - Kopie.html` und baut auf ihnen auf.

## Was man damit machen kann

- **Ladungen** (positiv/negativ, Betrag einstellbar) ins Feld ziehen und verschieben. Die Feldlinien werden sofort neu berechnet.
- **Probeladungen** absetzen und mit **Start** loslassen. Sie werden vom Feld bewegt, mit Kraftpfeil und Spur:
  - *mit Reibung*: Die Probeladung gleitet genau entlang einer Feldlinie.
  - *ohne Reibung*: Die Probeladung ist träge und weicht von den Feldlinien ab.
  Szenarien mit Probeladungen starten pausiert, damit die Klasse erst vermuten kann.
- **Leiter aus Metall**: Platte, Plattenkondensator, Ring und Kasten. Ladung, Größe, Drehung und Erdung sind einstellbar, beim Ring auch eine Öffnung.
  - Die Ladungen im Metall verschieben sich wirklich (Influenz). Die influenzierten Ladungen werden als kleine + und − an der Oberfläche angezeigt.
  - Ein geschlossener Ring oder Kasten ist ein **Faradayscher Käfig**: Innen ist das Feld null, eine Probeladung darin bleibt liegen.
  - Ist eine Ladung im Käfig, sammelt sich auf der Außenseite gleich viel Ladung und erzeugt ein Außenfeld, unabhängig davon, wo die Ladung innen sitzt. Wird der Käfig geerdet, verschwindet das Außenfeld.
  - Wird die Erdung wieder gelöst, behält der Leiter die über die Erde zugeflossene Ladung (Laden durch Influenz).
  - Berühren sich zwei Leiter, sind sie leitend verbunden und teilen sich ihre Ladung. Zieht man sie wieder auseinander, behält jeder seinen Anteil (Laden durch Berührung).
- **Anzeige**: Feldlinien (Dichte einstellbar), Feldvektoren, Äquipotentiallinien, Ladungen auf Leitern, Kraftpfeile, Spuren.
- **Szenarien** für den Unterricht: Einzelladung, Dipol, gleichnamige Ladungen, ungleiche Ladungen, Plattenkondensator, Käfig im Kondensator, Ladung im Käfig, Influenz, geladener Metallkasten.
- **Rückgängig**: Entfernen, Feld leeren und Szenariowechsel lassen sich mit einem Klick (oder Strg/Cmd + Z) zurücknehmen, solange danach nichts anderes geändert wurde.
- **Bild speichern** legt das aktuelle Feldbild als PNG ab, z. B. für Arbeitsblätter.
- **Papier/Tafel**: hell für den Beamer, dunkel für abgedunkelte Räume.
- Ein Szenario lässt sich direkt verlinken, z. B. `…/index.html?szenario=kaefig`. Die Kennungen stehen in `src/presets.ts`.

Bedienung per Maus, Touch (iPad) und Tastatur: Leertaste startet und pausiert, Entf löscht das ausgewählte Objekt, Esc hebt die Auswahl auf. Ein Objekt wird entfernt, indem man es aus dem Feld herauszieht.

## Physikalisches Modell

Gerechnet wird zweidimensional: Jede Ladung ist ein langer Draht senkrecht zur Bildebene, ein Ring ein langer Metallzylinder. Das Feld einer Punktladung fällt deshalb mit 1/r ab, nicht mit 1/r². Dafür gilt: Die Dichte der gezeichneten Feldlinien ist überall genau proportional zur Feldstärke, und Feldlinien beginnen und enden nur an Ladungen.

Die Ladungsverteilung auf den Leitern wird mit einem Randelementverfahren berechnet: Jede Leiteroberfläche wird in kurze Stücke zerlegt, deren Ladung so bestimmt wird, dass der ganze Leiter auf einem Potential liegt. Isolierte Leiter behalten dabei ihre Gesamtladung, geerdete liegen auf Potential 0. Im Inneren eines leeren, geschlossenen Leiters ist das Feld nach dem Eindeutigkeitssatz exakt null; das wird direkt so gerechnet, damit dort keine Rechenungenauigkeit Probeladungen verschiebt.

Feldlinien werden an jeder positiven Ladung gestartet und zusätzlich von jeder negativen Ladung rückwärts verfolgt. So bleiben symmetrische Anordnungen symmetrisch, auch wenn Feldlinien weit aus dem Bild laufen.

Die Tests (`npm test`) prüfen unter anderem: Das Feld im geschlossenen Ring verschwindet, der Kondensator hat innen ein homogenes Feld, überlappende Leiter bringen die Rechnung nicht aus dem Tritt, Dipolbilder sind symmetrisch, Probeladungen werden von gleichnamigen Ladungen abgestoßen und bleiben im Käfig liegen.

## Entwicklung

Voraussetzung: Node.js `^20.19.0 || >=22.12.0`.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Physik-Tests
npm run build    # statischer Build in dist/
```

## Veröffentlichen

`npm run build` erzeugt **eine einzige Datei**: `dist/index.html`. Programm, Gestaltung und Schrift stecken darin, es werden keine weiteren Dateien und nichts aus dem Internet nachgeladen.

- **Auf der eigenen Homepage:** Die Datei in einen beliebigen Ordner des Webservers hochladen, z. B. als `feldlinien/index.html` (Adresse `…/feldlinien/`) oder umbenannt als `feldlinien.html`.
- **Ohne Server:** Die Datei per Doppelklick öffnen, z. B. vom USB-Stick oder aus dem Download-Ordner.
- Szenarien lassen sich direkt verlinken: `…/feldlinien.html?szenario=kaefig`.
