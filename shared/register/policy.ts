/**
 * The recommended policy for every question the import cannot answer from the file alone — ONE text, shown in the import
 * dialog (tooltips, empty states) and quoted by docs/project-register-import.md. A question is never decided silently; it is
 * either decided by evidence (see register-plan.ts) or put to the administrator with these words.
 */
export const REGISTER_POLICY = {
  blanks: "Leere Zellen der Datei löschen nie einen vorhandenen Wert. Ein Wert wird nur ersetzt, wenn er hier ausdrücklich bestätigt wird.",
  conflict:
    "Die Datei würde vorhandene Werte ersetzen. Empfehlung: ersetzen nur, wenn die Datei die gepflegtere Quelle ist; sonst ausschließen. Offen lassen ändert nichts und fragt beim nächsten Import erneut.",
  phase:
    "AP, EP, VEP … sind verschiedene Phasen und damit verschiedene Anmeldungen mit eigenen Prüfungen, Prüfern und Terminen. Eine Zeile mit anderem Projektstand wird nie mit einem vorhandenen Projekt zusammengeführt, nie als dessen „bearbeitete Fassung“ gehalten, sondern als eigene Anmeldung angelegt. Prüfberichte werden, wenn sie ihre Phase nennen, dem Projekt dieser Phase zugeordnet.",
  ambiguous:
    "Mehrere Projekte kommen in Frage oder ein vorhandenes Projekt könnte die bearbeitete Fassung dieser Zeile sein. Empfehlung: dem Projekt zuordnen, wenn nur die Beschreibung umformuliert wurde; als neues Projekt anlegen, wenn es eine zweite Maßnahme ist. Die Wahl wird gemerkt.",
  sourceGroup:
    "Die Datei enthält mehrere Zeilen mit derselben Identität, aber unterschiedlichem Inhalt. Empfehlung: die Zeile wählen, die der Fachverantwortliche bestätigt; die übrigen werden dauerhaft ausgeschlossen. Ändert sich eine Zelle einer ausgeschlossenen Zeile, wird sie neu zur Frage.",
  skip: "„Dauerhaft ausschließen“ merkt sich genau diesen Zeileninhalt. Die Entscheidung kann in „Früher ausgeschlossen“ zurückgenommen werden.",
  unknownStatus:
    "Dieser Status gehört nicht zum Vokabular der Prüfungen und wird nicht übernommen (Name und Datum schon). Das Vokabular zu erweitern ist Entscheidung der Datenverantwortlichen (shared/validation.ts REVIEW_STATUSES).",
} as const;
