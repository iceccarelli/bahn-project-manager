const ps = JSON.parse(require("fs").readFileSync("client/public/data.json", "utf8")).projects;
const norm = (v) => (v == null ? "" : String(v).toLowerCase());
const run = (q) => {
  const t = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return ps.filter((p) => t.every((x) =>
    [p.station,p.projektbeschreibung,p.projektnummer,p.projektleiter,p.bahnhofsmanagement,
     p.projektstand,p.bahnhofsnummer,p.streckennummer,p.kommentar].some((f)=>norm(f).includes(x)) ||
    (p.reviews??[]).some((r)=>[r.prueferName,r.department,r.status].some((f)=>norm(f).includes(x)))));
};
for (const q of ["a","1","123456789","koblenz","3507","wiesbaden","koblenz los 2","zzznope"])
  console.log(q.padEnd(16), run(q).length, "results");
