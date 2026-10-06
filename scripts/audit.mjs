// Dependency audit at every severity (the nightly run). Fails on any advisory that is not in audit-exceptions.json,
// and on exceptions that have expired, so an accepted risk is looked at again. Usage: node scripts/audit.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { exceptions } = JSON.parse(readFileSync('audit-exceptions.json', 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let report;
try {
  report = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (err) {
  // npm audit exits with 1 when it finds anything; the JSON is still on stdout.
  report = err.stdout;
}
const { vulnerabilities = {} } = JSON.parse(report);

const found = new Map();
for (const [name, v] of Object.entries(vulnerabilities)) {
  for (const via of v.via) {
    if (typeof via !== 'object') continue;
    const id = String(via.url ?? '').split('/').pop();
    found.set(id, { id, package: name, severity: via.severity, title: via.title, url: via.url });
  }
}

const problems = [];
for (const advisory of found.values()) {
  const exception = exceptions.find((e) => e.advisory === advisory.id);
  if (!exception) problems.push(`${advisory.severity}: ${advisory.package}: ${advisory.title} (${advisory.url})`);
  else if (exception.until < today) problems.push(`expired exception (${exception.until}): ${advisory.package}: ${advisory.title} (${advisory.url})`);
  else console.log(`accepted until ${exception.until}: ${advisory.package}: ${advisory.title}`);
}
for (const e of exceptions) if (!found.has(e.advisory)) console.log(`no longer needed (advisory gone): ${e.advisory}; remove it from audit-exceptions.json`);

if (problems.length > 0) {
  console.error(`Audit failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Audit passed (${found.size} advisories, all accepted).`);
