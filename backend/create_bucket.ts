import { supabase } from './src/lib/supabase.js';

async function main() {
  const { data, error } = await supabase.storage.createBucket('markai-pdfs', {
    public: true,
    fileSizeLimit: 20971520 // 20MB
  });
  if (error) console.error("Error:", error.message);
  else console.log("Created bucket:", data);
}
main();
