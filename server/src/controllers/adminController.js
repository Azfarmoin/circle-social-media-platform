import * as moderation from '../services/moderationService.js';
import * as posts from '../services/postService.js';

export const stats = async (_req, res) => res.json(await moderation.dashboardStats());
export const users = async (req, res) => res.json(await moderation.listUsers(req.query));
export const moderateUser = async (req, res) => res.json(await moderation.moderateUser(req.user, req.params.id, req.body, req.ip));
export const reports = async (req, res) => res.json(await moderation.listReports(req.query));
export const resolveReport = async (req, res) => res.json(await moderation.resolveReport(req.user, req.params.id, req.body, req.ip));
export const auditLogs = async (req, res) => res.json(await moderation.listAuditLogs(req.query));
export const deletePost = async (req, res) => {
  await posts.deletePost(req.user, req.params.id);
  await moderation.audit(req.user, 'post.delete', 'post', req.params.id, {}, req.ip);
  res.json({ message: 'Post removed' });
};
