// Constants shared by the API and the web client so both sides agree on the vocabulary.

export const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

export const REACTION_META = {
  like: { emoji: '👍', label: 'Like', color: '#2563eb' },
  love: { emoji: '❤️', label: 'Love', color: '#e11d48' },
  haha: { emoji: '😆', label: 'Haha', color: '#f59e0b' },
  wow: { emoji: '😮', label: 'Wow', color: '#f59e0b' },
  sad: { emoji: '😢', label: 'Sad', color: '#f59e0b' },
  angry: { emoji: '😡', label: 'Angry', color: '#ea580c' },
};

export const AUDIENCES = ['public', 'friends', 'friends_except', 'specific', 'only_me'];

export const AUDIENCE_LABELS = {
  public: 'Public',
  friends: 'Friends',
  friends_except: 'Friends except…',
  specific: 'Specific friends',
  only_me: 'Only me',
};

export const ROLES = ['user', 'moderator', 'admin'];
export const USER_STATUSES = ['active', 'deactivated', 'suspended', 'banned'];

export const REPORT_CATEGORIES = [
  'spam',
  'harassment',
  'fake_account',
  'violence',
  'scam',
  'copyright',
  'adult_content',
  'hate',
  'dangerous_content',
  'other',
];
export const REPORT_TARGETS = ['user', 'post', 'comment'];

export const RELATIONSHIP_STATUSES = [
  'single',
  'in_a_relationship',
  'engaged',
  'married',
  'complicated',
  'separated',
  'divorced',
  'widowed',
];

export const FEELINGS = [
  { emoji: '😊', label: 'happy' },
  { emoji: '🥰', label: 'loved' },
  { emoji: '🤩', label: 'excited' },
  { emoji: '😌', label: 'relaxed' },
  { emoji: '🙏', label: 'grateful' },
  { emoji: '😴', label: 'tired' },
  { emoji: '🤔', label: 'thoughtful' },
  { emoji: '😢', label: 'sad' },
  { emoji: '💪', label: 'motivated' },
  { emoji: '🎉', label: 'celebrating' },
];

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accept',
  'follow',
  'reaction',
  'comment',
  'reply',
  'mention',
  'tag',
  'share',
  'security_alert',
];

export const VISIBILITY = ['everyone', 'friends', 'only_me'];
export const WHO_CAN = ['everyone', 'friends', 'nobody'];

export const SORT_COMMENTS = ['top', 'newest', 'oldest'];

export const LIMITS = {
  postText: 5000,
  commentText: 2000,
  bio: 300,
  name: 60,
  maxMedia: 10,
  maxPollOptions: 6,
  minPollOptions: 2,
  pollOptionText: 80,
  pollQuestion: 200,
  maxHashtags: 10,
  pageSize: 10,
  maxPageSize: 30,
  // 4 MB rather than 5: serverless deploys (Netlify Functions) cap request bodies at ~4.5 MB binary.
  uploadBytes: 4 * 1024 * 1024,
  maxAudienceList: 200,
  maxHiddenPosts: 500,
  messageText: 2000,
};
