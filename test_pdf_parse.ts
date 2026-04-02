import { PDFParse } from 'pdf-parse';
async function test() {
  try {
    console.log('Type of PDFParse:', typeof PDFParse);
    const mockBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [ ] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const pdf = new PDFParse({ data: new Uint8Array(mockBuffer) });
    console.log('PDF Instance created');
    const text = await pdf.getText();
    console.log('Success extracting text:', text);
  } catch (e) {
    console.error('Error in PDFParse:', e);
  }
}
test();
