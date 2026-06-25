const fs = require("fs");
const path = require("path");

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.name.endsWith(".json")) {
      acc.push(full);
    }
  }
}

const files = [];
walk(process.cwd(), files);

for (const file of files) {
  JSON.parse(fs.readFileSync(file, "utf8"));
}

console.log(`Checked ${files.length} JSON files.`);
