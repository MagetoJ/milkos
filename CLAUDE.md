# Frontend - Milk Collection Management Platform Guidelines

## Tech Stack & Architecture
- **Framework:** Next.js (App Router), TypeScript[cite: 1]
- **Styling:** Tailwind CSS, shadcn/ui, Lucide Icons[cite: 1]
- **Forms & Validation:** React Hook Form, Zod[cite: 1]
- **State & Data Fetching:** TanStack Query (React Query)[cite: 1]
- **Backend Context:** Integration with NestJS + Prisma + Keycloak[cite: 1]

## Core UX & Domain Principles
1. **Design Persona:** Clean, trusted, modern agricultural SaaS (Linear/Stripe aesthetic)[cite: 1]. Avoid excessive glassmorphism, heavy gradients, or cluttered tables[cite: 1].
2. **Mobile First for Collectors:** Mobile layouts (320px–430px) target Milk Collectors[cite: 1]. Large touch targets (>= 48px) for critical buttons[cite: 1].
3. **Tenant & Cooler Context:** AppShell must prominently display active Cooperative and Cooler[cite: 1]. Context switching must be clear[cite: 1].
4. **Command Palette:** Global search via `$Cmd/Ctrl+K$` covering Farmers, Coolers, Collections, and SMS[cite: 1].
5. **Offline-First:** Render explicit sync indicators (Connected, Offline, Syncing, Sync Error)[cite: 1]. Never block UI purely due to network drops[cite: 1].

## Key Workflow Rules
- **Multi-Farmer Allocation:**
  - Total batch weight = Allocated weight + Remaining weight[cite: 1].
  - Submit/Confirm button **MUST be disabled** unless `Remaining == 0`[cite: 1].
  - Visual status: Green (100% allocated), Amber (remaining quantity), Red (over-allocated)[cite: 1].
- **Scale Reading Interface:** Large weight display (e.g., `70.0 KG`), Bluetooth connectivity state indicator, Tare, Capture, Manual Entry[cite: 1].
- **SMS Credits & Billing:** SMS balances are ledger-derived[cite: 1]. Do not allow manual editing of balance displays[cite: 1]. Mask M-Pesa references[cite: 1].

## Common Commands
- **Dev Server:** `npm run dev`
- **Build:** `npm run build`
- **Lint / Typecheck:** `npm run lint` && `npx tsc --noEmit`
- **Test:** `npm test`

## Code Conventions
- Use functional React components with explicit TypeScript interfaces for Props.
- Place reusable UI components in `components/ui/` and feature domain components in `components/features/<domain>/`.
- Handle loading states with Skeleton loaders (never blank screens or plain spinners for major UI sections)[cite: 1].
- Every empty state must state what is missing and what action to take next[cite: 1].