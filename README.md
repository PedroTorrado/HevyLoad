# HevyLoad

Workout analytics for Hevy data focusing on powerlifting metrics, personalized training suggestions, and progression planning.

## Features

- Powerlifting Total calculation (Squat, Bench, Deadlift)
- SBD performance showcase
- Weekly tonnage tracking
- CSV data import support
- Exercise history and charts
- Personalized workout suggestions based on your imported exercises and recent working sets
- Push/pull/legs, upper/lower, and full-body split planning
- Suggested working loads using estimated one-rep maxes from Supabase history
- External-LLM program calendar for running, weight training, or combined plans

## Setup

1. Install dependencies:
   npm install

2. Create a .env file with your Supabase credentials:
   EXPO_PUBLIC_SUPABASE_URL=your_url
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_key

3. Apply every SQL file in `supabase/migrations/` to your Supabase project in
   timestamp order. If you use the Supabase CLI, run `supabase db push`.

4. Start the app:
   npx expo start

For production checks, run:

```bash
npm run typecheck
npm run lint
npm run build:web
```

## Usage

Export your Hevy data as a CSV and upload it via the Import section in the app.

## Web app

HevyLoad runs as a web app through Expo, while using the same Supabase project and
authentication flow as the mobile builds:

```bash
npm run web
```

After importing workout data, open **Workout suggestions** from the dashboard to
choose a training split and get exercise and working-load recommendations based on
your own history. The recommendations are calculated in the client from the
Supabase `exercises`, `sets`, `workouts`, and `profiles` tables; no additional
database tables are required.

Open **Program Calendar** to build a copy-ready prompt from your history, give it
to an external LLM, and import the returned JSON plan into a dated calendar.
Calendar storage is isolated in `calendar_programs` and `calendar_sessions` and
can be removed with the matching rollback SQL under `supabase/rollback/`.
