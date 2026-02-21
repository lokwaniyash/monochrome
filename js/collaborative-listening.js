//js/collaborative-listening.js
import { syncManager } from './accounts/pocketbase.js';
import { authManager } from './accounts/auth.js';
import { debounce } from './utils.js';

export class CollaborativeListeningManager {
    constructor(player, audioElement) {
        this.player = player;
        this.audioElement = audioElement;
        this.currentSession = null;
        this.sessionCode = null;
        this.isSessionHost = false;
        this.sessionMembers = [];
        this.syncInProgress = false;
        this.lastSyncTime = 0;
        this.unsubscribe = null;
        this.listeners = {};
        this.maxSessionSize = 5;
        this.sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours

        // Load saved session if exists
        this.loadSessionState();
    }

    // ==================== Session Management ====================

    async createSession(sessionName = null) {
        const user = authManager.user;
        if (!user) {
            throw new Error('Must be logged in to create a session');
        }

        try {
            // Generate session code (6 alphanumeric characters)
            const sessionCode = this.generateSessionCode();

            const sessionData = {
                host_id: user.uid,
                session_code: sessionCode,
                session_name: sessionName || `${user.displayName || 'User'}'s Jam`,
                members: JSON.stringify([
                    {
                        id: user.uid,
                        name: user.displayName || 'Anonymous',
                        photoURL: user.photoURL || null,
                        joinedAt: new Date().toISOString(),
                        isHost: true,
                    },
                ]),
                current_track: null,
                current_position: 0,
                is_playing: false,
                queue: JSON.stringify(this.player.queue),
                created_at: new Date().toISOString(),
                last_activity: new Date().toISOString(),
            };

            const record = await syncManager.pb.collection('collaborative_sessions').create(sessionData);

            this.currentSession = record;
            this.sessionCode = sessionCode;
            this.isSessionHost = true;
            this.sessionMembers = JSON.parse(record.members);

            this.saveSessionState();
            this.subscribe();
            this.emit('sessionCreated', { sessionCode, sessionId: record.id });

            return {
                sessionCode,
                sessionId: record.id,
                sessionName: record.session_name,
            };
        } catch (error) {
            console.error('[CollaborativeListening] Failed to create session:', error);
            throw error;
        }
    }

    async joinSession(sessionCode) {
        const user = authManager.user;
        if (!user) {
            throw new Error('Must be logged in to join a session');
        }

        try {
            // Find session by code
            const session = await syncManager.pb
                .collection('collaborative_sessions')
                .getFirstListItem(`session_code="${sessionCode.toUpperCase()}"`);

            // Check if session is still valid (not older than 24 hours)
            const createdTime = new Date(session.created_at).getTime();
            if (Date.now() - createdTime > this.sessionTimeout) {
                await syncManager.pb.collection('collaborative_sessions').delete(session.id);
                throw new Error('Session has expired');
            }

            // Check member limit
            const members = JSON.parse(session.members);
            if (members.length >= this.maxSessionSize) {
                throw new Error(`Session is full (max ${this.maxSessionSize} members)`);
            }

            // Check if already in session
            if (members.some((m) => m.id === user.uid)) {
                throw new Error('You are already in this session');
            }

            // Add user to session
            members.push({
                id: user.uid,
                name: user.displayName || 'Anonymous',
                photoURL: user.photoURL || null,
                joinedAt: new Date().toISOString(),
                isHost: false,
            });

            const updated = await syncManager.pb.collection('collaborative_sessions').update(session.id, {
                members: JSON.stringify(members),
                last_activity: new Date().toISOString(),
            });

            this.currentSession = updated;
            this.sessionCode = sessionCode.toUpperCase();
            this.isSessionHost = false;
            this.sessionMembers = members;

            this.saveSessionState();
            this.subscribe();
            this.emit('sessionJoined', { sessionCode, sessionId: session.id });

            return {
                sessionCode: sessionCode.toUpperCase(),
                sessionId: session.id,
                sessionName: session.session_name,
                members: members,
            };
        } catch (error) {
            console.error('[CollaborativeListening] Failed to join session:', error);
            throw error;
        }
    }

    async leaveSession() {
        if (!this.currentSession) {
            throw new Error('Not in a session');
        }

        try {
            const user = authManager.user;
            const members = JSON.parse(this.currentSession.members);
            const updatedMembers = members.filter((m) => m.id !== user.uid);

            if (updatedMembers.length === 0) {
                // Delete session if no members left
                await syncManager.pb.collection('collaborative_sessions').delete(this.currentSession.id);
            } else {
                // Update members list
                const newHost = updatedMembers[0];
                if (this.isSessionHost && updatedMembers.length > 0) {
                    newHost.isHost = true;
                }

                await syncManager.pb.collection('collaborative_sessions').update(this.currentSession.id, {
                    members: JSON.stringify(updatedMembers),
                    host_id: newHost.id,
                    last_activity: new Date().toISOString(),
                });
            }

            this.unsubscribe?.();
            this.clearSessionState();
            this.emit('sessionLeft', { sessionCode: this.sessionCode });
        } catch (error) {
            console.error('[CollaborativeListening] Failed to leave session:', error);
            throw error;
        }
    }

    // ==================== Playback Sync ====================

    async syncPlayback() {
        if (!this.currentSession || !this.isSessionHost || this.syncInProgress) {
            return;
        }

        // Debounce syncs to avoid excessive updates
        const now = Date.now();
        if (now - this.lastSyncTime < 500) {
            return;
        }
        this.lastSyncTime = now;

        try {
            this.syncInProgress = true;

            const payload = {
                current_track: this.player.currentTrack ? JSON.stringify(this.player.currentTrack) : null,
                current_position: Math.round(this.audioElement.currentTime),
                is_playing: !this.audioElement.paused,
                queue: JSON.stringify(this.player.queue),
                last_activity: new Date().toISOString(),
            };

            await syncManager.pb.collection('collaborative_sessions').update(this.currentSession.id, payload);
        } catch (error) {
            console.error('[CollaborativeListening] Failed to sync playback:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    async applySessionPlayback(session) {
        if (this.isSessionHost) return; // Hosts don't apply changes from session

        try {
            // Update current track
            if (session.current_track) {
                const track = JSON.parse(session.current_track);
                if (!this.player.currentTrack || this.player.currentTrack.id !== track.id) {
                    await this.player.playTrack(track);
                }
            }

            // Sync position
            const positionDiff = Math.abs(this.audioElement.currentTime - session.current_position);
            if (positionDiff > 2) {
                // Only sync if difference is more than 2 seconds
                this.audioElement.currentTime = session.current_position;
            }

            // Sync playing state
            if (session.is_playing && this.audioElement.paused) {
                this.audioElement.play().catch((e) => {
                    console.warn('[CollaborativeListening] Failed to play:', e);
                });
            } else if (!session.is_playing && !this.audioElement.paused) {
                this.audioElement.pause();
            }

            // Update queue if different
            if (session.queue) {
                const sessionQueue = JSON.parse(session.queue);
                if (JSON.stringify(sessionQueue) !== JSON.stringify(this.player.queue)) {
                    this.player.queue = sessionQueue;
                    this.emit('queueUpdated', { queue: sessionQueue });
                }
            }
        } catch (error) {
            console.error('[CollaborativeListening] Failed to apply session playback:', error);
        }
    }

    // ==================== Real-time Subscriptions ====================

    subscribe() {
        if (!this.currentSession) return;

        try {
            this.unsubscribe = syncManager.pb
                .collection('collaborative_sessions')
                .subscribe(this.currentSession.id, (data) => {
                    if (data.action === 'update') {
                        this.currentSession = data.record;
                        this.sessionMembers = JSON.parse(data.record.members);
                        this.emit('membersUpdated', { members: this.sessionMembers });

                        if (!this.isSessionHost) {
                            this.applySessionPlayback(data.record);
                        }

                        this.emit('sessionUpdated', { session: data.record });
                    }
                });

            console.log('[CollaborativeListening] Subscribed to session updates');
        } catch (error) {
            console.error('[CollaborativeListening] Failed to subscribe:', error);
        }
    }

    // ==================== Utility Methods ====================

    generateSessionCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    getSessions() {
        return {
            current: this.currentSession,
            code: this.sessionCode,
            isHost: this.isSessionHost,
            members: this.sessionMembers,
            memberCount: this.sessionMembers.length,
        };
    }

    isInSession() {
        return !!this.currentSession;
    }

    getSessionInfo() {
        if (!this.currentSession) return null;

        return {
            sessionId: this.currentSession.id,
            sessionCode: this.sessionCode,
            sessionName: this.currentSession.session_name,
            isHost: this.isSessionHost,
            members: this.sessionMembers,
            currentTrack: this.currentSession.current_track
                ? JSON.parse(this.currentSession.current_track)
                : null,
            isPlaying: this.currentSession.is_playing,
            createdAt: new Date(this.currentSession.created_at),
        };
    }

    // ==================== State Persistence ====================

    saveSessionState() {
        if (this.currentSession) {
            sessionStorage.setItem('collaborative_session', JSON.stringify({
                sessionId: this.currentSession.id,
                sessionCode: this.sessionCode,
            }));
        }
    }

    loadSessionState() {
        const saved = sessionStorage.getItem('collaborative_session');
        if (saved) {
            try {
                const state = JSON.parse(saved);
                // TODO: Restore session when app reloads
                console.log('[CollaborativeListening] Found saved session state:', state);
            } catch (error) {
                console.error('[CollaborativeListening] Failed to load session state:', error);
            }
        }
    }

    clearSessionState() {
        sessionStorage.removeItem('collaborative_session');
        this.currentSession = null;
        this.sessionCode = null;
        this.isSessionHost = false;
        this.sessionMembers = [];
    }

    // ==================== Event Emitter Pattern ====================

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach((callback) => callback(data));
    }

    // ==================== Cleanup ====================

    destroy() {
        this.unsubscribe?.();
        this.clearSessionState();
    }
}

// Export singleton instance creator
export function createCollaborativeListeningManager(player, audioElement) {
    return new CollaborativeListeningManager(player, audioElement);
}
