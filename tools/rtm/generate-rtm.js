const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '../../');
const funcDocPath = path.join(rootDir, 'FUNCTIONAL_DOCUMENTATION.md');
const nfrDocPath = path.join(rootDir, 'NON_FUNCTIONAL_REQUIREMENTS.md');
const testDirs = [
  path.join(rootDir, 'backend/tests'),
  path.join(rootDir, 'frontend/src')
];

function getRequirements(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const requirements = [];
  
  // Pattern: - [ID] Description
  const reqPattern = /^-\s+\[((?:FUNC|NFR)-[A-Z0-9-]+)\]\s+(.*)/;
  
  lines.forEach(line => {
    const match = line.trim().match(reqPattern);
    if (match) {
      requirements.push({
        id: match[1],
        description: match[2],
        tests: []
      });
    }
  });
  
  return requirements;
}

function findTests(dirs, requirements) {
  const reqMap = {};
  requirements.forEach(req => {
    reqMap[req.id] = req;
  });

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scanDir(fullPath);
      } else if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        Object.keys(reqMap).forEach(id => {
          if (content.includes(`[${id}]`)) {
            const relativePath = path.relative(rootDir, fullPath);
            if (!reqMap[id].tests.includes(relativePath)) {
              reqMap[id].tests.push(relativePath);
            }
          }
        });
      }
    });
  }

  dirs.forEach(scanDir);
}

function generateHtml(requirements) {
  const coveredCount = requirements.filter(r => r.tests.length > 0).length;
  const coverage = requirements.length > 0 ? (coveredCount / requirements.length * 100).toFixed(2) : 0;

  const rows = requirements.map(req => `
    <tr class="${req.tests.length > 0 ? 'bg-green-50' : 'bg-red-50'}">
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border">${req.id}</td>
      <td class="px-6 py-4 text-sm text-gray-500 border">${req.description}</td>
      <td class="px-6 py-4 text-sm text-gray-500 border">
        ${req.tests.length > 0 
          ? `<ul class="list-disc list-inside">${req.tests.map(t => `<li>${t}</li>`).join('')}</ul>`
          : '<span class="text-red-600 font-bold italic">BLANK</span>'
        }
      </td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Requirement Traceability Matrix</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-10">
    <div class="max-w-6xl mx-auto bg-white p-8 rounded-lg shadow-lg">
        <h1 class="text-3xl font-bold mb-6 text-gray-800">Requirement Traceability Matrix (RTM)</h1>
        
        <div class="mb-8 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
            <h2 class="text-xl font-semibold text-blue-700">Coverage Summary</h2>
            <p class="text-3xl font-bold text-blue-900 mt-2">${coverage}%</p>
            <p class="text-sm text-blue-600 mt-1">${coveredCount} of ${requirements.length} requirements covered by tests.</p>
        </div>

        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 border">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border">Req ID</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border">Description</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border">Test Cases</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    ${rows}
                </tbody>
            </table>
        </div>
        
        <p class="mt-6 text-xs text-gray-400 italic">Generated on ${new Date().toLocaleString()}</p>
    </div>
</body>
</html>
  `;
}

const requirements = [
  ...getRequirements(funcDocPath),
  ...getRequirements(nfrDocPath)
];

findTests(testDirs, requirements);

const html = generateHtml(requirements);
const outputPath = path.join(rootDir, 'rtm_report.html');
fs.writeFileSync(outputPath, html);

console.log(`RTM Report generated at: ${outputPath}`);

// Try to open the report
try {
  const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execSync(`${opener} ${outputPath}`);
} catch (e) {
  console.log('Could not automatically open the report. Please open it manually.');
}
