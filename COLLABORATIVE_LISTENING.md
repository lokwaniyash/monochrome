# Collaborative Music Listening - Setup Guide

## Overview

This guide explains how to set up the collaborative music listening feature (Spotify Jam-like functionality) for the Monochrome music player.

## Features

- **Create Sessions**: Host creates a session to share music with friends
- **Join Sessions**: Friends join with a 6-character session code
- **Real-time Sync**: Playback is synced across all participants
- **Member Management**: See who's listening together
- **Session Persistence**: Sessions are stored and tracked in PocketBase

## Prerequisites

- Monochrome app is already set up
- PocketBase backend is running
- Users are authenticated

## Installation Steps

### 1. Add the Collaborative Listening Module

The main module is already created in `/js/collaborative-listening.js` and the UI handler is in `/js/collaborative-listening-ui.js`.

### 2. Create PocketBase Collections

You need to create a new collection called `collaborative_sessions` in your PocketBase instance:

#### Collection Name: `collaborative_sessions`

**Fields:**
- `id` (text, primary key) - Auto-generated
- `host_id` (text, required) - Firebase/Auth user ID of the session host
- `session_code` (text, required, unique) - 6-character unique code for joining
- `session_name` (text, required) - Friendly name for the session (e.g., "Road Trip")
- `members` (text) - JSON array of member objects
- `current_track` (text) - JSON of currently playing track
- `current_position` (number) - Current playback position in seconds
- `is_playing` (boolean) - Whether the session is currently playing
- `queue` (text) - JSON array of the queue
- `created_at` (date, system) - Auto-generated timestamp
- `updated_at` (date, system) - Auto-generated timestamp
- `last_activity` (date) - Last time someone interacted with the session

**Indexes:**
- On `session_code` (unique)
- On `host_id`
- On `created_at` (for cleanup of old sessions)

**Rules (Optional but recommended):**

For security, you can set up PocketBase rules. Create rules that allow users to:
- Create sessions (must be authenticated)
- Join sessions
- Update their own playback state
- Delete their own sessions

### 3. Import the Modules in app.js

Add to the imports in `/js/app.js`:

```javascript
import { initializeCollaborativeListeningUI } from './collaborative-listening-ui.js';
```

### 4. Initialize in app.js Main Function

After the Player and other managers are initialized, add:

```javascript
// Initialize Collaborative Listening UI
let collaborativeListeningUI = null;
if (authManager.user) {
    collaborativeListeningUI = initializeCollaborativeListeningUI(player, audioPlayer, ui);
}

// Restore active session if exists
if (collaborativeListeningUI) {
    await collaborativeListeningUI.restoreActiveSession();
}
```

### 5. Add CSS Import

Add to `/index.html` in the `<head>` section (or import it with your CSS bundler):

```html
<link rel="stylesheet" href="/css/collaborative-listening.css" />
```

### 6. Add UI Controls to Now Playing Bar

Add buttons to the now playing bar to access sessions. In the player controls section of `index.html`, add:

```html
<button id="collab-listening-start-btn" title="Start Jam Session">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="1" />
        <path d="M12 1v6m0 6v6" />
        <path d="M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24" />
        <path d="M1 12h6m6 0h6" />
        <path d="M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24" />
    </svg>
</button>

<button id="collab-listening-join-btn" title="Join Jam Session">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M22 16c0-1 -1-2-2.5-2M2 16c0-1 1-2 2.5-2" />
    </svg>
</button>
```

And attach event listeners:

```javascript
document.getElementById('collab-listening-start-btn').addEventListener('click', () => {
    collaborativeListeningUI?.openStartModal();
});

document.getElementById('collab-listening-join-btn').addEventListener('click', () => {
    collaborativeListeningUI?.openJoinModal();
});
```

### 7. Sync Playback on Player Changes

In `/js/events.js`, add calls to sync when playback state changes:

```javascript
// After play event
audioPlayer.addEventListener('play', () => {
    // ... existing code ...
    collaborativeListeningUI?.syncPlaybackState({ type: 'play' });
});

// After pause event
audioPlayer.addEventListener('pause', () => {
    // ... existing code ...
    collaborativeListeningUI?.syncPlaybackState({ type: 'pause' });
});

// After seeking
progressBar.addEventListener('change', () => {
    // ... existing code ...
    collaborativeListeningUI?.syncPlaybackState({ type: 'seek' });
});

// After next/previous
nextBtn.addEventListener('click', () => {
    // ... existing code ...
    collaborativeListeningUI?.syncPlaybackState({ type: 'next' });
});

prevBtn.addEventListener('click', () => {
    // ... existing code ...
    collaborativeListeningUI?.syncPlaybackState({ type: 'prev' });
});
```

## Usage

### For Session Host

1. Click "Start Jam Session" button in the player controls
2. (Optional) Enter a session name
3. Click "Create Session"
4. Share the 6-character session code with friends
5. Your playback will be synced to all participants

### For Guests

1. Click "Join Jam Session" button
2. Enter the 6-character session code provided by the host
3. Click "Join"
4. You'll see the host's playback and can see who else is listening
5. Click "Leave Session" to disconnect

## Architecture

### CollaborativeListeningManager (`collaborative-listening.js`)

The core manager class that handles:
- Session creation and joining
- Real-time synchronization via PocketBase WebSockets
- Playback state management
- Member tracking

**Key Methods:**
- `createSession(name)` - Create a new session
- `joinSession(code)` - Join an existing session
- `leaveSession()` - Leave current session
- `syncPlayback()` - Sync host's playback state
- `on(event, callback)` - Event listener system

### CollaborativeListeningUI (`collaborative-listening-ui.js`)

The UI handler that manages:
- Modal displays
- User interactions
- Visual updates
- Notifications

**Key Methods:**
- `openStartModal()` - Show create session dialog
- `openJoinModal()` - Show join session dialog
- `showActiveModal()` - Show active session details

## Real-time Sync

The implementation uses **PocketBase's WebSocket subscriptions** for real-time updates:

```javascript
pb.collection('collaborative_sessions').subscribe(sessionId, (data) => {
    if (data.action === 'update') {
        // Real-time update received
        this.applySessionPlayback(data.record);
    }
});
```

This ensures:
- **< 100ms latency** for most updates
- **Automatic reconnection** if connection drops
- **Efficient data transfer** (only deltas)

## Limitations & Future Improvements

### Current Limitations

1. **Only host can control playback** - Guests can't queue songs (could be added)
2. **5-member limit per session** - Configurable in `maxSessionSize`
3. **24-hour session expiry** - Sessions older than 24 hours are deleted
4. **No WebRTC audio** - Everyone streams from their own source

### Future Improvements

1. **Voting system** - Members vote on what to play next
2. **Chat messages** - Send messages within the session
3. **Playback history** - See what was played in the session
4. **Multiple sources** - Support for local files, playlists
5. **Mobile optimizations** - Better mobile UI/UX
6. **Spatial audio** - Know which direction other listeners are from
7. **Discord integration** - Link Discord voice to sessions
8. **Analytics** - Track session duration, members, playback patterns

## Troubleshooting

### Session Won't Create

**Check:**
- User is authenticated
- PocketBase is running and accessible
- Collection exists with correct schema

### Can't Join Session

**Check:**
- Session code is exactly 6 characters
- Session hasn't expired (older than 24 hours)
- Session isn't full (max 5 members)

### Playback Not Syncing

**Check:**
- WebSocket connection is active (check browser console)
- Host's playback controls are working
- Network connection is stable

### Cleanup Old Sessions

To remove old sessions, set up a PocketBase cron job or use the cleanup function:

```javascript
// In PocketBase admin > Settings > System:
// Create a hook to delete sessions older than 24 hours
db.dao().delete('collaborative_sessions', 'created_at < ?', [new Date(Date.now() - 24*60*60*1000)])
```

## Security Considerations

1. **Session codes are public** - Anyone with the code can join
2. **Host has full control** - Only the host can control playback
3. **Member info is visible** - Members see names and avatar URLs of other members
4. **No end-to-end encryption** - Data passes through your PocketBase server

### Recommended Security Setup

Set PocketBase rules to:
- Only allow authenticated users to create/join sessions
- Verify session host ID when accepting updates
- Rate limit session creation to prevent spam
- Log session activity for moderation

## Development Notes

**Module Exports:**

```javascript
export class CollaborativeListeningManager
export function createCollaborativeListeningManager(player, audioElement)

export class CollaborativeListeningUI
export function initializeCollaborativeListeningUI(player, audioElement, ui)
```

**Event Emitter Pattern:**

```javascript
manager.on('sessionCreated', (data) => {})
manager.on('sessionJoined', (data) => {})
manager.on('sessionLeft', (data) => {})
manager.on('membersUpdated', (data) => {})
manager.on('sessionUpdated', (data) => {})
manager.on('queueUpdated', (data) => {})
```

**Manager Properties:**

```javascript
manager.currentSession       // Active session object
manager.sessionCode         // 6-char code
manager.isSessionHost       // Boolean
manager.sessionMembers      // Array of members
```

## License & Attribution

Built for Monochrome Music Player. Compatible with PocketBase v0.21+

## Support

For issues and feature requests, please visit:
- GitHub Issues: https://github.com/monochrome-music/monochrome/issues
- Discord: https://monochrome.samidy.com/discord
