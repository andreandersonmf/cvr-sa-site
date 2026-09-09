# CVR SA - CVR South America

A modern sports league management platform built with contemporary web
technologies. CVR SA is a complete system for organizing competitions
for the Roblox game **CVR: Retro**, with authentication, fixtures,
rankings and an admin panel.

🌐 **[Visit the platform here](https://cvr-sa.vercel.app/)**

---

## ✨ Highlights

- ⚡ **Full League Management** - Create teams, organize fixtures and track standings
- 🎮 **Roblox Integration** - Data sync via the Roblox API
- 📊 **Real-Time Dashboard** - Up-to-date stats and rankings
- 👥 **Role System** - Admin, Referee, Media and Stat Tracker
- 🏐 **Court Captain** - An extra roster role alongside Captain and Vice Captain
- 📱 **Responsive** - Works great on desktop, tablet and mobile
- 🔐 **Secure Authentication** - Discord OAuth + a robust login system
- 🎨 **Modern Design** - Dark premium interface with Tailwind CSS

---

## 🚀 Tech Stack

### Frontend
- **[React.js](https://react.dev/)** - JavaScript UI library
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first styling
- **[Next.js](https://nextjs.org/)** - React framework with SSR/SSG

### Backend & Deployment
- **[Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)** - Serverless backend
- **[Supabase](https://supabase.com/)** - Postgres database + Auth, shared with the cvr-sa-bot Discord bot
- **[Vercel](https://vercel.com/)** - Hosting and deployment
- **[Roblox API](https://developer.roblox.com/)** - Roblox integration

---

## 📋 Main Features

### 🏠 Home
- Landing page with league information
- Quick stats (format, timezone, registered teams)
- Call-to-action for registration and viewing matches

### 👥 Teams
- Full directory of registered teams
- Captain and roster views (Captain, Vice Captain, Court Captain, Player)
- Filter by country
- Access to each team's data

### 📅 Fixtures
- Match calendar with advanced filters
- Filter by stage (Groups, Playoffs)
- Referee and media information
- Match status (Scheduled, Live, Finished)

### 📊 Standings
- Detailed standings table
- Stats: points, wins, losses, sets
- View by group (A, B, C, D)
- Point and set differential

### ⚙️ Admin Panel
- Team management
- Creating and editing fixtures
- Recording final results
- Staff approval (referees, media)
- Matchmaking VIP/VIP+ oversight

### 📝 Registration
- Team sign-up with validation
- Available-country selection
- Brick color customization
- Requirement confirmation

### 👔 Staff Applications
- Apply as referee or media
- Approval workflow
- Match assignment

---

## 🛠️ Getting Started Locally

### Prerequisites
- Node.js 20+
- npm, yarn or pnpm
- A Supabase project with `schema.sql` (from the cvr-sa-bot repo) applied

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/cvr-sa-site.git
cd cvr-sa-site

# Install dependencies
npm install
# or
yarn install
# or
pnpm install

# Copy the env template and fill in your values
cp .env.example .env.local

# Run the dev server
npm run dev
```

The site expects the same Supabase project as **cvr-sa-bot** (see that
repo's `schema.sql` and `.env.example`). Team roles, matches, VIP
subscriptions and matchmaking data are shared live between the bot and
the site - there is no separate sync step.
