import { User } from '../models/index.js';
import { conflict } from '../utils/AppError.js';
import * as profiles from '../services/profileService.js';
import * as notifications from '../services/notificationService.js';
import * as friends from '../services/friendService.js';
import { publicUser } from '../services/authService.js';

export const get = async (req, res) => res.json(await profiles.getProfile(req.user, req.params.username));

export const update = async (req, res) => {
  const { user, profile } = await profiles.updateProfile(req.user, req.body);
  res.json({ user: publicUser(user), profile });
};

export const changeUsername = async (req, res) => {
  const taken = await User.exists({ username: req.body.username, _id: { $ne: req.user._id } });
  if (taken) throw conflict('That username is taken', 'USERNAME_TAKEN');
  req.user.username = req.body.username;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
};

export const setAvatar = async (req, res) => res.json({ url: await profiles.setImage(req.user, 'avatar', req.file) });
export const setCover = async (req, res) => res.json({ url: await profiles.setImage(req.user, 'cover', req.file) });
export const removeAvatar = async (req, res) => { await profiles.removeImage(req.user, 'avatar'); res.json({ message: 'Removed' }); };
export const removeCover = async (req, res) => { await profiles.removeImage(req.user, 'cover'); res.json({ message: 'Removed' }); };

export const getPrivacy = async (req, res) => res.json(await profiles.getPrivacy(req.user));
export const updatePrivacy = async (req, res) => res.json(await profiles.updatePrivacy(req.user, req.body));

export const updateNotificationPrefs = async (req, res) => res.json(await notifications.updatePreferences(req.user, req.body));

export const block = async (req, res) => {
  await friends.setBlock(req.user, req.params.id, req.body?.type || 'block');
  res.json({ ok: true });
};
export const unblock = async (req, res) => {
  await friends.removeBlock(req.user, req.params.id, req.query?.type || 'block');
  res.json({ ok: true });
};
export const listBlocked = async (req, res) => res.json({ items: await friends.listBlocked(req.user, req.query.type === 'restrict' ? 'restrict' : 'block') });
