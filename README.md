# MarkAI

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.0-2D3748?logo=prisma)](https://www.prisma.io/)
[![Supabase](https://img.shields.io/badge/Supabase-DB-3ECF8E?logo=supabase)](https://supabase.io/)

MarkAI is an AI-powered examination marking platform that automates the process of grading student answer sheets (PDFs) with high precision and detailed feedback using Llama-3 (via Groq) and Gemini.

---

## 🚀 Key Features
- **Instant AI Marking**: Results in seconds using high-speed Groq inference.
- **Image-to-Text OCR**: Support for handwritten or image-based PDFs using Gemini OCR.
- **Detailed Analytics**: Student and class-wide performance charts.
- **Conflict Resolution**: Lecturer manual override and feedback adjustment system.
- **Institutional Onboarding**: Secure, email-based staff invitation system.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- Node.js (v20 or higher)
- A Supabase account (PostgreSQL)
- API Keys: Groq, Gemini, Resend

### 2. Database Initialization
```bash
cd backend
npm install
# Copy .env.example to .env and fill in your keys
npx prisma generate
npx prisma db push
```

### 3. Run Backend
```bash
npm run dev
```

### 4. Run Frontend
```bash
cd ../frontend
npm install
npm run dev
```

---

## 🔐 Environment Variables & Security

**IMPORTANT:** Never commit your `.env` files to version control. The project includes a root `.gitignore` configured to exclude all `.env` files.

### Backend (`backend/.env`)
Create a `.env` file in the `backend` directory using `.env.example` as a template:
- `DATABASE_URL`: Your Supabase/PostgreSQL connection string.
- `JWT_SECRET`: A secure random string for signing authentication tokens.
- `GROQ_API_KEY_1`...`5`: Your Groq API keys (Rotation logic supports up to 5).
- `GEMINI_API_KEY`: Your Google AI Studio API key.
- `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`: Found in your Supabase project settings.
- `RESEND_API_KEY`: Your Resend API key for institutional emails.

### Frontend (`frontend/.env`)
Create a `.env` file in the `frontend` directory:
- `VITE_API_URL`: The URL of your running backend (defaults to `http://localhost:3000`).

---

## 🛡️ Privacy & Security Best Practices
- **Secret Management**: Use GitHub Secrets or environment variable management in Netlify/Railway for production.
- **Invite Codes**: Initial Admin/Lecturer accounts require invite codes generated via the Admin dashboard to prevent unauthorized registration.
- **Data Isolation**: Student data is isolated by `studentCode` and strict RLS/Prisma filters.

---

## 🌍 Deployment

### Frontend (Netlify)
1. Push `frontend` directory to GitHub.
2. Link Netlify to the repository.
3. Set build command: `npm run build`
4. Set publish directory: `dist`
5. Add `_redirects` for SPA routing.

### Backend (Railway)
1. Push `backend` directory to GitHub.
2. Link Railway to the repository.
3. Railway will auto-detect the Docker/Node environment via `railway.json`.

---

## 📄 Documentation
For a deep dive into the architecture, AI marking pipeline, and API endpoints, see the [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md) file.
