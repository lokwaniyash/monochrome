// MusicDatabase.js (PocketBase-only, no IndexedDB)
import { syncManager } from './accounts/pocketbase';
import { authManager } from './accounts/auth.js';

// Small helper: stable “now” for consistent timestamps within a call
const now = () => Date.now();

export class MusicDatabase {
    constructor() {
        // Kept for compatibility with callers that might read these
        this.dbName = 'MonochromeDB';
        this.version = 8;
        this.db = null;
    }

    // No-op in PB-only mode
    async open() {
        return null;
    }

    // ------------------------
    // Internal helpers
    // ------------------------

    _requireAuthUser() {
        const user = syncManager?.authManager?.user;
        // In your paste, authManager is imported inside pocketbase module, not exported.
        // If you don't expose it, we fallback to relying on syncManager.getUserData() for reads
        // and syncManager's own methods for writes.
        return user || null;
    }

    async _getCloud() {
        const data = await syncManager.getUserData();
        return data || null;
    }

    async _getLibraryObj() {
        const cloud = await this._getCloud();
        return cloud?.library || {};
    }

    async _setUserField(field, value) {
        // Prefer syncManager.updateUserJSON because it updates PB and cache
        const user = authManager.user;
        if (!user) {
            // If auth isn’t ready, behave like old code: do nothing / return
            // (callers typically run after auth anyway)
            return false;
        }
        await syncManager._updateUserJSON(user.uid, field, value);
        return true;
    }

    _ensureLibraryShape(library) {
        const lib = library && typeof library === 'object' ? library : {};
        if (!lib.tracks) lib.tracks = {};
        if (!lib.albums) lib.albums = {};
        if (!lib.artists) lib.artists = {};
        if (!lib.playlists) lib.playlists = {};
        if (!lib.mixes) lib.mixes = {};
        return lib;
    }

    _libraryKeyForType(type, item) {
        if (type === 'playlist') return item?.uuid ?? item?.id;
        return item?.id;
    }

    _minifyItem(type, item) {
        if (!item) return item;

        const base = {
            id: item.id,
            addedAt: item.addedAt || null,
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                          mediaMetadata: item.album.mediaMetadata ? { tags: item.album.mediaMetadata.tags } : null,
                      }
                    : null,
                copyright: item.copyright || null,
                isrc: item.isrc || null,
                trackNumber: item.trackNumber || null,
                streamStartDate: item.streamStartDate || null,
                version: item.version || null,
                mixes: item.mixes || null,
                isTracker: item.isTracker || (item.id && String(item.id).startsWith('tracker-')),
                trackerInfo: item.trackerInfo || null,
                audioUrl: item.remoteUrl || item.audioUrl || null,
                remoteUrl: item.remoteUrl || null,
                audioQuality: item.audioQuality || null,
                mediaMetadata: item.mediaMetadata ? { tags: item.mediaMetadata.tags } : null,
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
                type: item.type || null,
                numberOfTracks: item.numberOfTracks || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null,
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || item.createdAt || null,
                title: item.title || item.name || null,
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                user: item.user ? { name: item.user.name || null } : null,
            };
        }

        if (type === 'mix') {
            return {
                id: item.id,
                addedAt: item.addedAt,
                title: item.title,
                subTitle: item.subTitle,
                description: item.description,
                mixType: item.mixType,
                cover: item.cover,
            };
        }

        return item;
    }

    _minifyPinnedItem(item, type) {
        if (!item) return null;

        const id = item.id || item.uuid;
        let name, cover, href, images;

        switch (type) {
            case 'album':
                name = item.title;
                cover = item.cover;
                href = `/album/${id}`;
                break;
            case 'artist':
                name = item.name;
                cover = item.picture;
                href = `/artist/${id}`;
                break;
            case 'playlist':
                name = item.title || item.name;
                cover = item.image || item.cover;
                href = `/playlist/${id}`;
                break;
            case 'user-playlist':
                name = item.name;
                cover = item.cover;
                images = item.images;
                href = `/userplaylist/${id}`;
                break;
            default:
                return null;
        }

        return { id, type, name, cover, images, href };
    }

    _updatePlaylistMetadata(playlist) {
        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;

        if (!playlist.cover) {
            const uniqueCovers = [];
            const seenCovers = new Set();
            const tracks = playlist.tracks || [];
            for (const track of tracks) {
                const cover = track.album?.cover;
                if (cover && !seenCovers.has(cover)) {
                    seenCovers.add(cover);
                    uniqueCovers.push(cover);
                    if (uniqueCovers.length >= 4) break;
                }
            }
            playlist.images = uniqueCovers;
        }

        return playlist;
    }

    _dispatchPlaylistSync(action, playlist) {
        window.dispatchEvent(new CustomEvent('sync-playlist-change', { detail: { action, playlist } }));
    }

    // ------------------------
    // History API (PB)
    // ------------------------

    async addToHistory(track) {
        const minified = this._minifyItem('track', track);
        const entry = { ...minified, timestamp: now() };

        // Dedup latest: if last entry has same id, replace it
        const cloud = await this._getCloud();
        const history = Array.isArray(cloud?.history) ? cloud.history.slice() : [];
        if (history.length > 0 && history[0]?.id === track?.id) {
            history.shift();
        }
        history.unshift(entry);

        // Cap to 100 like your sync code does elsewhere
        const trimmed = history.slice(0, 100);
        await this._setUserField('history', trimmed);

        return entry;
    }

    async getHistory() {
        const cloud = await this._getCloud();
        return Array.isArray(cloud?.history) ? cloud.history : [];
    }

    async clearHistory() {
        await this._setUserField('history', []);
    }

    // ------------------------
    // Favorites API (PB via library)
    // ------------------------

    async toggleFavorite(type, item) {
        const key = this._libraryKeyForType(type, item);
        if (!key) return false;

        const exists = await this.isFavorite(type, key);

        if (exists) {
            await syncManager.syncLibraryItem(type, item, false);
            return false;
        } else {
            const minified = this._minifyItem(type, item);
            // Ensure we stamp addedAt on add
            const withAddedAt =
                type === 'playlist'
                    ? { ...minified, addedAt: minified.addedAt || now() }
                    : { ...minified, addedAt: minified.addedAt || now() };

            await syncManager.syncLibraryItem(type, withAddedAt, true);
            return true;
        }
    }

    async isFavorite(type, id) {
        const library = this._ensureLibraryShape(await this._getLibraryObj());
        const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
        return !!library?.[pluralType]?.[id];
    }

    async getFavorites(type) {
        const library = this._ensureLibraryShape(await this._getLibraryObj());
        const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
        const obj = library?.[pluralType] || {};
        const arr = Object.values(obj).filter(Boolean);

        arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        return arr;
    }

    // ------------------------
    // Pinned items (PB)
    // ------------------------

    async togglePinned(item, type) {
        const minifiedItem = this._minifyPinnedItem(item, type);
        if (!minifiedItem) return false;

        const cloud = await this._getCloud();
        let pinned = Array.isArray(cloud?.pinneditems) ? cloud.pinneditems.slice() : [];

        const idx = pinned.findIndex((x) => x?.id === minifiedItem.id);
        const exists = idx !== -1;

        if (exists) {
            pinned.splice(idx, 1);
            await this._setUserField('pinneditems', pinned);
            return false;
        }

        pinned.push({ ...minifiedItem, pinnedAt: now() });

        await this._setUserField('pinneditems', pinned);
        return true;
    }

    async isPinned(id) {
        const cloud = await this._getCloud();
        const pinned = Array.isArray(cloud?.pinneditems) ? cloud.pinneditems : [];
        return pinned.some((x) => x?.id === id);
    }

    async getPinned() {
        const cloud = await this._getCloud();
        const pinned = Array.isArray(cloud?.pinneditems) ? cloud.pinneditems.slice() : [];
        pinned.sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
        return pinned;
    }

    // ------------------------
    // Settings (PB)
    // ------------------------

    async saveSetting(key, value) {
        const cloud = await this._getCloud();
        const settings = cloud?.settings && typeof cloud.settings === 'object' ? { ...cloud.settings } : {};
        settings[key] = value;
        await this._setUserField('settings', settings);
    }

    async getSetting(key) {
        const cloud = await this._getCloud();
        const settings = cloud?.settings && typeof cloud.settings === 'object' ? cloud.settings : {};
        return settings[key];
    }

    // ------------------------
    // User Playlists API (PB)
    // ------------------------

    async createPlaylist(name, tracks = [], cover = '', description = '') {
        const id = crypto.randomUUID();
        const ts = now();

        const playlist = {
            id,
            name,
            tracks: (tracks || []).map((t) => this._minifyItem('track', { ...t, addedAt: now() })),
            cover,
            description,
            createdAt: ts,
            updatedAt: ts,
            numberOfTracks: (tracks || []).length,
            images: [],
            isPublic: false,
        };

        this._updatePlaylistMetadata(playlist);
        await syncManager.syncUserPlaylist(playlist, 'create');
        this._dispatchPlaylistSync('create', playlist);
        return playlist;
    }

    async getPlaylists(includeTracks = false) {
        const cloud = await this._getCloud();
        const obj = cloud?.userPlaylists || cloud?.userplaylists || {};
        const playlists = Array.isArray(obj) ? obj : Object.values(obj || {});
        const processed = playlists.map((playlist) => {
            // Ensure migrations similar to old lazy migration
            const p = { ...playlist };
            if (typeof p.numberOfTracks === 'undefined') {
                p.numberOfTracks = p.tracks ? p.tracks.length : 0;
            }
            if (!p.cover && (!p.images || p.images.length === 0)) {
                this._updatePlaylistMetadata(p);
            }

            if (includeTracks) return p;
            const { tracks, ...minified } = p; // eslint-disable-line no-unused-vars
            return minified;
        });

        // Newest first (createdAt)
        processed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return processed;
    }

    async getPlaylist(playlistId) {
        const cloud = await this._getCloud();
        const obj = cloud?.userPlaylists || cloud?.userplaylists || {};
        if (Array.isArray(obj)) return obj.find((p) => p?.id === playlistId) || null;
        return obj?.[playlistId] || null;
    }

    async updatePlaylist(playlist) {
        const updated = { ...playlist, updatedAt: now() };
        this._updatePlaylistMetadata(updated);
        await syncManager.syncUserPlaylist(updated, 'update');
        this._dispatchPlaylistSync('update', updated);
        return updated;
    }

    async deletePlaylist(playlistId) {
        // Let syncManager handle delete semantics (and unpublish if it does that)
        await syncManager.syncUserPlaylist({ id: playlistId }, 'delete');

        const cloud = await this._getCloud();
        const pinned = Array.isArray(cloud?.pinneditems) ? cloud.pinneditems : [];
        const nextPinned = pinned.filter((x) => x?.id !== playlistId);
        if (nextPinned.length !== pinned.length) {
            await this._setUserField("pinneditems", nextPinned);
        }

        const foldersObj = cloud?.userFolders || cloud?.userfolders || {};
        const folders = Array.isArray(foldersObj) ? foldersObj : Object.values(foldersObj);

        let changed = false;
        const nextFoldersById = {};
        for (const f of folders) {
            if (!f?.id) continue;

            const playlists = Array.isArray(f.playlists) ? f.playlists : [];
            const filtered = playlists.filter((id) => id !== playlistId);

            const nextFolder =
                filtered.length === playlists.length ? f : { ...f, playlists: filtered, updatedAt: Date.now() };

            if (nextFolder !== f) changed = true;
            nextFoldersById[f.id] = nextFolder;
        }

        if (changed) {
            await this._setUserField('user_folders', nextFoldersById);
        }


        this._dispatchPlaylistSync('delete', { id: playlistId });
    }

    async addTrackToPlaylist(playlistId, track) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');

        const p = { ...playlist };
        p.tracks = p.tracks || [];

        if (p.tracks.some((t) => t.id === track.id)) return p;

        const minifiedTrack = this._minifyItem('track', { ...track, addedAt: now() });
        p.tracks = [...p.tracks, minifiedTrack];
        p.updatedAt = now();

        this._updatePlaylistMetadata(p);
        await syncManager.syncUserPlaylist(p, 'update');
        this._dispatchPlaylistSync('update', p);
        return p;
    }

    async addTracksToPlaylist(playlistId, tracks) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');

        const p = { ...playlist };
        p.tracks = p.tracks || [];

        let addedCount = 0;
        for (const track of tracks || []) {
            if (!p.tracks.some((t) => t.id === track.id)) {
                p.tracks.push(this._minifyItem('track', { ...track, addedAt: now() }));
                addedCount++;
            }
        }

        if (addedCount > 0) {
            p.updatedAt = now();
            this._updatePlaylistMetadata(p);
            await syncManager.syncUserPlaylist(p, 'update');
            this._dispatchPlaylistSync('update', p);
        }

        return p;
    }

    async removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');

        const p = { ...playlist };
        p.tracks = (p.tracks || []).filter((t) => t.id != trackId);
        p.updatedAt = now();

        this._updatePlaylistMetadata(p);
        await syncManager.syncUserPlaylist(p, 'update');
        this._dispatchPlaylistSync('update', p);
        return p;
    }

    async updatePlaylistName(playlistId, newName) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');
        const p = { ...playlist, name: newName, updatedAt: now() };
        await syncManager.syncUserPlaylist(p, 'update');
        return p;
    }

    async updatePlaylistDescription(playlistId, newDescription) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');
        const p = { ...playlist, description: newDescription, updatedAt: now() };
        await syncManager.syncUserPlaylist(p, 'update');
        this._dispatchPlaylistSync('update', p);
        return p;
    }

    async updatePlaylistTracks(playlistId, tracks) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) throw new Error('Playlist not found');

        const p = { ...playlist };
        p.tracks = tracks || [];
        p.updatedAt = now();

        this._updatePlaylistMetadata(p);
        await syncManager.syncUserPlaylist(p, 'update');
        this._dispatchPlaylistSync('update', p);
        return p;
    }

    async performTransaction(storeName, mode, callback) {
        return await syncManager.performTransaction(storeName, mode, callback);
    }

    // ------------------------
    // User Folders API (PB)
    // ------------------------

    async createFolder(name, cover = '') {
        const id = crypto.randomUUID();
        const ts = now();
        const folder = {
            id,
            name,
            cover,
            playlists: [],
            createdAt: ts,
            updatedAt: ts,
        };

        await syncManager.syncUserFolder(folder, 'create');
        return folder;
    }

    async getFolders() {
        const cloud = await this._getCloud();
        const obj = cloud?.userFolders || cloud?.userfolders || {};
        const folders = Array.isArray(obj) ? obj : Object.values(obj || {});
        folders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return folders;
    }

    async getFolder(id) {
        const cloud = await this._getCloud();
        const obj = cloud?.userFolders || cloud?.userfolders || {};
        if (Array.isArray(obj)) return obj.find((f) => f?.id === id) || null;
        return obj?.[id] || null;
    }

    async deleteFolder(id) {
        await syncManager.syncUserFolder({ id }, 'delete');
    }

    async addPlaylistToFolder(folderId, playlistId) {
        const folder = await this.getFolder(folderId);
        if (!folder) throw new Error('Folder not found');

        const f = { ...folder };
        f.playlists = f.playlists || [];
        if (!f.playlists.includes(playlistId)) {
            f.playlists = [...f.playlists, playlistId];
            f.updatedAt = now();
            await syncManager.syncUserFolder(f, 'update');
        }
        return f;
    }

    // ------------------------
    // Import / Export (PB)
    // ------------------------

    async exportData() {
        const tracks = await this.getFavorites('track');
        const albums = await this.getFavorites('album');
        const artists = await this.getFavorites('artist');
        const playlists = await this.getFavorites('playlist');
        const mixes = await this.getFavorites('mix');
        const history = await this.getHistory();

        const userPlaylists = await this.getPlaylists(true);
        const userFolders = await this.getFolders();

        return {
            favorites_tracks: tracks.map((t) => this._minifyItem('track', t)),
            favorites_albums: albums.map((a) => this._minifyItem('album', a)),
            favorites_artists: artists.map((a) => this._minifyItem('artist', a)),
            favorites_playlists: playlists.map((p) => this._minifyItem('playlist', p)),
            favorites_mixes: mixes.map((m) => this._minifyItem('mix', m)),
            history_tracks: history.map((t) => this._minifyItem('track', t)),
            user_playlists: userPlaylists,
            user_folders: userFolders,
        };
    }

    async importData(data, clear = false) {
        // In PB-only mode, import means: overwrite relevant PB fields
        // Map import schema -> your PB user record schema.
        const cloud = await this._getCloud();
        const library = this._ensureLibraryShape(cloud?.library || {});

        const applyFavorites = (type, items, keyField) => {
            const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
            if (clear) library[pluralType] = {};
            const arr = Array.isArray(items) ? items : Object.values(items || {});
            for (const item of arr) {
                const min = this._minifyItem(type, item);
                const key = keyField ? item?.[keyField] : this._libraryKeyForType(type, item);
                const finalKey = key ?? (type === 'playlist' ? min?.uuid : min?.id);
                if (!finalKey) continue;
                library[pluralType][finalKey] = { ...min, addedAt: min.addedAt || now() };
            }
        };

        applyFavorites('track', data?.favorites_tracks, 'id');
        applyFavorites('album', data?.favorites_albums, 'id');
        applyFavorites('artist', data?.favorites_artists, 'id');
        applyFavorites('playlist', data?.favorites_playlists, 'uuid');
        applyFavorites('mix', data?.favorites_mixes, 'id');

        const historyArr = Array.isArray(data?.history_tracks) ? data.history_tracks : [];

        // user_playlists and user_folders in PB are stored as objects keyed by id in your syncManager
        const playlistsArr = Array.isArray(data?.user_playlists)
            ? data.user_playlists
            : Object.values(data?.user_playlists || {});
        const foldersArr = Array.isArray(data?.user_folders)
            ? data.user_folders
            : Object.values(data?.user_folders || {});

        const userplaylists = {};
        for (const p of playlistsArr) {
            if (!p?.id) continue;
            userplaylists[p.id] = p;
        }

        const userfolders = {};
        for (const f of foldersArr) {
            if (!f?.id) continue;
            userfolders[f.id] = f;
        }

        await this._setUserField('library', library);
        await this._setUserField('history', clear ? historyArr : historyArr); // you can merge if you want
        await this._setUserField('userplaylists', userplaylists);
        await this._setUserField('userfolders', userfolders);

        // Return “did anything change”
        return true;
    }
}

export const db = new MusicDatabase();
