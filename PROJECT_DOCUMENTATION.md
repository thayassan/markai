# MarkAI - Technical Documentation Report

## 1. Project Overview
**MarkAI** is an advanced AI-powered examination marking and results analysis platform. It leverages Large Language Models (LLMs) to automate the marking of student answer sheets (PDFs) against a provided question paper and mark scheme.

### Target Users
*   **Students**: Can view their results, detailed AI feedback, and progress over time.
*   **Lecturers**: Can create marking sessions, upload papers, manage classes, and review/override AI-generated marks.
*   **Admins**: Can manage institutional access, invite lecturers/admins, and view university-wide performance metrics.

### Key Features
*   **Automated Marking**: AI-driven marking with support for complex text-based answers.
*   **PDF Extraction**: Robust extraction of text from uploaded PDF answer sheets.
*   **Adaptive LLM Integration**: Uses Groq (Llama 3) for high-speed marking and Gemini for fallback OCR/parsing.
*   **Detailed Analytics**: Interactive charts and stats for student and class performance.
*   **Conflict Resolution**: Lecturer override system to manually correct or refine AI marks.
*   **Secure Invitations**: Email-based invite system for onboarding staff.

---

## 2. Frontend Technical Stack
The frontend is a modern React 19 application built with Vite for high performance and developer productivity.

*   **Framework**: React 19 (via Vite)
*   **UI Components**: Custom-built using **Tailwind CSS 4.0** and **Lucide React** icons.
*   **Animations**: **Motion** (formerly Framer Motion) for smooth UI transitions and micro-animations.
*   **State Management**: **React Context API** (for Auth) and **TanStack Query (React Query)** for server state management.
*   **Routing**: **React Router Dom v7**.
*   **HTTP Client**: **Axios** with interceptors for auth headers.
*   **Charts/Visualization**: **Chart.js** (via `react-chartjs-2`) and **Recharts**.
*   **Form Handling**: Native React state with **Zod** for schema validation.
*   **TypeScript**: Strict configuration for type safety across the application.
*   **Styling**: **Tailwind CSS** with Glassmorphism and modern design aesthetics.

---

## 3. Backend Technical Stack
The backend is a robust TypeScript Node.js server using Express, designed for scalability and AI-heavy workloads.

*   **Runtime**: Node.js (v20+)
*   **Framework**: **Express** with TypeScript.
*   **ORM**: **Prisma** for type-safe database access.
*   **Database**: **PostgreSQL** (hosted on **Supabase**) with **pgBouncer** for connection pooling.
*   **Authentication**: **JWT** (JSON Web Tokens) with secure password hashing via **bcryptjs**.
*   **File Storage**: **Supabase Storage** (S3 compatible) for PDF uploads.
*   **Email Service**: **Resend** for sending institutional invitations.
*   **AI Integrations**:
    *   **Groq**: Primary marking engine (using Llama-3.3-70b-versatile) for ultra-fast inference.
    *   **Gemini**: Secondary engine for OCR fallback and complex document structure parsing.
*   **Logging**: **Winston** for structured logging (rotation enabled).
*   **Validation**: **Zod** for request body and environment variable validation.
*   **Other Libraries**: `pdf-parse` for text extraction, `pdfkit` for report generation, `archiver` for batch downloads.

---

## 4. Database Schema Documentation

### User Model
Purpose: Manages account details and roles.
*   `id`, `email`, `fullName`, `password`, `userType` (STUDENT/LECTURER/ADMIN).
*   `studentCode`, `universityId` (Optional).
*   Profile fields: `avatarUrl`, `phoneNumber`, `location`, `bio`.
*   Settings: `twoFactorAuth`, `emailAlerts`, `proPlan`, `verified`.

### MarkingSession Model
Purpose: Groups answer sheets for a specific exam.
*   `id`, `name`, `subject`, `sessionType`, `examBoard`, `paperType`.
*   `questionPdfUrl`, `markSchemePdfUrl`.
*   `markingStrictness` (Strict/Standard/Lenient), `feedbackDetail` (Brief/Detailed).
*   `status` (PENDING/PROCESSING/COMPLETED/REVIEW_REQUIRED).

### StudentAnswerSheet Model
Purpose: Tracks individual PDF uploads for a session.
*   `sessionId`, `studentId`, `pdfUrl`, `extractedText`, `extractMethod` (PDF-PARSE/GEMINI-OCR).

### StudentResult Model
Purpose: Stores the final AI-generated marks and feedback summary.
*   `totalMarks`, `maxMarks`, `percentage`, `grade`.
*   `aiData` (Stored as JSON for flexible reporting).
*   `reportPdfUrl` (Link to generated summary PDF).

### QuestionResult Model
Purpose: Granular breakdown of marks for every single question.
*   `questionNumber`, `marksAwarded`, `marksAvailable`, `status` (CORRECT/PARTIAL/INCORRECT).
*   `aiFeedback`, `lostMarksReason`, `improvementSuggestion`.
*   `lecturerOverride`: Field for manual mark adjustments.

### Invitation Model
Purpose: Manages staff invites.
*   `email`, `code` (Unique), `userType`, `used`, `expiresAt`.

---

## 5. API Endpoints Documentation

### Authentication (`/api/auth`)
*   `POST /register`: Public registration (requires student code for students).
*   `POST /login`: JWT-based authentication.

### Admin (`/api/admin`)
*   `POST /invite`: Send institutional invitation email.
*   `GET /invitations`: List all pending and used invites.
*   `DELETE /invitations/:id`: Revoke an invitation.
*   `GET /progress`: University-wide performance and system health stats.

### Sessions (`/api/sessions`)
*   `GET /`: List sessions (filtered by user role).
*   `POST /`: Create new marking session (Lecturer only).
*   `GET /:id`: Get session details and status.
*   `POST /:id/upload`: Upload student PDFs to session.
*   `POST /:id/process`: Trigger AI marking pipeline.
*   `GET /:id/progress`: Real-time marking progress stream.

### Results (`/api/results`)
*   `GET /student/results`: Get current user's results.
*   `GET /:id`: Get specific result detail.
*   `PATCH /:id/override`: Lecturer manual correction of a question mark.

### Profile (`/api/profile`)
*   `GET /`: Get current user profile.
*   `PUT /`: Update profile details.

---

## 6. Frontend Pages and Components

### Public Pages
- `LandingPage.tsx` (`/`): Product overview and features.
- `LoginPage.tsx` (`/login`): User authentication.
- `RegisterPage.tsx` (`/register`): Account creation (supports staff invite codes).

### Dashboard Pages
- `AdminDashboard.tsx` (`/admin`): Institutional analytics and invitation management.
- `LecturerDashboard.tsx` (`/dashboard`): Session overview and management.
- `StudentDashboard.tsx` (`/student/dashboard`): Result tracking and feedback.
- `NewSessionPage.tsx` (`/sessions/new`): Paper upload and AI configuration.
- `LecturerResultDetail.tsx` (`/results/:id`): Deep-dive marking review with override capability.

### Shared Components
- [`DashboardLayout.tsx`](./frontend/src/components/DashboardLayout.tsx): Sidebar and shell navigation.
- [`StudentBadge.tsx`](./frontend/src/components/StudentBadge.tsx): Status and grade visual identifiers.

---

## 7. AI Marking Pipeline

### 1. Data Ingestion
PDFs are uploaded to Supabase Storage and text is extracted via `pdf-parse`.
### 2. OCR Fallback
If extraction fails or text quality is low, the pipeline falls back to **Gemini 1.5 Pro** for vision-based OCR.
### 3. Contextual Parsing
Question papers and mark schemes are parsed into structured JSON to provide Ground Truth context to the marking engine.
### 4. Intelligent Chunking
To handle long student responses, text is processed in **3,000 character chunks**, ensuring high accuracy without hitting token limits.
### 5. Multi-Key Key Rotation
Automatic failover across 5 Groq keys prevents 429 Rate Limit issues during high-volume marking sessions.

---

## 8. Authentication & Security
- **JWT**: Secure tokens signed with HS256.
- **RBAC**: Strict role enforcement (ADMIN, LECTURER, STUDENT).
- **Invite-Only Staff**: Registration for Lecturers/Admins is restricted to those with valid invite codes.
- **Encryption**: Passwords hashed using bcryptjs (12 salt rounds).

---

## 9. Deployment Architecture
- **Frontend**: Hosted on **Netlify** with SPA redirection.
- **Backend**: Containerized and deployed on **Railway**.
- **Database**: **Supabase** (PostgreSQL + pgBouncer for connection efficiency).

---

## 10. File Structure
- `backend/`: API logic, Prisma schema, and rotation scripts.
- `frontend/`: React components, pages, and API hooks.
- `PROJECT_DOCUMENTATION.md`: Full technical report.
- `README.md`: Project overview and setup.

---

## 11. Key Technical Decisions
- **Groq over OpenAI**: Ultra-low latency inference for real-time marking feedback.
- **Supabase**: Integrated storage and database for rapid feature development.
- **Sequential Processing**: Optimized for stability on database free tiers.

---

## 12. Known Limitations and Future Improvements
- **Rate Limits**: Mitigated by key rotation but scalable with paid tiers.
- **Roadmap**: LMS integration (Moodle/Canvas), Handwriting recognition enhancements, and Peer-review features.
