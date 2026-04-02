const { createRequire } = require('module');
const requireCustom = createRequire(__filename);
try {
  const pdf = requireCustom('pdf-parse');
  console.log('Type of pdf:', typeof pdf);
  console.log('Keys of pdf:', Object.keys(pdf));
} catch (e) {
  console.error('Error loading pdf-parse:', e);
}
