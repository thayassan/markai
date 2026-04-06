import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const { error: getErr } = await supabase.storage.getBucket('markai-pdfs');
  if (getErr) {
    console.error('🔍 Supabase: getBucket failed with details:', {
      message: getErr.message,
      name: getErr.name,
      status: (getErr as any).status,
      error_description: (getErr as any).error_description
    });
    const { error: createErr } = await supabase.storage.createBucket('markai-pdfs', { public: false });
    if (createErr && !createErr.message.includes('already exists')) {
      console.error('❌ Supabase: createBucket failed with details:', {
        message: createErr.message,
        name: createErr.name,
        status: (createErr as any).status,
        error_description: (createErr as any).error_description
      });
      throw new Error(`Failed to ensure Supabase bucket: ${createErr.message}`);
    }
  }
  bucketEnsured = true;
}

// Upload PDF to Supabase Storage
export async function uploadPdfToSupabase(
  buffer: Buffer,
  filename: string,
  folder: string = 'pdfs'
): Promise<string> {
  await ensureBucket();
  const filePath = `${folder}/${Date.now()}-${filename}`;

  const { data, error } = await supabase.storage
    .from('markai-pdfs')
    .upload(filePath, buffer, {
      contentType: 'application/pdf',
      upsert: false
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return filePath;
}

// Upload extracted text to Supabase Storage as .txt file
// This avoids storing large text blobs in the database
export async function uploadTextToSupabase(
  text: string,
  filename: string,
  folder: string = 'texts'
): Promise<string> {
  await ensureBucket();
  const filePath = `${folder}/${Date.now()}-${filename}.txt`;
  const buffer = Buffer.from(text, 'utf-8');
  const { data, error } = await supabase.storage
    .from('markai-pdfs')
    .upload(filePath, buffer, {
      contentType: 'text/plain',
      upsert: false
    });
  if (error) throw new Error(`Text upload failed: ${error.message}`);
  return filePath;
}

// Download text file from Supabase Storage
export async function downloadTextFromSupabase(
  filePath: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('markai-pdfs')
    .download(filePath);
  if (error) throw new Error(`Text download failed: ${error.message}`);
  const text = await data.text();
  return text;
}

// Get signed URL for stored file (1 hour expiry)
export async function getSignedFileUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('markai-pdfs')
    .createSignedUrl(filePath, 3600);

  if (error) throw new Error(`Failed to create signed URL: ${error.message}`);
  return data.signedUrl;
}
