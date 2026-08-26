# Umzug nach GitLab

Stand: der Code ist umzugsbereit. Was der Umzug *nicht* mitbringt, steht
weiter unten und ist der wichtigere Teil.

---

## 1. Was vorher im Weg stand, und jetzt nicht mehr

**Eine fest verdrahtete GitHub-URL im Anwendungscode.** `client/src/_core/api/client.ts`
holte die Projektdaten ersatzweise von
`raw.githubusercontent.com/iceccarelli/bahn-project-manager/refs/heads/main/client/public/data.json`.
Nach einem Umzug hätte der Client weiter aus GitHub gelesen — aus einem Branch,
den niemand mehr beobachtet. Ersetzt durch `VITE_DATA_FALLBACK_URL`; nicht
gesetzt heißt: keine zweite Quelle, und ein Ladefehler sagt das, statt
woanders hinzugreifen.

`node scripts/doctor.mjs` prüft das bei jedem Lauf und schlägt fehl, wenn eine
solche URL zurückkommt.

**Keine Pipeline.** `.gitlab-ci.yml` führt dieselben Gates aus wie
`.github/workflows/ci.yml` — dieselben `pnpm`-Skripte, nicht nachgebaute
Befehle.

---

## 2. Der Umzug selbst

Ein Spiegel-Push überträgt **alles**: jeden Commit, jeden Branch, jedes Tag.

```bash
# 1. Vollständige Kopie holen (kein Arbeitsverzeichnis, nur Historie)
git clone --mirror https://github.com/iceccarelli/bahn-project-manager.git bpm-mirror.git
cd bpm-mirror.git

# 2. Leeres Projekt in GitLab anlegen — OHNE README, ohne .gitignore.
#    Ein initialisiertes Zielprojekt erzwingt einen Merge, der die Historie
#    verzweigt; leer bleibt sie eine gerade Linie.

# 3. Spiegeln
git remote add gitlab git@gitlab.com:<gruppe>/bahn-project-manager.git
git push --mirror gitlab

# 4. Nachweis: gleiche Commit-Anzahl, gleicher HEAD
git rev-list --count --all
git ls-remote gitlab | head
```

Danach im Arbeitsklon umhängen:

```bash
cd /workspaces/bahn-project-manager
git remote set-url origin git@gitlab.com:<gruppe>/bahn-project-manager.git
git remote -v
git fetch origin && git status
```

**Kein Git LFS nötig.** Größte Datei im Baum: `client/public/data.json` mit
3,5 MB, Repository gesamt 7,9 MB, `.git` 5,0 MB. GitLab's Standardlimit liegt
weit darüber.

---

## 3. Was der Umzug nicht mitbringt

| Auf GitHub | Auf GitLab |
|---|---|
| `.github/workflows/ci.yml` | wirkungslos — `.gitlab-ci.yml` übernimmt |
| Vercel-Deploy aus `main` | **kein Ersatz.** Siehe unten |
| GitHub Actions Secrets | GitLab CI/CD Variables (Settings → CI/CD → Variables) |
| Issues, PRs, Reviews | GitLab importiert sie beim „Import project from GitHub"; ein reiner Spiegel-Push tut das nicht |

### Der Deploy ist eine Entscheidung, keine Konfigurationszeile

Vercel baut heute aus `origin/main` auf GitHub. Drei Wege, in absteigender
Reihenfolge dessen, was sie an Infrastruktur verlangen:

1. **Vercel an GitLab hängen.** Vercel unterstützt GitLab als Quelle. Am
   wenigsten Arbeit, gleiche Laufzeit, `vercel.json` bleibt wie es ist.
2. **GitLab Pages.** Der Build ist ein statisches `dist/public`. Ein
   `pages`-Job kopiert es nach `public/` — dann hostet GitLab selbst, ohne
   Drittanbieter. Die Rewrite-Regel aus `vercel.json`
   (`/(.*) → /index.html`) braucht dabei ein Äquivalent, sonst gibt jeder
   Deep-Link 404.
3. **Der Container.** `Dockerfile` und `docker-compose.yml` sind vorhanden, das
   Image bringt den Server aus `server/` mit — der einzige Weg, der auch die
   Datenbank mitbringt (siehe Abschnitt 4).

---

## 4. Was der Umzug erst recht nicht löst: die Persistenz

Gemessen, nicht vermutet:

- Der ausgelieferte Client schreibt **jede** Änderung in `localStorage` des
  jeweiligen Browsers. Es gibt im Deploy keinen Server, der etwas entgegennimmt.
- Zwei Tabs eines Browsers sind seit `useCrossTabSync` synchron. **Zwei Rechner
  sind es nicht** — und werden es durch keinen Git-Anbieter.
- Der Speicher fasst 5 MB pro Origin. Die ausgelieferten Daten belegen davon
  gemessen 2,15 MB, bevor jemand etwas ändert (≈ 43 %). Am Limit wird ein
  Schreibvorgang abgelehnt; seit `writeStore` sagt die Anwendung das, statt die
  Änderung stillschweigend zurückzurollen. Das Dashboard zeigt den Füllstand
  unter „Belastbarkeit der Zahlen".
- Vorhanden und ungenutzt: `server/routers.ts` mit 22 tRPC-Prozeduren,
  `drizzle/schema.ts` mit acht Tabellen inklusive `audit_log`, vier
  Migrationen, ein `docker-compose.yml` mit MySQL. `client/src/lib/trpc.ts`
  erzeugt einen tRPC-Client, den **keine** Komponente einbindet.

Der Weg zu echter Mehrbenutzer-Persistenz führt also nicht über eine neue
Bibliothek, sondern über das Anschließen dessen, was schon dasteht:

1. `DATABASE_URL` setzen, `pnpm db:push`, `pnpm seed:perfect` — die Migrationen
   und der Seed existieren.
2. Den tRPC-Provider in `App.tsx` einhängen und `apiClient` hinter dieselbe
   Schnittstelle legen, die er heute hat (`projects.list`, `projects.update`,
   `reviews.update`, `audit.*`). Die Signaturen stimmen bereits überein — das
   ist der Grund, warum das eine Stufe und kein Umbau ist.
3. Den Audit-Trail auf die `audit_log`-Tabelle legen. Er ist heute schon das
   vollständige Änderungsprotokoll inklusive Rückgängig; er lebt nur im
   falschen Speicher.
4. Erst danach ist „alle sehen dasselbe" eine Aussage, die man prüfen kann —
   und dann prüft sie `scripts/stress-test.mjs` mit echten parallelen Sitzungen
   statt mit zwei Tabs.

---

## 5. Nach dem Umzug: prüfen, nicht hoffen

```bash
node scripts/doctor.mjs      # Werkzeuge, Daten, Speicherlage, Fremdbindungen
node scripts/status.mjs      # Bauteile, HEAD gegen origin/main, erwartete Gate-Zahlen
```

Der Doctor meldet weiterhin einen Hinweis auf `.github/workflows/ci.yml`,
solange die Datei existiert. Sie zu löschen ist der letzte Schritt des Umzugs —
und der Schritt, den man erst geht, wenn die GitLab-Pipeline einmal
vollständig grün war.
