# Pitch Manager - Football Manager Game

A full-featured football manager game inspired by Top Eleven, with 2D animated match viewer.

## Quick Start (Local Development)

No Firebase setup required! The game includes a local in-memory database for development.

```bash
# Install dependencies
npm install

# Start in development mode (uses local database)
npm run dev

# Or start normally - it will auto-detect and use local DB if no Firebase credentials
npm start
```

Then open http://localhost:3000 in your browser.

## Features

### Core Gameplay
- **Top Eleven-style 2D match viewer** - Watch your matches with animated players passing and shooting
- **Skill-based match engine** - Results depend on player attributes, tactics, form, and morale
- **Full league system** - 20 teams, 38 matchday season with proper standings
- **Player development** - Young players grow, old players decline
- **Transfer market** - Buy and sell players with AI clubs also trading
- **Training system** - Improve player attributes
- **Tactical system** - Choose formations, mentality, pressing, and tempo

### Player System
- **Attributes**: Pace, Shooting, Passing, Defending, Physical, Goalkeeping
- **Form & Morale**: Affects match performance
- **Injuries & Suspensions**: Players can get injured or suspended
- **Contracts**: Players have contract years, become free when expired
- **Aging**: Players age each season, affecting their abilities

### Match Engine
- **Realistic simulation** based on team and player strengths
- **Detailed events**: Goals, assists, cards, injuries
- **Player ratings** after each match
- **Match statistics**: Possession, shots, corners, fouls
- **Animated match viewer** with live commentary

## Deployment

### Local Development (No Firebase)
The game automatically uses an in-memory database when Firebase credentials are not provided. Perfect for testing and development.

### Production (With Firebase)
To deploy with persistent data:

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Firestore Database
3. Generate a service account key (JSON)
4. Set environment variables:
   ```bash
   export FIREBASE_PROJECT_ID=your-project-id
   export FIREBASE_CLIENT_EMAIL=your-client-email
   export FIREBASE_PRIVATE_KEY=your-private-key
   ```
5. Deploy to Vercel:
   ```bash
   vercel
   ```

## Game Mechanics

### Match Simulation
- Goals are calculated using Poisson distribution based on team attack/defense strength
- Player attributes affect who scores and assists
- Form and morale modifiers impact performance
- Home advantage gives 8% boost
- Injuries occur randomly during matches (3% chance per player)

### Player Development
- **Young players (age < 24)**: Can grow 1-3 OVR per season based on potential
- **Peak players (24-29)**: Stable performance
- **Veterans (30+)**: Gradual decline in pace and physical attributes
- **Training**: Costs money, reduces fitness, can improve attributes

### Transfer Market
- Player values based on OVR, age, and position
- AI clubs buy and sell players
- Contract system with yearly wages
- Transfer budget management

### League System
- 20 teams, round-robin format (38 matchdays)
- 3 points for win, 1 for draw
- Standings sorted by points, then goal difference, then goals scored
- Season ends with player aging and new season generation

## Project Structure

```
pitch-manager/
├── server.js              # Express server and API routes
├── db.js                  # Database layer (Firebase or local)
├── match-simulator.js     # Match simulation engine
├── league-manager.js      # League system and season management
├── player-generator.js    # Player generation and attributes
├── match-viewer.js        # 2D canvas match animation
├── index.html             # Frontend HTML
├── app.js                 # Frontend JavaScript
├── style.css              # Styling
└── vercel.json            # Vercel deployment config
```

## Development

The local database stores everything in memory, so data resets when you restart the server. This is intentional for easy development and testing.

To reset the database during development, simply restart the server.

## License

ISC
