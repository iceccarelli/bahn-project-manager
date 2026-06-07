import fs from "node:fs";

function patch(file, edits) {
  let s = fs.readFileSync(file, "utf8");
  for (const [from, to] of edits) {
    if (s.includes(to)) { console.log("• already applied:", file); continue; }
    if (!s.includes(from)) { console.error("✗ ANCHOR NOT FOUND in", file, "\n  ", JSON.stringify(from)); process.exit(1); }
    s = s.replace(from, to);
    console.log("✓ edited:", file);
  }
  fs.writeFileSync(file, s);
}

// 1) CRASH FIX — bahnhofsnummer/streckennummer are numbers in ~40% of rows,
//    so `?.toLowerCase()` throws. Coerce to string (also makes them searchable).
patch("client/src/hooks/useDataQuery.ts", [
  ['(p.bahnhofsnummer?.toLowerCase() || "")', '(String(p.bahnhofsnummer ?? "").toLowerCase())'],
  ['(p.streckennummer?.toLowerCase() || "")', '(String(p.streckennummer ?? "").toLowerCase())'],
]);

// 2) LIVE SEARCH — debounce typing so table/cards/map filter as you type.
patch("client/src/pages/Projects.tsx", [
  [
    'import React, { useState, useMemo, useCallback } from "react";',
    'import React, { useState, useMemo, useCallback, useEffect } from "react";',
  ],
  [
    '  const handleSearch = useCallback(() => {\n    setSearch(searchInput);\n  }, [searchInput]);',
    '  const handleSearch = useCallback(() => {\n    setSearch(searchInput);\n  }, [searchInput]);\n\n  // Live search: debounce typing so table, cards AND map filter as you type.\n  useEffect(() => {\n    const t = setTimeout(() => setSearch(searchInput), 250);\n    return () => clearTimeout(t);\n  }, [searchInput]);',
  ],
]);

console.log("\nDone.");
