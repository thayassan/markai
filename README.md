<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b944c1bc-c220-4419-81fb-7d74657bab50

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Adding New Database Fields
To ensure consistency between the Prisma schema, the local client, and the Supabase database, follow this exact workflow:

1. **Schema Update**: Add the new field to `backend/prisma/schema.prisma`.
2. **Database Update**: Manually add the corresponding column in the **Supabase SQL Editor**.
3. **Generate Client**: Run `npx prisma generate` in the `backend` directory.
4. **Reload Server**: Run `touch backend/server.ts` to force the dev server to reload the fresh Prisma client.
5. **Verify**: Use the test scripts or check the startup logs for: `✅ Schema validated against Supabase`.

> [!WARNING]
> Never use `@default` on new fields without a full Supabase migration, as the Supabase Pooler (port 6543) may block standard migrations. Always prefer manual SQL addition for incremental changes.
