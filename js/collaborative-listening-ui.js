//js/collaborative-listening-ui.js
import { CollaborativeListeningManager } from './collaborative-listening.js';
import { authManager } from './accounts/auth.js';

export class CollaborativeListeningUI {
    constructor(player, audioElement, ui) {
        this.player = player;
        this.audioElement = audioElement;
        this.ui = ui;
        this.manager = new CollaborativeListeningManager(player, audioElement);
        this.isInitialized = false;

        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        // Modal elements
        this.startModal = document.getElementById('collab-listening-start-modal');
        this.joinModal = document.getElementById('collab-listening-join-modal');
        this.activeModal = document.getElementById('collab-listening-active-modal');

        // Input elements
        this.sessionNameInput = document.getElementById('collab-session-name');
        this.sessionCodeInput = document.getElementById('collab-session-code');

        // Button elements
        this.createBtn = document.getElementById('collab-listening-create-btn');
        this.joinBtn = document.getElementById('collab-listening-join-btn');
        this.leaveBtn = document.getElementById('collab-leave-session-btn');
        this.copyCodeBtn = document.getElementById('collab-copy-code-btn');
        this.closeModalBtn = document.getElementById('collab-close-session-modal-btn');

        // Display elements
        this.membersList = document.getElementById('collab-members-list');
        this.memberCount = document.getElementById('collab-member-count');
        this.displayCode = document.getElementById('collab-display-code');
        this.displayName = document.getElementById('collab-display-name');
        this.hostControls = document.getElementById('collab-host-controls');
    }

    attachEventListeners() {
        // Create session
        this.createBtn?.addEventListener('click', () => this.handleCreateSession());
        document.getElementById('collab-listening-cancel-start')?.addEventListener('click', () => this.closeStartModal());

        // Join session
        this.joinBtn?.addEventListener('click', () => this.handleJoinSession());
        document.getElementById('collab-listening-cancel-join')?.addEventListener('click', () => this.closeJoinModal());

        // Leave session
        this.leaveBtn?.addEventListener('click', () => this.handleLeaveSession());

        // Utilities
        this.copyCodeBtn?.addEventListener('click', () => this.copySessionCode());
        this.closeModalBtn?.addEventListener('click', () => this.closeActiveModal());

        // Listen for manager events
        this.manager.on('sessionCreated', (data) => this.onSessionCreated(data));
        this.manager.on('sessionJoined', (data) => this.onSessionJoined(data));
        this.manager.on('sessionLeft', (data) => this.onSessionLeft(data));
        this.manager.on('membersUpdated', (data) => this.onMembersUpdated(data));
        this.manager.on('sessionUpdated', (data) => this.onSessionUpdated(data));
        this.manager.on('queueUpdated', (data) => this.onQueueUpdated(data));

        this.isInitialized = true;
    }

    // ==================== Session Management ====================

    async handleCreateSession() {
        if (!authManager.user) {
            this.showError('You must be logged in to create a session');
            return;
        }

        const sessionName = this.sessionNameInput?.value?.trim() || undefined;

        try {
            this.showLoading('Creating session...');
            await this.manager.createSession(sessionName);
            this.closeStartModal();
            this.showActiveModal();
            this.showSuccess('Session created! Share the code with friends.');
        } catch (error) {
            this.showError(`Failed to create session: ${error.message}`);
        }
    }

    async handleJoinSession() {
        if (!authManager.user) {
            this.showError('You must be logged in to join a session');
            return;
        }

        const sessionCode = this.sessionCodeInput?.value?.trim();
        if (!sessionCode || sessionCode.length !== 6) {
            this.showError('Please enter a valid 6-character session code');
            return;
        }

        try {
            this.showLoading('Joining session...');
            await this.manager.joinSession(sessionCode);
            this.closeJoinModal();
            this.showActiveModal();
            this.showSuccess('Successfully joined the session!');
        } catch (error) {
            this.showError(`Failed to join session: ${error.message}`);
        }
    }

    async handleLeaveSession() {
        if (!confirm('Are you sure you want to leave this session?')) {
            return;
        }

        try {
            await this.manager.leaveSession();
            this.closeActiveModal();
            this.showSuccess('Left the session');
        } catch (error) {
            this.showError(`Failed to leave session: ${error.message}`);
        }
    }

    // ==================== Modal Management ====================

    openStartModal() {
        this.sessionNameInput.value = '';
        this.startModal?.style.removeProperty('display');
        this.sessionNameInput?.focus();
    }

    closeStartModal() {
        this.startModal?.style.setProperty('display', 'none', 'important');
    }

    openJoinModal() {
        this.sessionCodeInput.value = '';
        this.joinModal?.style.removeProperty('display');
        this.sessionCodeInput?.focus();
    }

    closeJoinModal() {
        this.joinModal?.style.setProperty('display', 'none', 'important');
    }

    showActiveModal() {
        this.activeModal?.style.removeProperty('display');
        this.updateSessionDisplay();
    }

    closeActiveModal() {
        this.activeModal?.style.setProperty('display', 'none', 'important');
    }

    // ==================== Display Updates ====================

    updateSessionDisplay() {
        const sessionInfo = this.manager.getSessionInfo();
        if (!sessionInfo) {
            this.closeActiveModal();
            return;
        }

        // Update code and name
        this.displayCode.textContent = sessionInfo.sessionCode;
        this.displayName.textContent = sessionInfo.sessionName;

        // Update members
        this.updateMembersList(sessionInfo.members);

        // Show host controls if user is host
        if (sessionInfo.isHost) {
            this.hostControls?.style.removeProperty('display');
        } else {
            this.hostControls?.style.setProperty('display', 'none', 'important');
        }
    }

    updateMembersList(members) {
        this.membersList.innerHTML = '';
        this.memberCount.textContent = members.length;

        members.forEach((member) => {
            const memberEl = document.createElement('div');
            memberEl.className = 'collab-member-item';

            const avatar = document.createElement('div');
            avatar.className = 'collab-member-avatar';
            avatar.textContent = member.name.charAt(0).toUpperCase();
            if (member.photoURL) {
                avatar.style.backgroundImage = `url(${member.photoURL})`;
                avatar.style.backgroundSize = 'cover';
                avatar.textContent = '';
            }

            const info = document.createElement('div');
            info.className = 'collab-member-info';

            const name = document.createElement('div');
            name.className = 'collab-member-name';
            name.textContent = member.name;

            info.appendChild(name);

            const badge = document.createElement('span');
            badge.className = 'collab-member-badge';
            if (member.isHost) {
                badge.classList.add('host');
                badge.textContent = 'Host';
                info.appendChild(badge);
            }

            memberEl.appendChild(avatar);
            memberEl.appendChild(info);
            this.membersList.appendChild(memberEl);
        });
    }

    copySessionCode() {
        const code = this.manager.sessionCode;
        if (!code) return;

        navigator.clipboard
            .writeText(code)
            .then(() => this.showSuccess('Session code copied!'))
            .catch(() => this.showError('Failed to copy code'));
    }

    // ==================== Event Handlers ====================

    onSessionCreated(data) {
        console.log('[CollaborativeListening UI] Session created:', data);
        this.updateSessionDisplay();
    }

    onSessionJoined(data) {
        console.log('[CollaborativeListening UI] Session joined:', data);
        this.updateSessionDisplay();
    }

    onSessionLeft(data) {
        console.log('[CollaborativeListening UI] Session left');
        this.showSuccess('Left the Jam session');
    }

    onMembersUpdated(data) {
        console.log('[CollaborativeListening UI] Members updated:', data);
        this.updateMembersList(data.members);
    }

    onSessionUpdated(data) {
        console.log('[CollaborativeListening UI] Session updated');
        // Could update real-time info like now playing
    }

    onQueueUpdated(data) {
        console.log('[CollaborativeListening UI] Queue updated');
    }

    // ==================== Notifications ====================

    showNotification(message, type = 'info') {
        // Use existing notification system if available
        if (window.showNotification) {
            window.showNotification(message);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
        console.error('[CollaborativeListening] Error:', message);
    }

    showLoading(message) {
        this.showNotification(message, 'info');
    }

    // ==================== Integration Points ====================

    /**
     * Should be called from the player's sync events
     * @param {Object} event
     */
    syncPlaybackState(event) {
        if (this.manager.isInSession() && this.manager.isSessionHost) {
            this.manager.syncPlayback();
        }
    }

    /**
     * Should be called when app initializes
     * to check if there's an active session to restore
     */
    async restoreActiveSession() {
        const saved = sessionStorage.getItem('collaborative_session');
        if (saved) {
            try {
                const state = JSON.parse(saved);
                console.log('[CollaborativeListening UI] Restoring session:', state);
                // Could restore session here if needed
            } catch (error) {
                console.error('[CollaborativeListening UI] Failed to restore session:', error);
            }
        }
    }

    /**
     * Destroy the manager and clean up
     */
    destroy() {
        this.manager.destroy();
    }

    /**
     * Get the manager instance for direct access
     */
    getManager() {
        return this.manager;
    }
}

// Global reference to collaborative listening UI instance
let collabListeningInstance = null;

// Export singleton getter
export function initializeCollaborativeListeningUI(player, authManager) {
    const audioElement = document.getElementById('audio-player');
    collabListeningInstance = new CollaborativeListeningUI(player, audioElement, null);
    // Store in window for access from events.js
    window.collabListeningManager = collabListeningInstance.getManager();
    return collabListeningInstance;
}

export function getCollaborativeListeningInstance() {
    return collabListeningInstance;
}
