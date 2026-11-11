import * as svc from '../services/messageService.js';
import { badRequest } from '../utils/AppError.js';

export const open = async (req, res) => res.json(await svc.openConversation(req.user, req.body.userId));
export const conversations = async (req, res) => res.json(await svc.listConversations(req.user, req.query));
export const messages = async (req, res) => res.json(await svc.listMessages(req.user, req.params.id, req.query));
export const send = async (req, res) => {
  if (!req.body.text && !req.file) throw badRequest('Write a message or attach a photo');
  res.status(201).json(await svc.sendMessage(req.user, req.params.id, req.body.text, req.file));
};
export const read = async (req, res) => res.json(await svc.markRead(req.user, req.params.id));
export const unread = async (req, res) => res.json({ unread: await svc.unreadTotal(req.user._id) });
export const remove = async (req, res) => res.json(await svc.deleteMessage(req.user, req.params.id));
export const one = async (req, res) => res.json(await svc.getConversation(req.user, req.params.id));
