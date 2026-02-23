// recentActivityManager.js (PocketBase-backed)
import { authManager } from "./accounts/auth.js";
import { syncManager } from "./accounts/pocketbase.js";

export const recentActivityManager = {
  FIELD: "recent_activity",
  LIMIT: 10,

  _empty() {
    return { artists: [], albums: [], playlists: [], mixes: [] };
  },

  async _getRecord() {
    const uid = authManager.user?.uid;
    if (!uid) return null;
    // uses syncManager cache + ensurePbReady internally
    return await syncManager._getUserRecord(uid);
  },

  _parse(str) {
    try {
      const parsed = str ? str : this._empty();
      if (!parsed.artists) parsed.artists = [];
      if (!parsed.albums) parsed.albums = [];
      if (!parsed.playlists) parsed.playlists = [];
      if (!parsed.mixes) parsed.mixes = [];
      return parsed;
    } catch {
      return this._empty();
    }
  },

  async _get() {
    const record = await this._getRecord();
    if (!record) return this._empty();
    return this._parse(record[this.FIELD]);
  },

  async _save(data) {
    const uid = authManager.user?.uid;
    if (!uid) return;

    // write JSON string to PB (same as your other JSON fields)
    await syncManager._updateUserJSON(uid, this.FIELD, data);
  },

  async getRecents() {
    return await this._get();
  },

  async _add(type, item) {
    if (!item?.id) return;

    const data = await this._get();
    const list = Array.isArray(data[type]) ? data[type] : [];

    data[type] = list.filter((i) => i?.id !== item.id);
    data[type].unshift(item);
    data[type] = data[type].slice(0, this.LIMIT);

    await this._save(data);
  },

  async clear() {
    await this._save(this._empty());
  },

  async addArtist(artist) {
    await this._add("artists", artist);
  },

  async addAlbum(album) {
    await this._add("albums", album);
  },

  async addPlaylist(playlist) {
    await this._add("playlists", playlist);
  },

  async addMix(mix) {
    await this._add("mixes", mix);
  },
};
