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

        // Leave / Delete session
        this.leaveBtn?.addEventListener('click', () => this.handleLeaveSession());
        document.getElementById('collab-delete-session-btn')?.addEventListener('click', () => this.handleDeleteSession());

        // Close active modal (just hides it, stays in session)
        this.closeModalBtn?.addEventListener('click', () => this.closeActiveModal());

        // Utilities
        this.copyCodeBtn?.addEventListener('click', () => this.copySessionCode());

        // Close modals when clicking backdrop
        this.startModal?.addEventListener('click', (e) => { if (e.target === this.startModal) this.closeStartModal(); });
        this.joinModal?.addEventListener('click', (e) => { if (e.target === this.joinModal) this.closeJoinModal(); });
        this.activeModal?.addEventListener('click', (e) => { if (e.target === this.activeModal) this.closeActiveModal(); });

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

        // If already in a session, just show active modal
        if (this.manager.isInSession()) {
            this.closeStartModal();
            this.showActiveModal();
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

        // If already in a session, just show the active modal info
        if (this.manager.isInSession()) {
            this.closeJoinModal();
            this.showActiveModal();
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
            // If "already in this session" error, show active modal instead
            if (error.message && error.message.toLowerCase().includes('already in this session')) {
                this.closeJoinModal();
                this.showActiveModal();
            } else {
                this.showError(`Failed to join session: ${error.message}`);
            }
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

    async handleDeleteSession() {
        if (!confirm('Are you sure you want to end this jam session for everyone?')) {
            return;
        }

        try {
            // Host leaving deletes the session when they are the host
            await this.manager.leaveSession();
            this.closeActiveModal();
            this.showSuccess('Session ended');
        } catch (error) {
            this.showError(`Failed to end session: ${error.message}`);
        }
    }

    // ==================== Modal Management ====================

    openStartModal() {
        // If already in a session, show the active session info instead
        if (this.manager.isInSession()) {
            this.showActiveModal();
            return;
        }
        if (this.sessionNameInput) this.sessionNameInput.value = '';
        this.startModal?.classList.add('active');
        this.sessionNameInput?.focus();
    }

    closeStartModal() {
        this.startModal?.classList.remove('active');
    }

    openJoinModal() {
        // If already in a session, show the active session info instead
        if (this.manager.isInSession()) {
            this.showActiveModal();
            return;
        }
        if (this.sessionCodeInput) this.sessionCodeInput.value = '';
        this.joinModal?.classList.add('active');
        this.sessionCodeInput?.focus();
    }

    closeJoinModal() {
        this.joinModal?.classList.remove('active');
    }

    showActiveModal() {
        this.activeModal?.classList.add('active');
        this.updateSessionDisplay();
    }

    closeActiveModal() {
        this.activeModal?.classList.remove('active');
    }

    // ==================== Display Updates ====================

    updateSessionDisplay() {
        const sessionInfo = this.manager.getSessionInfo();
        if (!sessionInfo) {
            this.closeActiveModal();
            return;
        }

        // Update code and name
        if (this.displayCode) this.displayCode.textContent = sessionInfo.sessionCode;
        if (this.displayName) this.displayName.textContent = sessionInfo.sessionName;

        // Update members
        if (sessionInfo.members) this.updateMembersList(sessionInfo.members);

        // Show host controls (delete btn) only if user is host
        // Show leave btn for guests
        const deleteBtn = document.getElementById('collab-delete-session-btn');
        if (sessionInfo.isHost) {
            this.hostControls?.classList.remove('hidden');
            if (deleteBtn) deleteBtn.style.display = 'flex';
            if (this.leaveBtn) this.leaveBtn.style.display = 'none';
        } else {
            this.hostControls?.classList.add('hidden');
            if (deleteBtn) deleteBtn.style.display = 'none';
            if (this.leaveBtn) this.leaveBtn.style.display = 'flex';
        }
    }

    updateMembersList(members) {
        if (!this.membersList) return;
        this.membersList.innerHTML = '';
        if (this.memberCount) this.memberCount.textContent = members.length;

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
        // Update button badge to show active session
        this._updateNavBadge(true);
    }

    onSessionJoined(data) {
        console.log('[CollaborativeListening UI] Session joined:', data);
        this.updateSessionDisplay();
        this._updateNavBadge(true);
    }

    onSessionLeft(data) {
        console.log('[CollaborativeListening UI] Session left');
        this._updateNavBadge(false);
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
     * Updates the visual badge on the start button to indicate active session
     */
    _updateNavBadge(active) {
        const collabBtn = document.getElementById('collab-listening-btn');
        const fsCollabBtn = document.getElementById('fs-collab-listening-btn');

        const btns = [collabBtn, fsCollabBtn].filter(Boolean);
        if (active) {
            btns.forEach(btn => btn.classList.add('collab-active'));
        } else {
            btns.forEach(btn => btn.classList.remove('collab-active'));
        }
    }

    /**
     * Should be called when app initializes to restore any active session from the previous page load.
     */
    async restoreActiveSession() {
        try {
            const restored = await this.manager.restoreSession();
            if (restored) {
                console.log('[CollaborativeListening UI] Session restored:', restored.sessionCode);
                this._updateNavBadge(true);
            }
        } catch (error) {
            console.error('[CollaborativeListening UI] Failed to restore session:', error);
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
    // Store in window for access from events.js and app.js
    window.collabListeningManager = collabListeningInstance.getManager();
    window.collabListeningUI = collabListeningInstance;
    return collabListeningInstance;
}

export function getCollaborativeListeningInstance() {
    return collabListeningInstance;
}
