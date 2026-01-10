# AI Coding Instructions - Sr. Cardoso Barbearia

## Project Overview

PWA barbershop booking system for "Barbearia Sr. Cardoso" with mobile-first client flow and comprehensive admin panel. **GCP Project**: `sr-cardoso-barbearia-prd` (Region: `us-central1`)

## Architecture

### Monorepo Structure (npm workspaces)
```
apps/web/       → React + Vite frontend (client + admin)
apps/server/    → Express backend (Cloud Run)
apps/functions/ → Firebase Cloud Functions (legacy, admin actions)
packages/shared/→ Shared types, Zod schemas, utilities
```

**Hybrid Backend**: The Express API (`apps/server/`) handles most endpoints via HTTP, while Firebase Functions (`apps/functions/`) are used for specific admin operations via Firebase SDK client calls.

### Tech Stack
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, Luxon (dates), TanStack Query
- **Backend**: Express, Firestore, Cloud Storage, Evolution API (WhatsApp)
- **Auth**: JWT (HS256, 7d expiry) with role-based access (`master` | `barber`)

## Critical Business Rules

### Timezone & Localization
- **Timezone**: `America/Sao_Paulo` (hardcoded in [packages/shared/src/utils/dates.ts](packages/shared/src/utils/dates.ts))
- **Locale**: PT-BR for ALL user-facing strings (status labels, buttons, messages)
- **Slots**: 30-minute intervals, operating hours typically 08:00-18:30

### Owner Barber Priority
- Barber **Sr. Cardoso** has fixed ID: `sr-cardoso` (constant: `OWNER_BARBER_ID`)
- Always displayed **first** in barber lists/tabs (see admin pages)

### Role-Based Access Control (RBAC)
- **`master`**: Full admin access, can manage all barbers/users
- **`barber`**: Scoped access to own `barberId` only
- JWT claims: `{ role, username, barberId? }` decoded client-side in [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts#L60-L78)
- Token stored in `localStorage` key: `sr_admin_token`

## Key Patterns & Conventions

### Date Handling
- Use Luxon `DateTime` with timezone set to `America/Sao_Paulo`
- Helper functions in [packages/shared/src/utils/dates.ts](packages/shared/src/utils/dates.ts):
  - `getNow()`: Current DateTime in São Paulo timezone
  - `getDateKey(date)`: Returns `YYYY-MM-DD` string
  - `generateSlotId(slot)`: Returns `YYYYMMDD_HHmm` format
- **Defensive parsing**: Admin pages use `toDateSafe()` to handle mixed date types (Date/string/number/Timestamp) - see [apps/web/src/pages/admin/CustomersPage.tsx](apps/web/src/pages/admin/CustomersPage.tsx)

### Authentication Flow
1. Login: `POST /api/admin/login` with `username` + `password`
2. Server validates against `adminUsers` collection (PBKDF2 password hash)
3. Returns JWT signed with `ADMIN_JWT_SECRET`
4. Frontend stores token and decodes claims for UI logic
5. All admin API calls include `Authorization: Bearer <token>` header

### API Client Pattern
- Centralized in [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts)
- Use `apiFetch<T>(path, { admin: true })` for authenticated requests
- Frontend never validates JWT signature (server-side only)
- Auth state changes trigger `sr_admin_token_changed` event

### Firestore Collections
- `barbers`: Professional profiles with `active: boolean` flag
- `barbers/{barberId}/slots`: Slot-level bookings
- `bookings`: Booking records with status tracking
- `customers`: Customer profiles with statistics
- `adminUsers`: Admin login credentials (PBKDF2 hashed passwords)
- `whatsappMessageQueue`: Retry queue for failed WhatsApp notifications

### WhatsApp Integration (Evolution API)
- **Client**: [apps/server/src/lib/evolutionApi.ts](apps/server/src/lib/evolutionApi.ts) wraps Evolution API v2
- **Communication**: Cloud Run → VM via Direct VPC Egress (internal IP)
- **Notifications**: Automatic confirmation/reminder/cancellation messages
- **Config**: Firestore `settings/whatsapp-notifications` controls templates and timing
- **Retry**: Failed messages queued in `whatsappMessageQueue` (max 3 attempts)
- **Cron Jobs**: Cloud Scheduler triggers `/api/cron/send-reminders` and `/api/cron/process-queue`

## Development Workflow

### Common Commands
```bash
# Install dependencies (root)
npm install

# Dev servers
npm run dev              # Frontend only (port 5173)
npm run dev:server       # Backend only (port 8080)

# Build
npm run build            # All workspaces
npm run build:shared     # Must run before other builds (types dependency)
npm run build:web        # Frontend production build

# Type checking
npm run type-check       # All workspaces
```

### Local Setup
1. Install Node.js ≥18.0.0, npm ≥9.0.0
2. Configure Google Cloud SDK: `gcloud config set project sr-cardoso-barbearia-prd`
3. Create service account key JSON for Firestore access
4. Set `GOOGLE_APPLICATION_CREDENTIALS` env var
5. Initialize barbers: `npx tsx scripts/init-barbers.ts`
6. Copy `.env.example` to `apps/web/.env` and set `VITE_API_BASE_URL`

### Deployment
- **Script**: [scripts/deploy-cloudrun.sh](scripts/deploy-cloudrun.sh) (manual Docker build → Artifact Registry → Cloud Run)
- **Firestore Rules**: Deploy via `gcloud firestore rules create --file=firebase/firestore.rules`
- **Environment**: Set Cloud Run env vars: `ADMIN_JWT_SECRET`, `GCP_PROJECT_ID`, `GCP_STORAGE_BUCKET`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`

## Code Quality Standards

### TypeScript
- Strict mode enabled across all workspaces
- Shared types MUST live in [packages/shared/src/types/](packages/shared/src/types/)
- Use Zod schemas for runtime validation ([packages/shared/src/schemas/](packages/shared/src/schemas/))

### UI Components
- Use shadcn/ui components from [apps/web/src/components/ui/](apps/web/src/components/ui/)
- Admin components in [apps/web/src/components/admin/](apps/web/src/components/admin/)
- Mobile-first responsive design (Tailwind breakpoints)
- Barber tabs use **horizontal scroll** to avoid wrapping

### Error Handling
- Protected routes check auth state via [apps/web/src/components/ProtectedRoute.tsx](apps/web/src/components/ProtectedRoute.tsx)
- ErrorBoundary respects context (admin vs client) - see [apps/web/src/components/ErrorBoundary.tsx](apps/web/src/components/ErrorBoundary.tsx)
- API errors return `{ error: string }` shape

## Key Files Reference

- **Canonical Context**: [CONTEXTO.md](CONTEXTO.md) - authoritative project decisions and rules
- **API Surface**: [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) - all frontend API calls
- **Admin Auth**: [apps/server/src/lib/adminAuth.ts](apps/server/src/lib/adminAuth.ts) - JWT signing/verification, password hashing
- **Booking Types**: [packages/shared/src/types/booking.ts](packages/shared/src/types/booking.ts) - booking status enum and structure
- **Slot Utils**: [apps/web/src/utils/slots.ts](apps/web/src/utils/slots.ts) - slot generation and formatting

## Before Making Changes

**Checklist**:
- ✅ PT-BR locale preserved in all UI strings?
- ✅ Timezone `America/Sao_Paulo` maintained?
- ✅ Master can access all barbers, barber scoped to own ID?
- ✅ Sr. Cardoso (`sr-cardoso`) appears first in lists?
- ✅ Build succeeds: `npm run build:shared && npm run build:web`?

## Known Technical Debt

- `toDateSafe()` duplicated across admin pages (should be extracted to shared utility)
- Hybrid backend (server + functions) creates ambiguity - consult [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) to identify which routes are HTTP vs Firebase SDK
