import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Upload PDF to Supabase Storage
export async function uploadPdfToSupabase(
  buffer: Buffer,
  filename: string,
  folder: string = 'pdfs'
): Promise<string> {
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

// Get signed URL for stored file (1 hour expiry)
export async function getSignedFileUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('markai-pdfs')
    .createSignedUrl(filePath, 3600);

  if (error) throw new Error(`Failed to create signed URL: ${error.message}`);
  return data.signedUrl;
}
