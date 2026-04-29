# HevyLoad

Workout analytics for Hevy data focusing on powerlifting metrics.

## Features

- Powerlifting Total calculation (Squat, Bench, Deadlift)
- SBD performance showcase
- Weekly tonnage tracking
- CSV data import support
- Exercise history and charts

## Setup

1. Install dependencies:
   npm install

2. Create a .env file with your Supabase credentials:
   EXPO_PUBLIC_SUPABASE_URL=your_url
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_key

3. Initialize the database using the schema.sql file in the Supabase SQL editor.

4. Start the app:
   npx expo start

## Usage

Export your Hevy data as a CSV and upload it via the Import section in the app.
